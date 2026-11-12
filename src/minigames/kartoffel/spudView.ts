import Phaser from 'phaser';
import { CONFIG } from '../../config';
import { Character } from '../../gfx/character';
import { findSprite } from '../../gfx/layerPlan';
import { assetsOf, byKey, pivotSprite, swapSprite, txt } from '../../game/ui';
import { sound } from '../../audio/sound';
import { Reconciler } from '../../net/reconcile';
import { buildArena, type Arena } from '../common/arena';
import { drawArena } from '../common/arenaView';
import type { Facing } from '../common/shove';
import { drawShoveRing } from '../common/shoveRing';
import type { Mover } from '../common/mover';
import type { GamePlayer, InputState, MiniGameView, PlayerKey } from '../types';
import { speedOf, type Potato, type SpudFx, type SpudPickup, type SpudState } from './spudHost';
import { SpudHud } from './spudHud';
import { SpudSounds } from './spudSounds';
import { guessSprint, NO_SPRINT_GUESS, stepWalker, type SprintGuess } from './spudMove';

const PKG = 'kartoffel';
const TICK_LOOPS = ['ticken_langsam_schleife', 'ticken_mittel_schleife', 'ticken_schnell_schleife'].map((n) => `${PKG}.${n}`);
const HISS_LOOP = `${PKG}.zischen_schleife`;

export const ARENA_FILE = 'arena-kartoffel';
export const ARENA_MAP = 'kartoffel.map';
/** Where the map is drawn: world = map + offset (the 416x208 map below the 16 px HUD bar). */
export const ARENA_OFFSET: { readonly x: number; readonly y: number } = { x: 5, y: 26 };

const GARDEN_BG = 0x6f9a4a;
const FX_DEPTH = 900;
/** One-shot fx without an animation stay this long. */
const FX_STILL_MS = 300;
/** After the bang the figure lies as mush this long, then comes back (as a ghost when out). */
const MUSH_MS = 1000;
const GHOST_ALPHA = 0.45;
const LABEL_LIFT = 46;
/** Gap between the name label and an emote bubble (px). */
const EMOTE_GAP = 4;
/** "Nicht zurück!" sign: its bottom this far above the feet, bobbing by 1 px. */
const SIGN_LIFT = 52;
const SIGN_BOB_MS = 150;
/** The sign fades out over the last part of noBackMs. */
const SIGN_FADE_MS = 200;
/** Potato at the hand when the body frame has no hand anchor (relative to the feet, facing right). */
const HAND_FALLBACK = { x: 6, y: -12 };
/** Offset of each further potato on the same holder (px, facing right; depth step stays below the label). */
const STACK = { x: 4, y: 3, depth: 0.02 };

const HEAT_SPRITE: Record<Potato['heat'], string> = {
  0: 'kartoffel.bombe.ruhig',
  1: 'kartoffel.bombe.glimmt',
  2: 'kartoffel.bombe.glueht',
  3: 'kartoffel.bombe.gleich',
};
/** Fx with a sprite of their own; the others are sound-only (Task 5). */
const FX_SPRITE: Partial<Record<SpudFx['kind'], string>> = {
  knall: 'kartoffel.explosion',
  konfetti: 'kartoffel.fake.reveal',
};
const PICKUP_SPRITE = (kind: SpudPickup['kind']) => `kartoffel.pickup.${kind}`;

type Avatar = {
  char: Character;
  label: Phaser.GameObjects.Text;
  /** Mush sprite shown for MUSH_MS after the bang. */
  mush: Phaser.GameObjects.Sprite | null;
  anim: string;
  dir: Facing;
  /** Screen position (feet) of the last render. */
  x: number;
  y: number;
  mushUntil: number;
};
type PotatoView = { bomb: Phaser.GameObjects.Sprite | null; fuse: Phaser.GameObjects.Sprite | null };

export class SpudView implements MiniGameView<SpudState> {
  private readonly arena: Arena;
  private readonly avatars = new Map<PlayerKey, Avatar>();
  /** Where emote bubbles point: above the name label of the last rendered position (ghosts too). */
  private readonly anchors = new Map<PlayerKey, { x: number; y: number }>();
  private readonly potatoes = new Map<number, PotatoView>();
  private readonly pickups = new Map<number, Phaser.GameObjects.Sprite | null>();
  /** "Nicht zurück!" sign per passer. */
  private readonly signs = new Map<PlayerKey, Phaser.GameObjects.Sprite | null>();
  /** Fuse anchor of each bomb sprite, relative to its pivot (facing right). */
  private readonly fuseAt = new Map<string, { x: number; y: number }>();
  private readonly fxSeen = new Set<number>();
  private readonly fxLive = new Set<Phaser.GameObjects.Sprite>();
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly hud: SpudHud;
  private readonly sounds: SpudSounds;
  /** Shove cooldown ring under the own figure. */
  private readonly ring: Phaser.GameObjects.Graphics;
  // Prediction (clients): the host's walking step at the speed of the latest own state.
  private speed: number = CONFIG.kartoffel.walkSpeed;
  private readonly reconciler = new Reconciler<Mover>((m, input, dt) => stepWalker(m, input, dt, this.arena, this.speed));
  private target: Mover | null = null;
  private off = { x: 0, y: 0 };
  private lastLatest: SpudState | null = null;
  private lastSentSeq = 0;
  private pred: Mover | null = null;
  /** Own sprint started locally on the click, until the host state shows it. */
  private sprint: SprintGuess = NO_SPRINT_GUESS;

  constructor(
    private readonly scene: Phaser.Scene,
    players: GamePlayer[],
    private readonly selfKey: PlayerKey,
  ) {
    const { width, height } = CONFIG.view;
    const assets = assetsOf(scene);
    const file = assets[ARENA_FILE];
    this.arena = buildArena(file, ARENA_MAP, { wallChar: null });
    this.objects.push(scene.add.rectangle(0, 0, width, height, GARDEN_BG).setOrigin(0).setDepth(-2000));
    this.objects.push(...drawArena(scene, file, ARENA_MAP, ARENA_OFFSET.x, ARENA_OFFSET.y));
    for (const [key, p] of byKey(players)) {
      const char = new Character(scene, assets, p.look, p.slot);
      const label = txt(scene, 0, 0, p.name, 10, key === selfKey ? '#fff4a8' : '#ffffff');
      const mush = pivotSprite(scene, 'kartoffel.brei_figur', 0, 0)?.setVisible(false) ?? null;
      this.avatars.set(key, { char, label, mush, anim: 'idle', dir: 'down', x: 0, y: 0, mushUntil: 0 });
      this.objects.push(char, label, ...(mush ? [mush] : []));
    }
    this.ring = scene.add.graphics();
    this.objects.push(this.ring);
    this.hud = new SpudHud(scene, players);
    this.sounds = new SpudSounds(selfKey);
  }

  predict(input: InputState, dt: number, latest: SpudState | null, ackSeq: number, sentSeq: number): void {
    // A lower seq means a new connection: the host restarted its ack counter.
    if (sentSeq < this.lastSentSeq) this.reconciler.clear();
    this.lastSentSeq = sentSeq;
    // An ack beyond what we sent belongs to the previous connection.
    const ack = ackSeq > sentSeq ? 0 : ackSeq;
    const server = latest?.players[this.selfKey];
    if (!latest || !server) return;
    const fresh = latest !== this.lastLatest;
    this.lastLatest = latest;
    this.sprint = guessSprint(this.sprint, input.primaryTaps, server, dt * 1000);
    // The predicted speed composes like speedOf, with the local sprint guess in place of the host's.
    this.speed = speedOf({ ...server, sprintMs: Math.max(server.sprintMs, this.sprint.leftMs) });
    const base: Mover = { x: server.x, y: server.y, vx: server.vx, vy: server.vy, dir: server.dir };
    // Stunned: the host slides us, input does nothing. Done: the host no longer moves anybody.
    // (Ghosts and the pause between bangs walk on the host, so they are predicted.)
    if (server.stun || latest.phase === 'done') {
      this.reconciler.clear();
      this.target = base;
      this.off = { x: 0, y: 0 };
      this.pred = { ...base };
      return;
    }
    this.reconciler.record(sentSeq, input, dt);
    if (!this.target) {
      this.target = base;
    } else {
      const advanced = stepWalker(this.target, input, dt, this.arena, this.speed);
      if (fresh) {
        const next = this.reconciler.reconcile(base, ack);
        // Carry the shown position over: a reconcile without error leaves the offset untouched.
        this.off = { x: this.off.x + advanced.x - next.x, y: this.off.y + advanced.y - next.y };
        this.target = next;
      } else {
        this.target = advanced;
      }
    }
    // Facing comes from the current input, not from the replay base.
    const dir = stepWalker(this.target, input, 0, this.arena, this.speed).dir;
    const keep = 1 - CONFIG.net.predictEase;
    this.off = { x: this.off.x * keep, y: this.off.y * keep };
    if (Math.abs(this.off.x) < 0.01 && Math.abs(this.off.y) < 0.01) this.off = { x: 0, y: 0 };
    this.pred = { ...this.target, x: this.target.x + this.off.x, y: this.target.y + this.off.y, dir };
  }

  render(s: SpudState, selfKey: PlayerKey): void {
    const now = this.scene.time.now;
    // Fx first: a bang turns its figure into mush in this same frame.
    this.renderFx(s.fx, now);
    this.renderAvatars(s, selfKey, now);
    this.renderPotatoes(s.potatoes);
    this.renderSigns(s.potatoes, now);
    this.renderPickups(s.pickups);
    this.renderSound(s, now);
    this.hud.update(s, selfKey);
  }

  private renderSound(s: SpudState, now: number): void {
    for (const c of this.sounds.update(s, now)) sound.play(c.name.includes('.') ? c.name : `${PKG}.${c.name}`, c);
    const music = SpudSounds.music(s);
    sound.setMusic(music && `${PKG}.${music}`);
    // One tick loop at a time: switch by stopping the others.
    const tick = SpudSounds.ticking(s);
    const want = tick && `${PKG}.${tick}`;
    for (const id of TICK_LOOPS) if (id !== want) sound.loop(id, false);
    if (want) sound.loop(want, true);
    sound.loop(HISS_LOOP, SpudSounds.hissing(s));
  }

  private renderAvatars(s: SpudState, selfKey: PlayerKey, now: number): void {
    for (const [key, a] of this.avatars) {
      const sp = s.players[key];
      if (!sp) continue;
      const p = key === selfKey && this.pred ? { ...sp, ...this.pred } : sp;
      const x = Math.round(p.x + ARENA_OFFSET.x);
      const y = Math.round(p.y + ARENA_OFFSET.y);
      a.x = x;
      a.y = y;
      const mushed = now < a.mushUntil;
      const moving = Math.hypot(p.vx, p.vy) > 1;
      const anim = sp.stun ? 'stumble'
        : sp.swing ? 'throw'
        : moving ? (sp.sprintMs > 0 ? 'sprint' : 'run')
        : 'idle';
      if (anim !== a.anim || p.dir !== a.dir) {
        a.anim = anim;
        a.dir = p.dir;
        a.char.play(anim, p.dir);
      }
      const alpha = sp.ghost ? GHOST_ALPHA : 1;
      a.char.setPosition(x, y).setDepth(y).setAlpha(alpha).setVisible(!mushed);
      a.mush?.setPosition(x, y).setDepth(y).setVisible(mushed);
      a.label.setPosition(x, y - LABEL_LIFT).setDepth(y + 0.5).setAlpha(alpha);
      this.anchors.set(key, { x, y: y - LABEL_LIFT - EMOTE_GAP });
      if (key === selfKey) drawShoveRing(this.ring, x, y, sp.ghost || mushed ? 0 : sp.shoveCdMs);
    }
  }

  /** Each potato at its holder's hand, with the burning fuse at the bomb's fuse anchor. */
  private renderPotatoes(potatoes: Potato[]): void {
    const alive = new Set(potatoes.map((p) => p.id));
    for (const [id, v] of this.potatoes) {
      if (alive.has(id)) continue;
      v.bomb?.destroy();
      v.fuse?.destroy();
      this.potatoes.delete(id);
    }
    // Several potatoes on one holder (a fake next to the real one) stack: the n-th (by id, so they
    // never swap places) sits STACK px further out and up, slightly in front.
    const stacked = new Map<PlayerKey, number>();
    for (const pot of [...potatoes].sort((x, y) => x.id - y.id)) {
      const n = stacked.get(pot.holder) ?? 0;
      stacked.set(pot.holder, n + 1);
      const name = HEAT_SPRITE[pot.heat];
      let v = this.potatoes.get(pot.id);
      if (!v) {
        v = { bomb: pivotSprite(this.scene, name, 0, 0), fuse: pivotSprite(this.scene, 'kartoffel.lunte', 0, 0) };
        this.potatoes.set(pot.id, v);
      }
      const a = this.avatars.get(pot.holder);
      const show = !!a && a.char.visible;
      v.bomb?.setVisible(show);
      v.fuse?.setVisible(show);
      if (!a || !show) continue;
      const flip = a.dir === 'left';
      const hand = a.char.anchor('hand') ?? { x: flip ? -HAND_FALLBACK.x : HAND_FALLBACK.x, y: HAND_FALLBACK.y };
      const bx = a.x + hand.x + n * (flip ? -STACK.x : STACK.x);
      const by = a.y + hand.y - n * STACK.y;
      // Facing up, the hand (and the potato) is behind the body.
      const depth = a.y + (a.dir === 'up' ? -0.3 : 0.3) + n * STACK.depth;
      if (v.bomb) {
        swapSprite(this.scene, v.bomb, name, flip);
        v.bomb.setPosition(bx, by).setDepth(depth);
      }
      const f = this.fuseOf(name);
      if (v.fuse) swapSprite(this.scene, v.fuse, 'kartoffel.lunte', flip);
      v.fuse?.setPosition(bx + (flip ? -f.x : f.x), by + f.y).setDepth(depth + 0.01);
    }
  }

  private fuseOf(name: string): { x: number; y: number } {
    let at = this.fuseAt.get(name);
    if (!at) {
      const def = findSprite(assetsOf(this.scene), name)?.def;
      // FrameDef types only the body anchors; prop sprites carry their own (the bomb's `fuse`).
      const anchors = def?.frames[0]?.anchors as Partial<Record<string, [number, number]>> | undefined;
      const fuse = anchors?.fuse;
      at = def && fuse ? { x: fuse[0] - def.pivot[0], y: fuse[1] - def.pivot[1] } : { x: 0, y: 0 };
      this.fuseAt.set(name, at);
    }
    return at;
  }

  /** "Nicht zurück!" floats above the last giver while it cannot get the potato back. */
  private renderSigns(potatoes: Potato[], now: number): void {
    const left = new Map<PlayerKey, number>();
    for (const p of potatoes) {
      if (p.noBackFrom && p.noBackMs > 0) left.set(p.noBackFrom, Math.max(left.get(p.noBackFrom) ?? 0, p.noBackMs));
    }
    for (const [key, s] of this.signs) {
      if (left.has(key)) continue;
      s?.destroy();
      this.signs.delete(key);
    }
    const bob = Math.round(Math.sin(now / SIGN_BOB_MS));
    for (const [key, ms] of left) {
      const a = this.avatars.get(key);
      if (!a) continue;
      let s = this.signs.get(key);
      if (s === undefined) {
        s = pivotSprite(this.scene, 'fx.nicht_zurueck', 0, 0);
        this.signs.set(key, s);
      }
      s?.setPosition(a.x, a.y - SIGN_LIFT + bob).setDepth(FX_DEPTH + 1).setAlpha(Math.min(1, ms / SIGN_FADE_MS));
    }
  }

  private renderPickups(pickups: SpudPickup[]): void {
    const alive = new Set(pickups.map((p) => p.id));
    for (const [id, sp] of this.pickups) {
      if (alive.has(id)) continue;
      sp?.destroy();
      this.pickups.delete(id);
    }
    for (const p of pickups) {
      if (this.pickups.has(p.id)) continue;
      const y = p.y + ARENA_OFFSET.y;
      this.pickups.set(p.id, pivotSprite(this.scene, PICKUP_SPRITE(p.kind), p.x + ARENA_OFFSET.x, y)?.setDepth(y) ?? null);
    }
  }

  /** Each fx id plays once; ids that left the snapshot are forgotten (they never come back). */
  private renderFx(fx: SpudFx[], now: number): void {
    const current = new Set(fx.map((f) => f.id));
    for (const id of this.fxSeen) if (!current.has(id)) this.fxSeen.delete(id);
    for (const f of fx) {
      if (this.fxSeen.has(f.id)) continue;
      this.fxSeen.add(f.id);
      if (f.kind === 'knall' && f.who) {
        const a = this.avatars.get(f.who);
        if (a) a.mushUntil = now + MUSH_MS;
      }
      const name = FX_SPRITE[f.kind];
      if (!name) continue;
      const s = pivotSprite(this.scene, name, f.x + ARENA_OFFSET.x, f.y + ARENA_OFFSET.y);
      if (!s) continue;
      s.setDepth(FX_DEPTH);
      this.fxLive.add(s);
      const done = () => {
        this.fxLive.delete(s);
        s.destroy();
      };
      if (s.anims.isPlaying) s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, done);
      else this.scene.time.delayedCall(FX_STILL_MS, done);
    }
  }

  emoteAnchor(key: PlayerKey): { x: number; y: number } | null {
    return this.anchors.get(key) ?? null;
  }

  destroy(): void {
    for (const id of [...TICK_LOOPS, HISS_LOOP]) sound.loop(id, false);
    for (const v of this.potatoes.values()) {
      v.bomb?.destroy();
      v.fuse?.destroy();
    }
    for (const p of this.pickups.values()) p?.destroy();
    for (const s of this.signs.values()) s?.destroy();
    for (const s of this.fxLive) s.destroy();
    for (const o of this.objects) o.destroy();
    this.hud.destroy();
    this.potatoes.clear();
    this.pickups.clear();
    this.signs.clear();
    this.fxLive.clear();
    this.avatars.clear();
  }
}

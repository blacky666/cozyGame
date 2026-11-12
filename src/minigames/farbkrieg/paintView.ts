import Phaser from 'phaser';
import { sound } from '../../audio/sound';
import { CONFIG } from '../../config';
import type { ColorMap } from '../../gfx/assetTypes';
import { Character } from '../../gfx/character';
import { assetsOf, byKey, pivotSprite, playerColor, playerColors, swapSprite, txt } from '../../game/ui';
import { Reconciler } from '../../net/reconcile';
import { buildArena, type Arena } from '../common/arena';
import { drawArena } from '../common/arenaView';
import { CROSSHAIR_DIM, drawCrosshair, pointerPixel } from '../common/crosshair';
import type { Facing } from '../common/shove';
import { drawShoveRing } from '../common/shoveRing';
import { stepWalker } from '../kartoffel/spudMove';
import type { Mover } from '../common/mover';
import type { GamePlayer, InputState, MiniGameView, PlayerKey } from '../types';
import { createGrid } from './paintGrid';
import { speedOf, type Blob, type PaintFx, type PaintPickup, type PaintState } from './paintHost';
import { PaintHud } from './paintHud';
import { PAINT_DEPTH, PaintLayer } from './paintLayer';
import { PaintSounds } from './paintSounds';

export const ARENA_FILE = 'arena-farbkrieg';
export const ARENA_MAP = 'farbkrieg.map';
/** Where the map is drawn: world = map + offset (the 416x208 map below the HUD band). */
export const ARENA_OFFSET: { readonly x: number; readonly y: number } = { x: 5, y: 26 };

const PKG = 'farbkrieg';
const PAINT_LOOP = `${PKG}.malen_schleife`;
const MOPP_LOOP = `${PKG}.wischmopp_schleife`;
const ROLL_LOOP = `${PKG}.rollschuhe_schleife`;
/** Sound loops of the view; stopped in destroy(). */
const LOOPS: readonly string[] = [PAINT_LOOP, MOPP_LOOP, ROLL_LOOP];

const WORKSHOP_BG = 0x5e3b25;
const FX_DEPTH = 900;
const LABEL_LIFT = 46;
/** Mopp trail: one stamp at the feet every this many ms, just above the paint. */
const MOPP_STAMP_MS = 120;
const MOPP_DEPTH = PAINT_DEPTH + 0.2;
/** Finale bomb shadow: on the floor above the paint, below the rand. */
const SHADOW_DEPTH = PAINT_DEPTH + 0.3;
/** The finale bomb starts this far above the centre (off the top of the screen). */
const FALL_PX = 200;
/** Flying blobs: drawn this far above their floor path at most, sinking onto it over the last px. */
const BLOB_LIFT = 8;
const BLOB_SINK = 0.15;
/** Colours for sprites without an owner (a finale bomb nobody got). */
const NEUTRAL_COLORS: ColorMap = { player: '#fbf7ee', player_dark: '#d6cdbf' };
const FINALE_BOMB = 'farbe.finale_bombe';
/** Own slot of a view without one (not a player): no tile is ever own paint. */
const NO_SLOT = -1;

const BLOB_SPRITE: Record<Blob['kind'], string> = { klecks: 'farbe.klecks.flug', bombe: 'farbe.bombe.flug' };
/** Fx with a sprite (recoloured to `who`); getuencht marks its figure, the rest are sound-only (Task 5). */
const FX_SPRITE: Partial<Record<PaintFx['kind'], string>> = {
  platsch: 'farbe.klecks.aufprall',
  bombe: 'farbe.bombe.explosion',
  finale: 'farbe.bombe.explosion',
};
const PICKUP_SPRITE = (kind: PaintPickup['kind']) => `farbkrieg.pickup.${kind}`;
const skateName = (dir: Facing) => `farbe.rollschuhe.${dir === 'left' ? 'side' : dir}`;

type Avatar = {
  char: Character;
  label: Phaser.GameObjects.Text;
  /** Paint over the figure while getüncht, in the thrower's colour. */
  splat: Phaser.GameObjects.Sprite | null;
  splatColors: ColorMap;
  /** Roller skates over the feet (frame by frame like the sprint body). */
  skates: Phaser.GameObjects.Sprite | null;
  /** anim|dir the skates were set up for ('' = hidden). */
  skatesFor: string;
  anim: string;
  dir: Facing;
  moppAt: number;
};

export class PaintView implements MiniGameView<PaintState> {
  private readonly arena: Arena;
  private readonly layer: PaintLayer;
  private readonly avatars = new Map<PlayerKey, Avatar>();
  private readonly colorsOf = new Map<PlayerKey, ColorMap>();
  private readonly blobs = new Map<number, Phaser.GameObjects.Sprite | null>();
  private readonly pickups = new Map<number, Phaser.GameObjects.Sprite | null>();
  private readonly fxSeen = new Set<number>();
  /** One-shot sprites (fx, mopp stamps) that destroy themselves when their animation ends. */
  private readonly live = new Set<Phaser.GameObjects.Sprite>();
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly hud: PaintHud;
  private readonly sounds: PaintSounds;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly crosshair: Phaser.GameObjects.Graphics;
  private canThrow = true;
  private readonly finaleBomb: Phaser.GameObjects.Sprite | null;
  private readonly finaleShadow: Phaser.GameObjects.Graphics;
  /** Local time the finale fall started (smooth between snapshots), null when not falling. */
  private fallStart: number | null = null;
  /** Player whose colours the falling bomb wears (undefined: not recoloured yet). */
  private bombWho: PlayerKey | null | undefined = undefined;
  // Prediction (clients): the host's walking step at the speed of the latest own state.
  private speed: number = CONFIG.farbkrieg.walkSpeed;
  private readonly reconciler = new Reconciler<Mover>((m, input, dt) => this.step(m, input, dt));
  private target: Mover | null = null;
  private off = { x: 0, y: 0 };
  private lastLatest: PaintState | null = null;
  private lastSentSeq = 0;
  private pred: Mover | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    players: GamePlayer[],
    private readonly selfKey: PlayerKey,
  ) {
    const { width, height } = CONFIG.view;
    const assets = assetsOf(scene);
    const file = assets[ARENA_FILE];
    this.arena = buildArena(file, ARENA_MAP);
    const grid = createGrid(this.arena);
    this.objects.push(scene.add.rectangle(0, 0, width, height, WORKSHOP_BG).setOrigin(0).setDepth(-2000));
    this.objects.push(...drawArena(scene, file, ARENA_MAP, ARENA_OFFSET.x, ARENA_OFFSET.y));
    this.layer = new PaintLayer(scene, grid, ARENA_OFFSET);
    for (const [key, p] of byKey(players)) {
      const char = new Character(scene, assets, p.look, p.slot);
      const label = txt(scene, 0, 0, p.name, 10, key === selfKey ? '#fff4a8' : '#ffffff');
      const splat = pivotSprite(scene, 'farbe.getuencht', 0, 0)?.setVisible(false) ?? null;
      const skates = pivotSprite(scene, skateName('down'), 0, 0)?.setVisible(false) ?? null;
      this.avatars.set(key, { char, label, splat, splatColors: {}, skates, skatesFor: '', anim: 'idle', dir: 'down', moppAt: 0 });
      this.colorsOf.set(key, playerColors(scene, p.slot));
      this.objects.push(char, label, ...(splat ? [splat] : []), ...(skates ? [skates] : []));
    }
    this.ring = scene.add.graphics();
    this.finaleShadow = scene.add.graphics().setDepth(SHADOW_DEPTH).setVisible(false);
    this.finaleBomb = pivotSprite(scene, FINALE_BOMB, 0, 0, NEUTRAL_COLORS)?.setDepth(FX_DEPTH - 1).setVisible(false) ?? null;
    const self = players.find((p) => p.key === selfKey);
    this.crosshair = drawCrosshair(scene, self ? playerColor(scene, self.slot) : '#ffffff');
    this.objects.push(this.ring, this.finaleShadow, this.crosshair, ...(this.finaleBomb ? [this.finaleBomb] : []));
    this.hud = new PaintHud(scene, players, grid.count);
    this.sounds = new PaintSounds(selfKey, self?.slot ?? NO_SLOT);
  }

  private step(m: Mover, input: InputState, dt: number): Mover {
    return stepWalker(m, input, dt, this.arena, this.speed, CONFIG.farbkrieg.bodyRadius);
  }

  /** Every frame: crosshair on the pointer's world pixel, dimmed while neither a Klecks nor an extra is ready. */
  frame(): void {
    const w = pointerPixel(this.scene);
    if (!w) {
      this.crosshair.setVisible(false);
      return;
    }
    this.crosshair.setPosition(w.x, w.y).setAlpha(this.canThrow ? 1 : CROSSHAIR_DIM).setVisible(true);
  }

  predict(input: InputState, dt: number, latest: PaintState | null, ackSeq: number, sentSeq: number): void {
    // A lower seq means a new connection: the host restarted its ack counter.
    if (sentSeq < this.lastSentSeq) this.reconciler.clear();
    this.lastSentSeq = sentSeq;
    // An ack beyond what we sent belongs to the previous connection.
    const ack = ackSeq > sentSeq ? 0 : ackSeq;
    const server = latest?.players[this.selfKey];
    if (!latest || !server) return;
    const fresh = latest !== this.lastLatest;
    this.lastLatest = latest;
    this.speed = speedOf(server);
    const base: Mover = { x: server.x, y: server.y, vx: server.vx, vy: server.vy, dir: server.dir };
    // Stunned: the host slides us, input does nothing. Time up: the host no longer moves anybody.
    if (server.stun || latest.timeLeftMs <= 0) {
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
      const advanced = this.step(this.target, input, dt);
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
    const dir = this.step(this.target, input, 0).dir;
    const keep = 1 - CONFIG.net.predictEase;
    this.off = { x: this.off.x * keep, y: this.off.y * keep };
    if (Math.abs(this.off.x) < 0.01 && Math.abs(this.off.y) < 0.01) this.off = { x: 0, y: 0 };
    this.pred = { ...this.target, x: this.target.x + this.off.x, y: this.target.y + this.off.y, dir };
  }

  render(s: PaintState, selfKey: PlayerKey): void {
    const now = this.scene.time.now;
    this.layer.update(s.grid);
    this.renderFx(s.fx);
    this.renderAvatars(s, selfKey, now);
    this.renderBlobs(s.blobs);
    this.renderPickups(s.pickups);
    this.renderFinale(s, now);
    this.renderSound(s, now);
    const me = s.players[selfKey];
    this.canThrow = !!me && !me.stun && (me.klecksCdMs <= 0 || me.extra !== null);
    this.hud.update(s, selfKey);
  }

  private renderSound(s: PaintState, now: number): void {
    for (const c of this.sounds.update(s, now)) sound.play(c.name.includes('.') ? c.name : `${PKG}.${c.name}`, c);
    const music = PaintSounds.music(s);
    sound.setMusic(music && `${PKG}.${music}`);
    sound.loop(PAINT_LOOP, this.sounds.painting(now));
    const l = PaintSounds.loops(s, this.selfKey);
    sound.loop(MOPP_LOOP, l.mopp);
    sound.loop(ROLL_LOOP, l.roll);
  }

  private renderAvatars(s: PaintState, selfKey: PlayerKey, now: number): void {
    for (const [key, a] of this.avatars) {
      const sp = s.players[key];
      if (!sp) continue;
      const p = key === selfKey && this.pred ? { ...sp, ...this.pred } : sp;
      const x = Math.round(p.x + ARENA_OFFSET.x);
      const y = Math.round(p.y + ARENA_OFFSET.y);
      const moving = Math.hypot(p.vx, p.vy) > 1;
      const anim = sp.stun ? 'stumble'
        : sp.swing || sp.throwAnimMs > 0 ? 'throw'
        : moving ? (sp.rollMs > 0 ? 'sprint' : 'run')
        : 'idle';
      if (anim !== a.anim || p.dir !== a.dir) {
        a.anim = anim;
        a.dir = p.dir;
        a.char.play(anim, p.dir);
      }
      a.char.setPosition(x, y).setDepth(y);
      a.label.setPosition(x, y - LABEL_LIFT).setDepth(y + 0.5);
      this.renderSkates(a, sp.rollMs > 0, x, y);
      if (a.splat) {
        const on = sp.slowMs > 0;
        if (on) swapSprite(this.scene, a.splat, 'farbe.getuencht', false, false, a.splatColors);
        a.splat.setPosition(x, y).setDepth(y + 0.2).setVisible(on);
      }
      if (sp.moppMs > 0 && now - a.moppAt >= MOPP_STAMP_MS) {
        a.moppAt = now;
        this.oneShot(pivotSprite(this.scene, 'farbe.mopp_spur', x, y), MOPP_DEPTH);
      }
      if (key === selfKey) drawShoveRing(this.ring, x, y, sp.shoveCdMs);
    }
  }

  /** Skates while on rollers: they run with the sprint body from its first frame, else stand on frame 0. */
  private renderSkates(a: Avatar, on: boolean, x: number, y: number): void {
    const s = a.skates;
    if (!s) return;
    if (!on) {
      s.setVisible(false);
      a.skatesFor = '';
      return;
    }
    const want = `${a.anim}|${a.dir}`;
    if (want !== a.skatesFor) {
      a.skatesFor = want;
      swapSprite(this.scene, s, skateName(a.dir), a.dir === 'left');
      if (a.anim === 'sprint') s.play(s.texture.key);
      else s.stop().setFrame(0);
    }
    s.setPosition(x, y).setDepth(y + 0.1).setVisible(true);
  }

  private renderBlobs(blobs: Blob[]): void {
    const alive = new Set(blobs.map((b) => b.id));
    for (const [id, sp] of this.blobs) {
      if (alive.has(id)) continue;
      sp?.destroy();
      this.blobs.delete(id);
    }
    for (const b of blobs) {
      let sp = this.blobs.get(b.id);
      if (sp === undefined) {
        sp = pivotSprite(this.scene, BLOB_SPRITE[b.kind], 0, 0, this.colorsOf.get(b.owner) ?? {});
        this.blobs.set(b.id, sp);
      }
      if (!sp) continue;
      // The blob flies along the floor; it is drawn a little above and sinks onto its landing spot.
      const ground = Math.round(b.y + ARENA_OFFSET.y);
      const lift = Math.min(BLOB_LIFT, b.left * BLOB_SINK);
      sp.setPosition(Math.round(b.x + ARENA_OFFSET.x), Math.round(ground - lift)).setDepth(ground);
    }
  }

  private renderPickups(pickups: PaintPickup[]): void {
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

  /** The finale bomb drops onto the centre during the fall in its player's colours, its shadow growing below it. */
  private renderFinale(s: PaintState, now: number): void {
    const f = s.finale;
    if (f.phase !== 'fall') {
      this.fallStart = null;
      this.finaleBomb?.setVisible(false);
      this.finaleShadow.setVisible(false);
      return;
    }
    const total = CONFIG.farbkrieg.finaleFallMs;
    this.fallStart ??= now - (total - f.fallLeftMs);
    if (this.finaleBomb && this.bombWho !== f.who) {
      this.bombWho = f.who;
      const colors = (f.who && this.colorsOf.get(f.who)) || NEUTRAL_COLORS;
      swapSprite(this.scene, this.finaleBomb, FINALE_BOMB, false, false, colors);
    }
    const t = Math.min(1, Math.max(0, (now - this.fallStart) / total));
    const x = Math.round(f.x + ARENA_OFFSET.x);
    const ground = Math.round(f.y + ARENA_OFFSET.y);
    // Accelerating fall: it lands at t = 1.
    this.finaleBomb?.setPosition(x, Math.round(ground - FALL_PX * (1 - t * t))).setVisible(true);
    const rx = 4 + 14 * t;
    this.finaleShadow
      .clear()
      .fillStyle(0x3b2418, 0.15 + 0.3 * t)
      .fillEllipse(x, ground, rx * 2, rx)
      .setVisible(true);
  }

  /** Each fx id plays once; ids that left the snapshot are forgotten (they never come back). */
  private renderFx(fx: PaintFx[]): void {
    const current = new Set(fx.map((f) => f.id));
    for (const id of this.fxSeen) if (!current.has(id)) this.fxSeen.delete(id);
    for (const f of fx) {
      if (this.fxSeen.has(f.id)) continue;
      this.fxSeen.add(f.id);
      if (f.kind === 'getuencht' && f.who) {
        // The victim wears the thrower's colour.
        const a = this.avatars.get(f.who);
        if (a) a.splatColors = (f.owner && this.colorsOf.get(f.owner)) || {};
      }
      const name = FX_SPRITE[f.kind];
      if (!name) continue;
      const colors = (f.who && this.colorsOf.get(f.who)) || NEUTRAL_COLORS;
      this.oneShot(pivotSprite(this.scene, name, f.x + ARENA_OFFSET.x, f.y + ARENA_OFFSET.y, colors), FX_DEPTH);
    }
  }

  /** Show a sprite until its animation ends (sprites without one go at once). */
  private oneShot(s: Phaser.GameObjects.Sprite | null, depth: number): void {
    if (!s) return;
    s.setDepth(depth);
    if (!s.anims.isPlaying) {
      s.destroy();
      return;
    }
    this.live.add(s);
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.live.delete(s);
      s.destroy();
    });
  }

  destroy(): void {
    for (const id of LOOPS) sound.loop(id, false);
    for (const b of this.blobs.values()) b?.destroy();
    for (const p of this.pickups.values()) p?.destroy();
    for (const s of this.live) s.destroy();
    for (const o of this.objects) o.destroy();
    this.layer.destroy();
    this.hud.destroy();
    this.blobs.clear();
    this.pickups.clear();
    this.live.clear();
    this.avatars.clear();
  }
}

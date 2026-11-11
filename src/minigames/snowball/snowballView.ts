import Phaser from 'phaser';
import { sound } from '../../audio/sound';
import { CONFIG } from '../../config';
import { Character } from '../../gfx/character';
import { assetsOf, byKey, pivotSprite, playerColor, swapSprite, txt } from '../../game/ui';
import { Reconciler } from '../../net/reconcile';
import { buildArena, tileAt, type Arena, type Solid } from '../common/arena';
import { drawArena } from '../common/arenaView';
import type { Facing } from '../common/shove';
import { drawShoveRing } from '../common/shoveRing';
import type { GamePlayer, InputState, MiniGameView, PlayerKey } from '../types';
import { BALL_LIFT } from './snowballBalls';
import type { Ball, SnowFx, SnowPlayer, SnowState } from './snowballHost';
import { SnowballHud } from './snowballHud';
import { SnowSounds } from './snowballSounds';
import { stepMover, type Mover } from './snowballMove';

export const ARENA_FILE = 'arena-schneeball';
export const ARENA_MAP = 'schneeball.map';
/** Where the map is drawn: world = map + offset (the 416x208 map below the 16 px HUD bar). */
export const ARENA_OFFSET: { readonly x: number; readonly y: number } = { x: 5, y: 26 };

/** Pointer world coordinates to map (simulation) coordinates. */
export const toMap = (x: number, y: number): { x: number; y: number } => ({ x: x - ARENA_OFFSET.x, y: y - ARENA_OFFSET.y });

const SNOW_BG = 0xe8eef4;
const PKG = 'schneeball';
const ROLL_LOOP = `${PKG}.riesenball_rollen_schleife`;
const HIT_ANIM_MS = 300;
const BLINK_MS = 100;
/** Height of the visual arc at mid-flight; it starts and ends on the true path. */
const ARC_PX = 6;
const FX_DEPTH = 900;
const CROSSHAIR_DEPTH = 3000;
const CROSSHAIR_OUTLINE = 0x3b2418;
/** Alpha of the crosshair while the own player cannot throw. */
const CROSSHAIR_DIM = 0.4;
/**
 * Crosshair, 13x13 around the pointer pixel (0, 0): four arms 5 px long and 2 px thick around an
 * empty 3x3 centre. [x, y, w, h] of each arm and of its 1 px outline; the outline leaves the inner
 * end open so the centre gap stays 3x3. With an even thickness inside an odd box the arms sit on
 * pixel rows/columns 0 and 1 (half a pixel off the box centre).
 */
const CROSSHAIR_ARMS: ReadonlyArray<readonly [readonly number[], readonly number[]]> = [
  [[2, 0, 5, 2], [2, -1, 6, 4]],
  [[-6, 0, 5, 2], [-7, -1, 6, 4]],
  [[0, 2, 2, 5], [-1, 2, 4, 6]],
  [[0, -6, 2, 5], [-1, -7, 4, 6]],
];
const BALL_SPRITE: Record<Ball['kind'], string> = {
  normal: 'schnee.ball.flug',
  abpraller: 'schnee.abpraller',
  riesenball: 'schnee.riesenball',
};
const FX_SPRITE: Record<SnowFx['kind'], string> = {
  treffer: 'schnee.treffer',
  zerfall: 'schnee.zerfall',
  abprall: 'schnee.abprall_fx',
  schild_bruch: 'schnee.schild_bruch',
};

type Avatar = {
  char: Character;
  label: Phaser.GameObjects.Text;
  hat: Phaser.GameObjects.Sprite | null;
  anim: string;
  dir: Facing;
  /** Last seen invulnerability: a rise means the player was just hit. */
  invulnMs: number;
  hitUntil: number;
};
type BallView = { ball: Phaser.GameObjects.Sprite | null; shadow: Phaser.GameObjects.Sprite | null };

export class SnowballView implements MiniGameView<SnowState> {
  private readonly arena: Arena;
  private readonly avatars = new Map<PlayerKey, Avatar>();
  private readonly balls = new Map<number, BallView>();
  private readonly pickups = new Map<number, Phaser.GameObjects.Sprite | null>();
  private readonly snowmen = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly snowmanState = new Map<string, string>();
  private readonly fxSeen = new Set<number>();
  private readonly fxLive = new Set<Phaser.GameObjects.Sprite>();
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly hud: SnowballHud;
  /** Shove cooldown ring under the own figure. */
  private readonly ring: Phaser.GameObjects.Graphics;
  /** Own crosshair at the pointer (replaces the hidden system cursor). */
  private readonly crosshair: Phaser.GameObjects.Graphics;
  /** Whether the own player can throw right now (from the last rendered state; dims the crosshair). */
  private canThrow = true;
  /** Own ammo from the last rendered state (a click without a ball clicks empty). */
  private ammo = 1;
  private readonly sounds: SnowSounds;
  private readonly onPress = (p: Phaser.Input.Pointer) => {
    if ((p.button === 0 || p.button === 2) && this.ammo < 1) sound.play(`${PKG}.munition_leer`);
  };
  // Prediction (clients): same scheme as Münzjagd, with the arena movement of the host.
  private readonly reconciler = new Reconciler<Mover>((m, input, dt) => stepMover(m, input, dt, this.arena, this.solids));
  private solids: Solid[];
  private solidsKey = '';
  private target: Mover | null = null;
  private off = { x: 0, y: 0 };
  private lastLatest: SnowState | null = null;
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
    this.solids = this.arena.solids;
    this.objects.push(scene.add.rectangle(0, 0, width, height, SNOW_BG).setOrigin(0).setDepth(-2000));
    this.objects.push(...drawArena(scene, file, ARENA_MAP, ARENA_OFFSET.x, ARENA_OFFSET.y, this.snowmen));
    for (const [key, p] of byKey(players)) {
      const char = new Character(scene, assets, p.look, p.slot);
      const label = txt(scene, 0, 0, p.name, 10, key === selfKey ? '#fff4a8' : '#ffffff');
      const hat = pivotSprite(scene, 'schnee.eiszapfenmuetze.down', 0, 0)?.setVisible(false) ?? null;
      this.avatars.set(key, { char, label, hat, anim: 'idle', dir: 'down', invulnMs: 0, hitUntil: 0 });
      this.objects.push(char, label, ...(hat ? [hat] : []));
    }
    this.ring = scene.add.graphics();
    this.objects.push(this.ring);
    const self = players.find((p) => p.key === selfKey);
    this.crosshair = this.drawCrosshair(self ? playerColor(scene, self.slot) : '#ffffff');
    this.objects.push(this.crosshair);
    this.hud = new SnowballHud(scene, players);
    this.sounds = new SnowSounds(selfKey, (x, y) => tileAt(this.arena, x, y) === 'j');
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPress);
  }

  private drawCrosshair(color: string): Phaser.GameObjects.Graphics {
    const fill = Number.parseInt(color.replace('#', ''), 16);
    const g = this.scene.add.graphics().setDepth(CROSSHAIR_DEPTH).setVisible(false);
    g.fillStyle(CROSSHAIR_OUTLINE, 1);
    for (const [, [x, y, w, h]] of CROSSHAIR_ARMS) g.fillRect(x, y, w, h);
    g.fillStyle(Number.isFinite(fill) ? fill : 0xffffff, 1);
    for (const [[x, y, w, h]] of CROSSHAIR_ARMS) g.fillRect(x, y, w, h);
    return g;
  }

  /** Every frame: crosshair on the pointer's world pixel; dimmed while the own player cannot throw, hidden off the canvas. */
  frame(): void {
    const input = this.scene.input;
    if (!input?.manager || !input.isOver) {
      this.crosshair.setVisible(false);
      return;
    }
    const p = input.activePointer;
    const w = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    this.crosshair
      .setPosition(Math.floor(w.x), Math.floor(w.y))
      .setAlpha(this.canThrow ? 1 : CROSSHAIR_DIM)
      .setVisible(true);
  }

  /** Arena solids without broken snowmen (what the host collides with). */
  private solidsOf(s: SnowState): Solid[] {
    const broken = s.snowmen.filter((m) => m.state === 'kaputt' || m.state === 'aufbau').map((m) => m.id);
    const key = broken.join(',');
    if (key !== this.solidsKey) {
      this.solidsKey = key;
      this.solids = this.arena.solids.filter((x) => !broken.includes(x.id));
    }
    return this.solids;
  }

  predict(input: InputState, dt: number, latest: SnowState | null, ackSeq: number, sentSeq: number): void {
    // A lower seq means a new connection: the host restarted its ack counter.
    if (sentSeq < this.lastSentSeq) this.reconciler.clear();
    this.lastSentSeq = sentSeq;
    // An ack beyond what we sent belongs to the previous connection.
    const ack = ackSeq > sentSeq ? 0 : ackSeq;
    const server = latest?.players[this.selfKey];
    if (!latest || !server) return;
    const fresh = latest !== this.lastLatest;
    this.lastLatest = latest;
    const solids = this.solidsOf(latest);
    const base: Mover = { x: server.x, y: server.y, vx: server.vx, vy: server.vy, dir: server.dir };
    if (server.stun || server.down) {
      // Being shoved or lying after a hit: the host moves us (or not), input does nothing.
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
      const advanced = stepMover(this.target, input, dt, this.arena, solids);
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
    const dir = stepMover(this.target, input, 0, this.arena, solids).dir;
    const keep = 1 - CONFIG.net.predictEase;
    this.off = { x: this.off.x * keep, y: this.off.y * keep };
    if (Math.abs(this.off.x) < 0.01 && Math.abs(this.off.y) < 0.01) this.off = { x: 0, y: 0 };
    this.pred = { ...this.target, x: this.target.x + this.off.x, y: this.target.y + this.off.y, dir };
  }

  render(s: SnowState, selfKey: PlayerKey): void {
    const now = this.scene.time.now;
    for (const [key, a] of this.avatars) {
      const sp = s.players[key];
      if (!sp) continue;
      const p = key === selfKey && this.pred ? { ...sp, ...this.pred } : sp;
      const x = Math.round(p.x + ARENA_OFFSET.x);
      const y = Math.round(p.y + ARENA_OFFSET.y);
      // A rise of the invulnerability without a knockdown = hat-blocked hit: short 'hit' pose.
      if (sp.invulnMs > a.invulnMs) a.hitUntil = now + HIT_ANIM_MS;
      a.invulnMs = sp.invulnMs;
      const moving = Math.hypot(p.vx, p.vy) > 1;
      const anim = sp.down ? 'fall'
        : sp.stun ? 'stumble'
        : now < a.hitUntil ? 'hit'
        : sp.throwAnimMs > 0 || sp.swing ? 'throw'
        : sp.reloading ? 'scoop'
        : moving ? (tileAt(this.arena, p.x, p.y) === 'j' ? 'slip' : 'run')
        : 'idle';
      if (anim !== a.anim || p.dir !== a.dir) {
        a.anim = anim;
        a.dir = p.dir;
        a.char.play(anim, p.dir);
      }
      const alpha = sp.invulnMs > 0 && Math.floor(now / BLINK_MS) % 2 === 0 ? 0.4 : 1;
      a.char.setPosition(x, y).setDepth(y).setAlpha(alpha);
      a.label.setPosition(x, y - 46).setDepth(y + 0.5);
      this.attach(a, a.hat, sp.hat, 'head', `schnee.eiszapfenmuetze.${p.dir === 'left' ? 'side' : p.dir}`, x, y, y + 0.2, alpha);
      if (key === selfKey) drawShoveRing(this.ring, x, y, sp.shoveCdMs);
    }
    const me: SnowPlayer | undefined = s.players[selfKey];
    this.canThrow = !!me && me.balls >= 1 && !me.down && !me.stun && me.strongCdMs <= 0;
    this.ammo = me?.balls ?? 1;
    for (const c of this.sounds.update(s, now)) sound.play(c.name.includes('.') ? c.name : `${PKG}.${c.name}`, c);
    const music = SnowSounds.music(s);
    sound.setMusic(music && `${PKG}.${music}`);
    sound.loop(ROLL_LOOP, SnowSounds.rolling(s));
    this.renderBalls(s.balls);
    this.renderWorld(s);
    this.renderFx(s.fx);
    this.hud.update(s, selfKey);
  }

  /** Hat on a body anchor of the figure (hidden when off or the frame has no anchor). */
  private attach(
    a: Avatar, s: Phaser.GameObjects.Sprite | null, on: boolean, anchor: 'head' | 'hand',
    name: string, x: number, y: number, depth: number, alpha: number,
  ): void {
    if (!s) return;
    const at = on ? a.char.anchor(anchor) : null;
    if (!at) {
      s.setVisible(false);
      return;
    }
    swapSprite(this.scene, s, name, a.dir === 'left');
    s.setPosition(x + at.x, y + at.y).setDepth(depth).setAlpha(alpha).setVisible(true);
  }

  private renderBalls(balls: Ball[]): void {
    const alive = new Set(balls.map((b) => b.id));
    for (const [id, v] of this.balls) {
      if (alive.has(id)) continue;
      v.ball?.destroy();
      v.shadow?.destroy();
      this.balls.delete(id);
    }
    for (const b of balls) {
      let v = this.balls.get(b.id);
      if (!v) {
        v = {
          ball: pivotSprite(this.scene, BALL_SPRITE[b.kind], 0, 0),
          shadow: pivotSprite(this.scene, 'schnee.ball.schatten', 0, 0),
        };
        this.balls.set(b.id, v);
      }
      // The arc is 0 at the throw and at the landing point, so the ball ends exactly on the aim.
      const progress = b.total > 0 ? Math.min(1, Math.max(0, 1 - b.left / b.total)) : 1;
      const lift = Math.sin(Math.PI * progress) * ARC_PX;
      const x = Math.round(b.x + ARENA_OFFSET.x);
      // Shadow on the ground below the path (the path runs BALL_LIFT above the feet line).
      const ground = Math.round(b.y + BALL_LIFT + ARENA_OFFSET.y);
      v.shadow?.setPosition(x, ground).setDepth(ground - 0.5);
      v.ball?.setPosition(x, Math.round(b.y + ARENA_OFFSET.y - lift)).setDepth(ground);
    }
  }

  /** Snowman sprites by state and the pickups. */
  private renderWorld(s: SnowState): void {
    for (const sm of s.snowmen) {
      const sprite = this.snowmen.get(sm.id);
      if (!sprite || this.snowmanState.get(sm.id) === sm.state) continue;
      this.snowmanState.set(sm.id, sm.state);
      // drawArena places objects by their top-left corner; all snowman frames share one size.
      swapSprite(this.scene, sprite, `schnee.solid.schneemann.${sm.state}`, false, true);
    }
    const alive = new Set(s.pickups.map((p) => p.id));
    for (const [id, sp] of this.pickups) {
      if (alive.has(id)) continue;
      sp?.destroy();
      this.pickups.delete(id);
    }
    for (const p of s.pickups) {
      if (this.pickups.has(p.id)) continue;
      const y = p.y + ARENA_OFFSET.y;
      this.pickups.set(p.id, pivotSprite(this.scene, `schnee.pickup.${p.kind}`, p.x + ARENA_OFFSET.x, y)?.setDepth(y) ?? null);
    }
  }

  /** Each fx id plays once; ids that left the snapshot are forgotten (they never come back). */
  private renderFx(fx: SnowFx[]): void {
    const current = new Set(fx.map((f) => f.id));
    for (const id of this.fxSeen) if (!current.has(id)) this.fxSeen.delete(id);
    for (const f of fx) {
      if (this.fxSeen.has(f.id)) continue;
      this.fxSeen.add(f.id);
      const s = pivotSprite(this.scene, FX_SPRITE[f.kind], f.x + ARENA_OFFSET.x, f.y + ARENA_OFFSET.y);
      if (!s) continue;
      s.setDepth(FX_DEPTH);
      this.fxLive.add(s);
      const done = () => {
        this.fxLive.delete(s);
        s.destroy();
      };
      if (s.anims.isPlaying) s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, done);
      else this.scene.time.delayedCall(HIT_ANIM_MS, done);
    }
  }

  destroy(): void {
    sound.loop(ROLL_LOOP, false);
    // On game.destroy() the InputPlugin is already gone (see MinigameScene.wirePointer).
    if (this.scene.input?.manager) this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPress);
    for (const v of this.balls.values()) {
      v.ball?.destroy();
      v.shadow?.destroy();
    }
    for (const p of this.pickups.values()) p?.destroy();
    for (const s of this.fxLive) s.destroy();
    for (const o of this.objects) o.destroy();
    this.hud.destroy();
    this.balls.clear();
    this.pickups.clear();
    this.fxLive.clear();
    this.avatars.clear();
    this.snowmen.clear();
  }
}

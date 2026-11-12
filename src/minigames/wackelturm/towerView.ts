import Phaser from 'phaser';
import { sound } from '../../audio/sound';
import { CONFIG } from '../../config';
import { assetsOf, byKey, pivotSprite, playerColor, swapSprite } from '../../game/ui';
import { zoomOf } from '../../game/zoom';
import { Reconciler } from '../../net/reconcile';
import { drawCrosshair, pointerPixel } from '../common/crosshair';
import type { GamePlayer, InputState, MiniGameView, PlayerKey } from '../types';
import {
  columnAt, craneBounds, predictRot, stepCrane, TurnHistory, type ArmedAction, type TowerFx, type TowerPlayer, type TowerState,
} from './towerHost';
import { BAND_H, HUD_ROWS_BOTTOM, TowerHud } from './towerHud';
import { readLayout, type Plot, type TowerLayout } from './towerLayout';
import { KINDS, shapeSize, type Kind, type Rot } from './towerPhysics';
import { TowerSounds } from './towerSounds';
import { ARENA_FILE, CraneRig, drawBackdrop, readCrane } from './towerScene';

export { ARENA_FILE };
/** Where the 416x208 map sits on screen at rest (columns start at the top band, the ground ends at the bottom). */
export const ARENA_OFFSET: { readonly x: number; readonly y: number } = { x: 5, y: 32 };
/** Emote bubble tail tip: below the bubble (24 px box + 4 px tail) that sits under the HUD rows (name, height, cards). */
const EMOTE_TIP_Y = HUD_ROWS_BOTTOM + 28;
/** The plot cameras: from below the top band to the bottom of the screen. */
const VIEW_TOP = BAND_H;
const VIEW_H = CONFIG.view.height - VIEW_TOP;
/**
 * World layer = simulation + WORLD. A plot camera's viewport starts at VIEW_TOP, so with scrollY 0 a
 * world y lands at VIEW_TOP + y on screen: WORLD.y = ARENA_OFFSET.y − VIEW_TOP puts simulation y at
 * ARENA_OFFSET.y + y for every parallax factor.
 */
const WORLD = { x: ARENA_OFFSET.x, y: ARENA_OFFSET.y - VIEW_TOP };

const PKG = 'wackelturm';
const KRAN_LOOP = `${PKG}.kran_schleife`;
/** Sound loops of the view; stopped in destroy(). */
const LOOPS: readonly string[] = [KRAN_LOOP];

/** Depths inside the world layer (the map's z order: blocks 0.5, fence 1, goal 3, fx 4). */
const HANG_DEPTH = -0.1;
const BLOCK_DEPTH = 0.5;
const FX_DEPTH = 4;
const WIND_DEPTH = 4.5;
/** Debris: four splinters fly this far out and fade. */
const SPLINTER_PX = 14;
const SPLINTER_MS = 450;
const WOBBLE_MS = 500;
const WOBBLE_LIFT = 4;
/** Windstoß sprite (48 wide) centred over the column, at this share of the tower height. */
const WIND_W = 48;
const WIND_MIN_LIFT = 24;
const WIND_HEIGHT_SHARE = 0.6;
const ANGLE_SCALE = 100;
const POS_SCALE = 10;
const STRIDE = 5;
const QUARTER = Math.PI / 2;
/** Tint of a slick hanging block (prank Bananenschale). */
const SLICK_TINT = 0xfff27a;

type Pose = { kind: Kind; x: number; y: number; a: number };
type Column = {
  plot: Plot;
  cam: Phaser.Cameras.Scene2D.Camera;
  crane: CraneRig | null;
  hang: Phaser.GameObjects.Sprite | null;
  hangKind: Kind | null;
  wind: Phaser.GameObjects.Sprite | null;
  /** Bottom centre of the rendered hanging block (the hook while none hangs), world layer coordinates. */
  feet: { x: number; y: number } | null;
};

/** Decoded pose of the block entry at i. */
const poseAt = (f: number[], i: number): Pose => ({
  kind: KINDS[f[i + 1]] ?? 'kurz', x: f[i + 2] / POS_SCALE, y: f[i + 3] / POS_SCALE, a: f[i + 4] / ANGLE_SCALE,
});

/** Half the height of a block's rotated bounding box. */
function halfHeight(kind: Kind, a: number): number {
  const { w, h } = shapeSize(kind, 0);
  return (Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) / 2;
}

/**
 * Wackel-Turm view: one Phaser camera per plot (side by side, each scrolling up with its crane) shows
 * the world layer; the main camera, rendered last, shows the top band, HUD, crosshair and everything
 * the minigame scene adds (LOS, results).
 */
export class TowerView implements MiniGameView<TowerState> {
  private readonly layout: TowerLayout;
  private readonly world: Phaser.GameObjects.Layer;
  private readonly columns = new Map<PlayerKey, Column>();
  private readonly cams: Phaser.Cameras.Scene2D.Camera[] = [];
  private readonly blocks = new Map<number, Phaser.GameObjects.Sprite | null>();
  private readonly fxSeen = new Set<number>();
  private readonly live = new Set<Phaser.GameObjects.GameObject>();
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly hud: TowerHud;
  private readonly sounds: TowerSounds;
  private readonly crosshair: Phaser.GameObjects.Graphics;
  private armed: ArmedAction | null = null;
  private zoom = 0;
  /** Latest rendered state (camera scroll in frame()). */
  private shown: TowerState | null = null;
  // Prediction (clients): the own crane x, stepped like the host with the bounds of the latest own block
  // at its predicted rotation.
  private bounds = { min: 0, max: 0 };
  private readonly reconciler = new Reconciler<number>((x, input, dt) => stepCrane(x, input, dt, this.bounds));
  private target: number | null = null;
  private off = 0;
  private lastLatest: TowerState | null = null;
  private lastSentSeq = 0;
  private pred: number | null = null;
  /** Predicted rotation of the own hanging block (server rotation + turns not acked yet). */
  private readonly turns = new TurnHistory();
  private predRot: Rot | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    players: GamePlayer[],
    private readonly selfKey: PlayerKey,
  ) {
    const file = assetsOf(scene)[ARENA_FILE];
    this.layout = readLayout(file);
    const { width } = CONFIG.view;
    this.world = scene.add.layer();
    const sky = drawBackdrop(scene, file, this.layout, CONFIG.wackelturm.goalPx, this.world, WORLD.x, WORLD.y);
    const shape = readCrane(file, this.layout);

    // Main camera: the margins left and right of the columns and thin lines between them.
    const first = this.layout.plots[0];
    const last = this.layout.plots[this.layout.plots.length - 1];
    const leftW = ARENA_OFFSET.x + first.minX;
    const rightX = ARENA_OFFSET.x + last.maxX;
    const g = scene.add.graphics().setDepth(-1);
    g.fillStyle(0x3b2418, 1).fillRect(0, 0, leftW, CONFIG.view.height).fillRect(rightX, 0, width - rightX, CONFIG.view.height);
    for (const pl of this.layout.plots.slice(1)) g.fillStyle(0x3b2418, 0.6).fillRect(ARENA_OFFSET.x + pl.minX, VIEW_TOP, 1, VIEW_H);
    this.objects.push(g);

    for (let i = 0; i < this.layout.plots.length; i++) {
      const cam = scene.cameras.add(0, 0, 1, 1, false, 'turm');
      if (sky) cam.setBackgroundColor(sky.color);
      this.cams.push(cam);
    }
    // Cameras render in list order: the main camera goes last so the HUD lies on top of the columns.
    const list = scene.cameras.cameras;
    list.push(...list.splice(list.indexOf(scene.cameras.main), 1));

    const sorted = [...byKey(players).entries()].sort((a, b) => a[1].slot - b[1].slot);
    sorted.forEach(([key], i) => {
      const plot = this.layout.plots[i];
      if (!plot) return;
      const crane = new CraneRig(scene, shape, plot, this.world, WORLD.x, WORLD.y);
      this.columns.set(key, { plot, cam: this.cams[i], crane, hang: null, hangKind: null, wind: null, feet: null });
    });

    const self = players.find((p) => p.key === selfKey);
    this.crosshair = drawCrosshair(scene, self ? playerColor(scene, self.slot) : '#ffffff');
    this.objects.push(this.crosshair);
    this.sounds = new TowerSounds(selfKey);
    this.hud = new TowerHud(scene, players, selfKey, this.layout, ARENA_OFFSET.x, VIEW_TOP, VIEW_H);
    this.frame();
  }

  /** Every frame: plot cameras (zoom, viewport, scroll), the camera filters, and the crosshair while armed. */
  frame(): void {
    const z = zoomOf(this.scene);
    const resized = z !== this.zoom;
    this.zoom = z;
    this.cams.forEach((cam, i) => {
      const plot = this.layout.plots[i];
      const x = ARENA_OFFSET.x + plot.minX;
      if (resized) cam.setViewport(x * z, VIEW_TOP * z, this.layout.pitch * z, VIEW_H * z).setOrigin(0, 0).setZoom(z);
      cam.setScroll(x, this.scrollOf(i));
    });
    // Plot cameras show only the world layer; the main camera everything else (also what the scene adds later).
    const plotMask = this.cams.reduce((m, c) => m | c.id, 0);
    const layer: unknown = this.world;
    for (const o of this.scene.children.list) {
      if (o === layer) o.cameraFilter = (o.cameraFilter & ~plotMask) | this.scene.cameras.main.id;
      else o.cameraFilter |= plotMask;
    }
    const w = this.armed ? pointerPixel(this.scene) : null;
    if (w) this.crosshair.setPosition(w.x, w.y).setVisible(true);
    else this.crosshair.setVisible(false);
    // The system cursor stays visible while nothing is armed (the scene hides it for aimed games).
    this.scene.input.setDefaultCursor(this.armed ? 'none' : '');
  }

  /** Scroll of plot camera i: up with its crane (never below the rest position). */
  private scrollOf(i: number): number {
    const s = this.shown;
    if (!s) return 0;
    const p = Object.values(s.players).find((pl) => pl.plot === i);
    return p ? Math.round(Math.min(0, p.hangTop - this.layout.hangTopStart)) : 0;
  }

  predict(input: InputState, dt: number, latest: TowerState | null, ackSeq: number, sentSeq: number): void {
    // A lower seq means a new connection: the host restarted its ack counter.
    if (sentSeq < this.lastSentSeq) {
      this.reconciler.clear();
      this.turns.clear();
    }
    this.lastSentSeq = sentSeq;
    const ack = ackSeq > sentSeq ? 0 : ackSeq;
    const server = latest?.players[this.selfKey];
    const plot = server ? this.layout.plots[server.plot] : undefined;
    if (!latest || !server || !plot) return;
    const fresh = latest !== this.lastLatest;
    this.lastLatest = latest;
    this.turns.record(sentSeq, { cw: input.turnsCw, ccw: input.turnsCcw });
    const acked = this.turns.acked(ack);
    this.predRot = server.hang ? predictRot(server.hang.rot, { cw: input.turnsCw, ccw: input.turnsCcw }, acked) : null;
    this.bounds = server.hang && this.predRot !== null ? craneBounds(plot, server.hang.kind, this.predRot) : { min: plot.minX, max: plot.maxX };
    if (latest.timeLeftMs <= 0 || latest.winner !== null) {
      this.reconciler.clear();
      this.turns.clear();
      this.predRot = null;
      this.target = server.craneX;
      this.off = 0;
      this.pred = server.craneX;
      return;
    }
    this.reconciler.record(sentSeq, input, dt);
    if (this.target === null) {
      this.target = server.craneX;
    } else {
      const advanced = stepCrane(this.target, input, dt, this.bounds);
      if (fresh) {
        const next = this.reconciler.reconcile(server.craneX, ack);
        // Carry the shown position over: a reconcile without error leaves the offset untouched.
        this.off += advanced - next;
        this.target = next;
      } else {
        this.target = advanced;
      }
    }
    this.off *= 1 - CONFIG.net.predictEase;
    if (Math.abs(this.off) < 0.01) this.off = 0;
    this.pred = this.target + this.off;
  }

  render(s: TowerState, selfKey: PlayerKey): void {
    this.shown = s;
    const me = s.players[selfKey];
    this.armed = me?.armed ?? null;
    for (const [key, col] of this.columns) {
      const p = s.players[key];
      if (!p) continue;
      const craneX = key === selfKey && this.pred !== null ? this.pred : p.craneX;
      col.crane?.update(p.hangTop, craneX);
      const rot = key === selfKey && this.predRot !== null ? this.predRot : (p.hang?.rot ?? 0);
      this.renderHang(col, p, craneX, rot);
      this.renderWind(col, p);
    }
    this.renderBlocks(s);
    this.renderFx(s);
    this.renderSound(s);
    const aim = pointerPixel(this.scene);
    this.hud.update(s, this.armed, aim ? columnAt(this.layout, aim.x - ARENA_OFFSET.x) : null);
  }

  private renderSound(s: TowerState): void {
    const now = this.scene.time.now;
    for (const c of this.sounds.update(s, now)) sound.play(`${PKG}.${c.name}`, c);
    const music = TowerSounds.music(s);
    sound.setMusic(music && `${PKG}.${music}`);
    sound.loop(KRAN_LOOP, this.sounds.loops(now).kran && music !== null);
  }

  /** The hanging block below the hook: its top edge at hangTop, its pivot on the crane x. */
  private renderHang(col: Column, p: TowerPlayer, craneX: number, rot: Rot): void {
    const h = p.hang;
    col.feet = { x: Math.round(craneX) + WORLD.x, y: Math.round(p.hangTop + (h ? shapeSize(h.kind, rot).h : 0)) + WORLD.y };
    if (!h) {
      col.hang?.setVisible(false);
      return;
    }
    const name = `block.${h.kind}`;
    if (!col.hang) {
      col.hang = pivotSprite(this.scene, name, 0, 0);
      if (!col.hang) return;
      col.hang.setDepth(HANG_DEPTH);
      this.world.add(col.hang);
    } else if (col.hangKind !== h.kind) {
      swapSprite(this.scene, col.hang, name);
    }
    col.hangKind = h.kind;
    if (h.slick) col.hang.setTint(SLICK_TINT);
    else col.hang.clearTint();
    const half = shapeSize(h.kind, rot).h / 2;
    col.hang
      .setPosition(Math.round(craneX) + WORLD.x, Math.round(p.hangTop + half) + WORLD.y)
      .setRotation(rot * QUARTER)
      .setVisible(true);
  }

  /** Windstoß over the column while it blows (mirrored when it blows to the left). */
  private renderWind(col: Column, p: TowerPlayer): void {
    if (p.windMs <= 0) {
      col.wind?.setVisible(false);
      return;
    }
    if (!col.wind) {
      col.wind = pivotSprite(this.scene, 'turm.wind', 0, 0);
      if (!col.wind) return;
      col.wind.setDepth(WIND_DEPTH);
      this.world.add(col.wind);
    }
    const left = p.windDir < 0;
    swapSprite(this.scene, col.wind, 'turm.wind', left);
    const x = col.plot.centre + (left ? WIND_W / 2 : -WIND_W / 2);
    const y = this.layout.surfaceY - Math.max(WIND_MIN_LIFT, p.heightPx * WIND_HEIGHT_SHARE);
    col.wind.setPosition(Math.round(x) + WORLD.x, Math.round(y) + WORLD.y).setVisible(true);
  }

  /** Block sprites pooled by id at their pose (origin on the pivot = centre, rotated by the body angle). */
  private renderBlocks(s: TowerState): void {
    const alive = new Set<number>();
    for (const p of Object.values(s.players)) {
      const f = p.blocks;
      for (let i = 0; i + STRIDE <= f.length; i += STRIDE) {
        const id = f[i];
        alive.add(id);
        let sp = this.blocks.get(id);
        const pose = poseAt(f, i);
        if (sp === undefined) {
          sp = pivotSprite(this.scene, `block.${pose.kind}`, 0, 0);
          if (sp) this.world.add(sp.setDepth(BLOCK_DEPTH));
          this.blocks.set(id, sp);
        }
        sp?.setPosition(Math.round(pose.x) + WORLD.x, Math.round(pose.y) + WORLD.y).setRotation(pose.a);
      }
    }
    for (const [id, sp] of this.blocks) {
      if (alive.has(id)) continue;
      sp?.destroy();
      this.blocks.delete(id);
    }
  }

  /** Each fx id plays once; ids that left the snapshot are forgotten (they never come back). */
  private renderFx(s: TowerState): void {
    const current = new Set(s.fx.map((f) => f.id));
    for (const id of this.fxSeen) if (!current.has(id)) this.fxSeen.delete(id);
    for (const f of s.fx) {
      if (this.fxSeen.has(f.id)) continue;
      this.fxSeen.add(f.id);
      this.playFx(f, s);
    }
  }

  private playFx(f: TowerFx, s: TowerState): void {
    const x = f.x + WORLD.x;
    const y = f.y + WORLD.y;
    if (f.kind === 'land') {
      const near = this.nearestBlock(s.players[f.who], f.x, f.y);
      const bottom = near ? f.y + halfHeight(near.kind, near.a) : f.y;
      this.oneShot(pivotSprite(this.scene, 'turm.staub_landung', x, Math.round(bottom) + WORLD.y));
    } else if (f.kind === 'ziel') {
      this.oneShot(pivotSprite(this.scene, 'turm.ziel_erreicht', x, y));
    } else if (f.kind === 'wackel') {
      const near = this.nearestBlock(s.players[f.who], f.x, f.y);
      const top = near ? f.y - halfHeight(near.kind, near.a) - WOBBLE_LIFT : f.y;
      this.timed(pivotSprite(this.scene, 'turm.wackeln', x, Math.round(top) + WORLD.y), WOBBLE_MS);
    } else if (f.kind === 'weg') {
      for (let i = 0; i < 4; i++) {
        const sp = pivotSprite(this.scene, `turm.splitter.${i}`, x, y);
        if (!sp) continue;
        const a = (i + 0.5) * QUARTER;
        this.add(sp);
        this.scene.tweens.add({
          targets: sp, x: x + Math.cos(a) * SPLINTER_PX, y: y - Math.sin(a) * SPLINTER_PX, alpha: 0, duration: SPLINTER_MS,
          onComplete: () => this.drop(sp),
        });
      }
    }
  }

  /** The block of p nearest to (x, y) (the one an fx belongs to). */
  private nearestBlock(p: TowerPlayer | undefined, x: number, y: number): Pose | null {
    if (!p) return null;
    let best: Pose | null = null;
    let bestD = Infinity;
    for (let i = 0; i + STRIDE <= p.blocks.length; i += STRIDE) {
      const pose = poseAt(p.blocks, i);
      const d = Math.hypot(pose.x - x, pose.y - y);
      if (d < bestD) {
        bestD = d;
        best = pose;
      }
    }
    return best;
  }

  private add(sp: Phaser.GameObjects.Sprite): void {
    this.world.add(sp.setDepth(FX_DEPTH));
    this.live.add(sp);
  }

  private drop(sp: Phaser.GameObjects.GameObject): void {
    this.live.delete(sp);
    sp.destroy();
  }

  /** Show a sprite until its animation ends (sprites without one go at once). */
  private oneShot(sp: Phaser.GameObjects.Sprite | null): void {
    if (!sp) return;
    if (!sp.anims.isPlaying) {
      sp.destroy();
      return;
    }
    this.add(sp);
    sp.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.drop(sp));
  }

  /** Show a (looping) sprite for ms. */
  private timed(sp: Phaser.GameObjects.Sprite | null, ms: number): void {
    if (!sp) return;
    this.add(sp);
    this.scene.time.delayedCall(ms, () => this.drop(sp));
  }

  /** Wackel-Turm: the column centre just below the HUD rows, so a bubble never covers the name, height or cards. */
  emoteAnchor(key: PlayerKey): { x: number; y: number } | null {
    const col = this.columns.get(key);
    if (!col) return null;
    return { x: Math.round(ARENA_OFFSET.x + (col.plot.minX + col.plot.maxX) / 2), y: EMOTE_TIP_Y };
  }

  /** The hanging block's bottom converted from its plot camera into main-camera coordinates, kept in the column. */
  figureAnchor(key: PlayerKey): { x: number; y: number } | null {
    const col = this.columns.get(key);
    if (!col?.feet) return null;
    const vx = ARENA_OFFSET.x + col.plot.minX;
    const x = vx + (col.feet.x - col.cam.scrollX);
    const y = VIEW_TOP + (col.feet.y - col.cam.scrollY);
    return {
      x: Math.round(Math.min(vx + this.layout.pitch, Math.max(vx, x))),
      y: Math.round(Math.min(CONFIG.view.height, Math.max(VIEW_TOP, y))),
    };
  }

  destroy(): void {
    for (const id of LOOPS) sound.loop(id, false);
    this.scene.tweens.killTweensOf([...this.live]);
    for (const o of this.live) o.destroy();
    this.live.clear();
    for (const sp of this.blocks.values()) sp?.destroy();
    this.blocks.clear();
    for (const cam of this.cams) this.scene.cameras.remove(cam);
    this.cams.length = 0;
    this.columns.clear();
    this.world.destroy();
    for (const o of this.objects) o.destroy();
    this.hud.destroy();
  }
}

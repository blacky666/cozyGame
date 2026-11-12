import Phaser from 'phaser';
import { sound } from '../../audio/sound';
import { CONFIG } from '../../config';
import { mulberry32 } from '../../flow/rng';
import { assetSprite, pivotSprite, txt } from '../../game/ui';
import type { PlayerKey } from '../types';
import type { InputFx } from './prankInput';
import type { PrankCue, PrankFx, PrankSnap } from './pranks';

type Pt = { x: number; y: number };

/**
 * Sound ids of the cues not heard yet (pure): each cue n sounds once for everyone, however often
 * snapshots repeat it. The prankster himself hears `streich.streich_los` before his prank's sound.
 */
export function prankSounds(seen: ReadonlySet<number>, cues: PrankCue[], self: PlayerKey): { sounds: string[]; seen: Set<number> } {
  const next = new Set(seen);
  const sounds: string[] = [];
  for (const c of cues) {
    if (next.has(c.n)) continue;
    next.add(c.n);
    if (c.kind === 'rutsch') sounds.push('streich.bananenschale_rutschen');
    else if (c.kind === 'eis') sounds.push('karte.falle_einfrieren');
    else if (c.kind === 'eis_weg') sounds.push('karte.falle_auftauen');
    else {
      if (c.from === self) sounds.push('streich.streich_los');
      sounds.push(c.kind === 'bananenschale' ? 'streich.bananenschale_ablegen' : `streich.${c.kind}`);
    }
  }
  return { sounds, seen: next };
}

/** Screen-only effects (ink, confetti) of self; nobody else sees them. */
export const screenFx = (fx: PrankFx[], self: PlayerKey): PrankFx[] =>
  fx.filter((f) => f.key === self && (f.kind === 'ink' || f.kind === 'confetti'));

/** The input-relevant effects on self, for the client prediction (maskButtons / InputMask). */
export const ownInputFx = (snap: PrankSnap | null, self: PlayerKey): InputFx[] =>
  (snap?.fx ?? []).filter((f) => f.key === self).map((f) => (f.dir === undefined ? { kind: f.kind } : { kind: f.kind, dir: f.dir }));

const KONFETTI = Array.from({ length: 8 }, (_, i) => `fx.konfetti.${i}`);
const SCHLANGEN = ['fx.papierschlange.0', 'fx.papierschlange.1'];
const INK = ['fx.tinte.overlay.0', 'fx.tinte.overlay.1', 'fx.tinte.overlay.2'];

/** Every sprite the layer draws (besides streich.<id>.icon), checked against the asset files in a test. */
export const PRANK_SPRITES: readonly string[] = [
  'fx.banane.boden', 'fx.rutsch_sterne', 'fx.pupswolke', 'fx.blase.pfrrt', 'fx.verkehrt.pfeile', 'fx.verkehrt.fragezeichen',
  ...INK, 'fx.tinte.flug', 'fx.kanone', ...KONFETTI, ...SCHLANGEN, 'fx.hammer', 'fx.aufprall_sterne', 'fx.blase.quietsch',
  'fx.schwindel', 'ui.taste',
];

/** A head point this far above the feet (figures are about 34 px tall; the name label sits at 46). */
export const HEAD_LIFT = 36;

/** World effects lie below the emote bubbles (3000); the screen effects cover HUD and emotes. */
const WORLD_DEPTH = 2900;
const HUD_DEPTH = 2950;
const SCREEN_DEPTH = 3500;
/** Unarmed bananas are drawn half transparent. */
const UNARMED_ALPHA = 0.5;
/** Procedural ice block (no asset): size above the feet (body and head, ~34 px figures), colours, fade-out at the end. */
const ICE = { w: 20, h: 34, fill: 0xbfe8ff, alpha: 0.55, fadeMs: 300 };
/** Ink: five fixed spots on the 426×240 view, three are used per splash; fade-out at the end. */
const INK_SPOTS: readonly Pt[] = [{ x: 96, y: 72 }, { x: 318, y: 64 }, { x: 212, y: 128 }, { x: 104, y: 182 }, { x: 330, y: 178 }];
const INK_FADE_MS = 400;
/** Confetti: pieces over the whole view, falling speed range, sideways sway, alpha. */
const CONFETTI = { count: 60, minSpeed: 30, maxSpeed: 60, swayPx: 6, swayHz: 1.2, alpha: 0.8, streamerShare: 0.15, fadeMs: 300 };
/** One-shot cue visuals. */
const BUBBLE_MS = 900;
const POP_MS = 700;
const INK_FLIGHT_MS = 300;
/** Own prank HUD: key cap + icon, bottom right but left of the page's fullscreen/sound buttons (x ≥ 385). */
const HUD = { x: 366, y: 229, usedAlpha: 0.35 };
/** Reversed controls arrows sit higher when the stumble stars already circle the head. */
const STACK_PX = 10;

type Obj = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.AlphaSingle
  & Phaser.GameObjects.Components.Visible & Phaser.GameObjects.Components.Depth;
type Lasting = { n: number; obj: Obj | null };
type Piece = { obj: Obj; x0: number; y: number; speed: number; phase: number };
type Screen = { n: number; kind: 'ink' | 'confetti'; objs: Obj[]; pieces: Piece[] };

/**
 * Prank visuals in every minigame (spec §7.2), drawn in main-camera coordinates: bananas, the timed
 * effects on the figures (ice block, dizzy stars, slip stars, reversed arrows), one-shot cue sprites,
 * the screen effects of the local victim (ink, confetti) and the own prank HUD. Sounds per cue.
 */
export class PrankLayer {
  private seen = new Set<number>();
  private readonly bananas = new Map<number, Obj | null>();
  private readonly lasting = new Map<string, Lasting>();
  private readonly screens = new Map<string, Screen>();
  private readonly live = new Set<Obj>();
  private hud: { key: Obj | null; label: Obj; icon: Obj | null; times: Obj; prank: string } | null = null;
  private lastAt: number | null = null;
  private readonly simToWorld: (x: number, y: number) => Pt;

  constructor(private readonly scene: Phaser.Scene, opts: { simToWorld: (x: number, y: number) => Pt }) {
    this.simToWorld = opts.simToWorld;
  }

  update(
    snap: PrankSnap, self: PlayerKey, prankOf: (k: PlayerKey) => string,
    figure: (k: PlayerKey) => Pt | null, head: (k: PlayerKey) => Pt | null,
  ): void {
    const now = this.scene.time.now;
    const dt = this.lastAt === null ? 0 : Math.min(0.1, (now - this.lastAt) / 1000);
    this.lastAt = now;
    const fresh = snap.cues.filter((c) => !this.seen.has(c.n));
    const cues = prankSounds(this.seen, snap.cues, self);
    this.seen = cues.seen;
    for (const id of cues.sounds) sound.play(id);
    for (const c of fresh) this.playCue(c, figure, head);
    this.drawBananas(snap);
    this.drawLasting(snap.fx, figure, head);
    this.drawScreen(screenFx(snap.fx, self), dt, now);
    this.drawHud(snap.left[self], prankOf(self));
  }

  destroy(): void {
    this.scene.tweens.killTweensOf([...this.live]);
    for (const o of this.live) o.destroy();
    this.live.clear();
    for (const b of this.bananas.values()) b?.destroy();
    this.bananas.clear();
    for (const l of this.lasting.values()) l.obj?.destroy();
    this.lasting.clear();
    for (const s of this.screens.values()) for (const o of s.objs) o.destroy();
    this.screens.clear();
    if (this.hud) {
      this.hud.key?.destroy();
      this.hud.label.destroy();
      this.hud.icon?.destroy();
      this.hud.times.destroy();
      this.hud = null;
    }
  }

  /** Only the main camera draws the layer (the Wackel-Turm plot cameras would repeat it). */
  private own<T extends Obj | null>(o: T, depth: number): T {
    if (!o) return o;
    o.setDepth(depth);
    o.cameraFilter = 0x7fffffff & ~this.scene.cameras.main.id;
    return o;
  }

  private drawBananas(snap: PrankSnap): void {
    const alive = new Set<number>();
    for (const b of snap.bananas) {
      alive.add(b.id);
      const at = this.simToWorld(b.x, b.y);
      let sp = this.bananas.get(b.id);
      if (sp === undefined) {
        sp = this.own(pivotSprite(this.scene, 'fx.banane.boden', 0, 0), 0);
        this.bananas.set(b.id, sp);
      }
      // Just below a figure standing on the same spot (figures sort by their feet y).
      sp?.setPosition(Math.round(at.x), Math.round(at.y)).setDepth(at.y - 0.5).setAlpha(b.armed ? 1 : UNARMED_ALPHA);
    }
    for (const [id, sp] of this.bananas) {
      if (alive.has(id)) continue;
      sp?.destroy();
      this.bananas.delete(id);
    }
  }

  /** Effects that last while the fx does, following the figure: ice, dizzy stars, slip stars, arrows. */
  private drawLasting(fx: PrankFx[], figure: (k: PlayerKey) => Pt | null, head: (k: PlayerKey) => Pt | null): void {
    const alive = new Set<string>();
    for (const f of fx) {
      if (f.kind === 'ink' || f.kind === 'confetti') continue;
      const id = `${f.key}:${f.kind}`;
      alive.add(id);
      let l = this.lasting.get(id);
      if (l && l.n !== f.n) {
        l.obj?.destroy();
        l = undefined;
      }
      if (!l) {
        l = { n: f.n, obj: this.makeLasting(f.kind) };
        this.lasting.set(id, l);
      }
      const feet = figure(f.key);
      const top = head(f.key);
      const o = l.obj;
      if (!o) continue;
      if (!feet || !top) {
        o.setVisible(false);
        continue;
      }
      o.setVisible(true);
      if (f.kind === 'frozen') o.setPosition(feet.x, feet.y).setAlpha(Math.min(1, f.leftMs / ICE.fadeMs));
      else if (f.kind === 'slip') o.setPosition(feet.x, feet.y - 2);
      else {
        const stacked = f.kind === 'reverse' && fx.some((g) => g.key === f.key && g.kind === 'stumble');
        o.setPosition(top.x, top.y - (stacked ? STACK_PX : 0));
      }
    }
    for (const [id, l] of this.lasting) {
      if (alive.has(id)) continue;
      l.obj?.destroy();
      this.lasting.delete(id);
    }
  }

  private makeLasting(kind: PrankFx['kind']): Obj | null {
    if (kind === 'frozen') return this.own(this.iceBlock(), WORLD_DEPTH);
    const name = kind === 'stumble' ? 'fx.schwindel' : kind === 'slip' ? 'fx.rutsch_sterne' : kind === 'reverse' ? 'fx.verkehrt.pfeile' : null;
    return name ? this.own(pivotSprite(this.scene, name, 0, 0), WORLD_DEPTH) : null;
  }

  /** Ice block above the feet (origin = feet): translucent blue, white outline, two highlights. */
  private iceBlock(): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    const x = -ICE.w / 2;
    const y = -ICE.h;
    g.fillStyle(ICE.fill, ICE.alpha).fillRect(x, y, ICE.w, ICE.h);
    g.lineStyle(1, 0xffffff, 1).strokeRect(x + 0.5, y + 0.5, ICE.w - 1, ICE.h - 1);
    g.lineStyle(1, 0xffffff, 0.9);
    g.lineBetween(x + 3, y + 10, x + 9, y + 4);
    g.lineBetween(x + 3, y + 19, x + 15, y + 7);
    return g;
  }

  private playCue(c: PrankCue, figure: (k: PlayerKey) => Pt | null, head: (k: PlayerKey) => Pt | null): void {
    const from = c.from ? figure(c.from) : null;
    const fromHead = c.from ? head(c.from) : null;
    const victims = c.to.map((k) => ({ feet: figure(k), top: head(k) }));
    if (c.kind === 'furzkissen') {
      for (const v of victims) {
        if (v.feet) this.oneShot(pivotSprite(this.scene, 'fx.pupswolke', v.feet.x, v.feet.y));
        if (v.top) this.timed(pivotSprite(this.scene, 'fx.blase.pfrrt', v.top.x, v.top.y), BUBBLE_MS);
      }
    } else if (c.kind === 'quietsche_hammer') {
      if (from) this.oneShot(pivotSprite(this.scene, 'fx.hammer', from.x, from.y));
      for (const v of victims) if (v.feet) this.oneShot(pivotSprite(this.scene, 'fx.aufprall_sterne', v.feet.x, v.feet.y - 4));
      if (fromHead) this.timed(pivotSprite(this.scene, 'fx.blase.quietsch', fromHead.x, fromHead.y), BUBBLE_MS);
    } else if (c.kind === 'konfetti_kanone') {
      if (from) this.oneShot(pivotSprite(this.scene, 'fx.kanone', from.x, from.y));
    } else if (c.kind === 'tintenklecks') {
      const to = victims[0]?.top;
      if (from && to) this.fly(pivotSprite(this.scene, 'fx.tinte.flug', from.x, from.y - HEAD_LIFT / 2), to);
    } else if (c.kind === 'verkehrte_welt') {
      for (const v of victims) if (v.top) this.pop(pivotSprite(this.scene, 'fx.verkehrt.fragezeichen', v.top.x, v.top.y - STACK_PX));
    }
  }

  private add(o: Obj): void {
    this.own(o, WORLD_DEPTH);
    this.live.add(o);
  }

  private drop(o: Obj): void {
    this.live.delete(o);
    o.destroy();
  }

  /** Until the animation ends (a sprite without one stays BUBBLE_MS). */
  private oneShot(sp: Phaser.GameObjects.Sprite | null): void {
    if (!sp) return;
    this.add(sp);
    if (sp.anims.isPlaying) sp.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.drop(sp));
    else this.scene.time.delayedCall(BUBBLE_MS, () => this.drop(sp));
  }

  private timed(sp: Phaser.GameObjects.Sprite | null, ms: number): void {
    if (!sp) return;
    this.add(sp);
    this.scene.tweens.add({ targets: sp, alpha: 0, delay: ms * 0.7, duration: ms * 0.3, onComplete: () => this.drop(sp) });
  }

  private fly(sp: Phaser.GameObjects.Sprite | null, to: Pt): void {
    if (!sp) return;
    this.add(sp);
    this.scene.tweens.add({ targets: sp, x: to.x, y: to.y, duration: INK_FLIGHT_MS, onComplete: () => this.drop(sp) });
  }

  private pop(sp: Phaser.GameObjects.Sprite | null): void {
    if (!sp) return;
    this.add(sp);
    sp.setScale(0.2);
    this.scene.tweens.add({ targets: sp, scale: 1, duration: 150, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: sp, alpha: 0, delay: POP_MS - 200, duration: 200, onComplete: () => this.drop(sp) });
  }

  /** The victim's own screen: ink splashes and confetti (by fx n), faded out at the end. */
  private drawScreen(fx: PrankFx[], dt: number, now: number): void {
    const alive = new Set<string>();
    for (const f of fx) {
      const kind = f.kind as 'ink' | 'confetti';
      alive.add(kind);
      let s = this.screens.get(kind);
      if (s && s.n !== f.n) {
        for (const o of s.objs) o.destroy();
        s = undefined;
      }
      if (!s) {
        s = kind === 'ink' ? this.makeInk(f.n) : this.makeConfetti(f.n);
        this.screens.set(kind, s);
      }
      const fade = kind === 'ink' ? INK_FADE_MS : CONFETTI.fadeMs;
      const alpha = Math.min(1, f.leftMs / fade);
      if (kind === 'ink') for (const o of s.objs) o.setAlpha(alpha);
      else this.moveConfetti(s, dt, now, alpha * CONFETTI.alpha);
    }
    for (const [kind, s] of this.screens) {
      if (alive.has(kind)) continue;
      for (const o of s.objs) o.destroy();
      this.screens.delete(kind);
    }
  }

  private makeInk(n: number): Screen {
    const objs: Obj[] = [];
    for (let i = 0; i < 3; i++) {
      const at = INK_SPOTS[(n + i * 2) % INK_SPOTS.length];
      const sp = this.own(pivotSprite(this.scene, INK[(n + i) % INK.length], at.x, at.y), SCREEN_DEPTH);
      if (sp) objs.push(sp);
    }
    return { n, kind: 'ink', objs, pieces: [] };
  }

  private makeConfetti(n: number): Screen {
    const rand = mulberry32(n * 7919 + 1);
    const { width, height } = CONFIG.view;
    const objs: Obj[] = [];
    const pieces: Piece[] = [];
    for (let i = 0; i < CONFETTI.count; i++) {
      const list = rand() < CONFETTI.streamerShare ? SCHLANGEN : KONFETTI;
      const name = list[Math.floor(rand() * list.length)];
      const x0 = rand() * width;
      const y = rand() * height;
      const sp = this.own(assetSprite(this.scene, name, x0, y), SCREEN_DEPTH);
      if (!sp) continue;
      sp.setRotation(rand() * Math.PI);
      objs.push(sp);
      pieces.push({ obj: sp, x0, y, speed: CONFETTI.minSpeed + rand() * (CONFETTI.maxSpeed - CONFETTI.minSpeed), phase: rand() * Math.PI * 2 });
    }
    return { n, kind: 'confetti', objs, pieces };
  }

  /** Falls and sways; a piece below the view comes back at the top. */
  private moveConfetti(s: Screen, dt: number, now: number, alpha: number): void {
    const { height } = CONFIG.view;
    const t = now / 1000;
    for (const p of s.pieces) {
      p.y += p.speed * dt;
      if (p.y > height + 4) p.y -= height + 8;
      const x = p.x0 + Math.sin(t * CONFETTI.swayHz * Math.PI * 2 + p.phase) * CONFETTI.swayPx;
      p.obj.setPosition(Math.round(x), Math.round(p.y)).setAlpha(alpha);
    }
  }

  /** Key cap „F“ + the own prank's icon, „×2“ while two uses are left, greyed when none is. */
  private drawHud(left: number | undefined, prank: string): void {
    if (left === undefined) {
      if (this.hud) for (const o of [this.hud.key, this.hud.label, this.hud.icon, this.hud.times]) o?.setVisible(false);
      return;
    }
    if (!this.hud || this.hud.prank !== prank) {
      if (this.hud) for (const o of [this.hud.key, this.hud.label, this.hud.icon, this.hud.times]) o?.destroy();
      const key = this.own(assetSprite(this.scene, 'ui.taste', HUD.x - 8, HUD.y), HUD_DEPTH);
      const label = this.own(txt(this.scene, HUD.x - 8, HUD.y, 'F', 10), HUD_DEPTH + 1);
      const icon = this.own(assetSprite(this.scene, `streich.${prank}.icon`, HUD.x + 8, HUD.y), HUD_DEPTH);
      const times = this.own(txt(this.scene, HUD.x - 24, HUD.y, '×2', 10), HUD_DEPTH);
      this.hud = { key, label, icon, times, prank };
    }
    const alpha = left > 0 ? 1 : HUD.usedAlpha;
    for (const o of [this.hud.key, this.hud.label, this.hud.icon]) o?.setVisible(true).setAlpha(alpha);
    this.hud.times.setVisible(left >= 2);
  }
}

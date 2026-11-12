import { CONFIG } from '../../config';
import type { PlayerKey } from '../types';
import type { SnowFx, SnowState } from './snowballHost';

import type { Cue } from '../common/cue';

export type { Cue };

const MAP_WIDTH = 416;
/** Stereo spread: the arena edges are this far left/right (not fully, it gets tiring). */
const PAN_SPREAD = 0.6;
/** Other players' sounds are quieter than the own ones. */
const OTHERS = 0.6;
const STEP_MS = 280;
const STEP_OTHERS = 0.5;
const SLIDE_GAP_MS = 700;
/** Last seconds tick (5, 4, 3, 2, 1). */
const TICK_FROM_S = 5;
/** Finale music for the last seconds (the finale loop is ~23 s long). */
export const FINALE_MS = 20000;
/** Gloat on an own hit every this many hits (not on every one; it would get annoying). */
const LAUGH_EVERY = 3;

const FX_SOUND: Record<SnowFx['kind'], string> = {
  treffer: 'treffer_platsch',
  zerfall: 'ball_zerfaellt',
  abprall: 'abpraller',
  schild_bruch: 'eiszapfenmuetze_bruch',
};

const panAt = (x: number): number => Math.max(-1, Math.min(1, (x / MAP_WIDTH) * 2 - 1)) * PAN_SPREAD;

/**
 * Turns successive (rendered) snowball states into sounds. Works from state differences only, so
 * host and clients hear the same events; ids (balls, fx, pickups) make each event play once.
 * The first state only sets the baseline.
 */
export class SnowSounds {
  private prev: SnowState | null = null;
  private prevAt = 0;
  private readonly seenBalls = new Set<number>();
  private readonly seenFx = new Set<number>();
  private readonly stepMs = new Map<PlayerKey, number>();
  private lastSlideAt = -Infinity;
  private ownHits = 0;

  constructor(
    private readonly selfKey: PlayerKey,
    private readonly onIce: (x: number, y: number) => boolean,
  ) {}

  /** Music for this state: normal, finale for the last FINALE_MS, none after the end. */
  static music(s: SnowState): string | null {
    if (s.timeLeftMs <= 0) return null;
    return s.timeLeftMs <= FINALE_MS ? 'musik_schneeball_finale' : 'musik_schneeball';
  }

  /** Whether a giant ball is rolling (the roll loop plays while true). */
  static rolling(s: SnowState): boolean {
    return s.balls.some((b) => b.kind === 'riesenball');
  }

  update(s: SnowState, nowMs: number): Cue[] {
    const prev = this.prev;
    const dt = prev ? Math.max(0, nowMs - this.prevAt) : 0;
    this.prev = s;
    this.prevAt = nowMs;
    const out: Cue[] = [];
    if (!prev) {
      for (const b of s.balls) this.seenBalls.add(b.id);
      for (const f of s.fx) this.seenFx.add(f.id);
      return out;
    }
    const self = this.selfKey;
    const who = (k: PlayerKey) => (k === self ? 1 : OTHERS);

    // Throws: each new ball id once.
    const alive = new Set<number>();
    for (const b of s.balls) {
      alive.add(b.id);
      if (this.seenBalls.has(b.id)) continue;
      this.seenBalls.add(b.id);
      out.push({ name: b.strong ? 'wurf_fest' : 'wurf', volume: who(b.owner), pan: panAt(b.x) });
    }
    for (const id of this.seenBalls) if (!alive.has(id)) this.seenBalls.delete(id);

    // Impacts (fx ids stay in the snapshot for a while; forget ids that left it).
    const fxNow = new Set(s.fx.map((f) => f.id));
    for (const id of this.seenFx) if (!fxNow.has(id)) this.seenFx.delete(id);
    for (const f of s.fx) {
      if (this.seenFx.has(f.id)) continue;
      this.seenFx.add(f.id);
      out.push({ name: FX_SOUND[f.kind], pan: panAt(f.x) });
    }

    // Players.
    for (const [k, p] of Object.entries(s.players)) {
      const q = prev.players[k];
      if (!q) continue;
      const pan = panAt(p.x);
      if (p.down && !q.down) {
        out.push({ name: 'hinfallen', volume: who(k), pan });
        if (k === self) out.push({ name: 'getroffen_autsch', pan });
      }
      if (!p.down && q.down) out.push({ name: 'aufstehen', volume: who(k), pan });
      if (p.swing && !q.swing) out.push({ name: 'aktion.schubsen', volume: who(k), pan });
      if (p.stun && !q.stun) out.push({ name: 'aktion.geschubst', volume: who(k), pan });
      const moving = !p.down && Math.hypot(p.vx, p.vy) > 1;
      const ice = moving && this.onIce(p.x, p.y);
      // Footsteps on snow while walking.
      if (moving && !ice) {
        const acc = (this.stepMs.get(k) ?? STEP_MS) + dt;
        if (acc >= STEP_MS) {
          this.stepMs.set(k, acc % STEP_MS);
          out.push({ name: 'schritt_schnee', volume: k === self ? 1 : STEP_OTHERS, pan });
        } else {
          this.stepMs.set(k, acc);
        }
      } else {
        // The first step after standing comes at once.
        this.stepMs.set(k, STEP_MS);
      }
      if (k !== self) continue;
      // Own player only from here.
      const wasIce = !q.down && Math.hypot(q.vx, q.vy) > 1 && this.onIce(q.x, q.y);
      if (ice && !wasIce && nowMs - this.lastSlideAt >= SLIDE_GAP_MS) {
        this.lastSlideAt = nowMs;
        out.push({ name: 'eis_rutschen', pan });
      }
      if (q.invulnMs > 0 && p.invulnMs <= 0 && !p.down) out.push({ name: 'schutz_ende' });
      if (q.shoveCdMs > 0 && p.shoveCdMs <= 0) out.push({ name: 'aktion.schubs_bereit' });
      if (p.score > q.score) {
        out.push({ name: 'punkte_plus' });
        this.ownHits += 1;
        if (this.ownHits % LAUGH_EVERY === 0) out.push({ name: 'schadenfroh_lachen', delayMs: 250 });
      } else if (p.score < q.score) {
        out.push({ name: 'punkte_minus' });
      }
      if (p.balls > q.balls) out.push({ name: p.balls >= CONFIG.snowball.maxBalls ? 'munition_voll' : 'schnee_aufsammeln' });
      if ((p.extra && p.extra !== q.extra) || (p.hat && !q.hat)) out.push({ name: 'pickup' });
    }

    // Pickups taken by others (the own one already sounded above, louder).
    const me = s.players[self];
    const mePrev = prev.players[self];
    const ownPickup = !!me && !!mePrev && ((!!me.extra && me.extra !== mePrev.extra) || (me.hat && !mePrev.hat));
    const left = prev.pickups.filter((pk) => !s.pickups.some((x) => x.id === pk.id));
    if (left.length > (ownPickup ? 1 : 0)) out.push({ name: 'pickup', volume: OTHERS, pan: panAt(left[left.length - 1].x) });

    // Snowmen.
    for (const sm of s.snowmen) {
      const was = prev.snowmen.find((x) => x.id === sm.id)?.state;
      if (!was || was === sm.state) continue;
      if (sm.state === 'kaputt') out.push({ name: 'schneemann_kaputt' });
      else if (sm.state === 'aufbau') out.push({ name: 'schneemann_aufbau' });
      else if (sm.state === 'schaden1' || sm.state === 'schaden2') out.push({ name: 'schneemann_treffer' });
    }

    // Clock: ticks for the last seconds (whistle and jingle: MinigameScene on shutdown, the scene
    // closes before a state with 0 left is rendered).
    const secBefore = Math.ceil(prev.timeLeftMs / 1000);
    const secNow = Math.ceil(s.timeLeftMs / 1000);
    if (secNow < secBefore && secNow <= TICK_FROM_S && secNow >= 1) {
      out.push({ name: 'countdown_tick' });
    }
    return out;
  }
}

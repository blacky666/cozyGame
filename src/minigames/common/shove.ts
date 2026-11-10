import { CONFIG } from '../../config';
import type { InputState } from '../../net/protocol';
import type { PlayerKey } from '../types';

/** Facing as used by Character ('side' = right). Kept here so host code never imports Phaser. */
export type Facing = 'down' | 'up' | 'side' | 'left';

/** Per-player shove bookkeeping on the host (all times in ms, counting down). */
export type ShoveSlot = {
  /** Highest shove counter already handled (inputs only ever count up). */
  seen: number;
  cooldownMs: number;
  /** > 0 while being pushed away: no steering, sliding along dirX/dirY. */
  stunMs: number;
  immuneMs: number;
  /** > 0 while the own shove animation plays. */
  swingMs: number;
  dirX: number;
  dirY: number;
};

export type ShoveHit = { from: PlayerKey; to: PlayerKey };
type Body = { x: number; y: number; dir: Facing };

const FACING: Record<Facing, readonly [number, number]> = { down: [0, 1], up: [0, -1], side: [1, 0], left: [-1, 0] };
/** Bodies closer than this count as "in front" whatever the facing (they overlap). */
const TOUCH_PX = 4;
/** cos of the half-angle of the shove cone (about +-75 degrees around the facing). */
const CONE_COS = 0.25;

export function newShoveSlot(): ShoveSlot {
  return { seen: 0, cooldownMs: 0, stunMs: 0, immuneMs: 0, swingMs: 0, dirX: 0, dirY: 0 };
}

/**
 * Handle new shove presses. A press always starts the cooldown (a miss costs it too); it lands on
 * the nearest other player in front within reach who is not immune. Players are handled in key
 * order, so of two players shoving each other in the same tick the first one wins.
 */
export function resolveShoves(
  keys: readonly PlayerKey[],
  bodies: Readonly<Record<PlayerKey, Body>>,
  slots: Record<PlayerKey, ShoveSlot>,
  inputs: Readonly<Record<PlayerKey, InputState | undefined>>,
): ShoveHit[] {
  const c = CONFIG.shove;
  const hits: ShoveHit[] = [];
  for (const k of keys) {
    const s = slots[k];
    const n = inputs[k]?.shoves ?? 0;
    if (n <= s.seen) continue;
    s.seen = n;
    if (s.cooldownMs > 0 || s.stunMs > 0) continue;
    s.cooldownMs = c.cooldownMs;
    s.swingMs = c.swingMs;
    const me = bodies[k];
    const [fx, fy] = FACING[me.dir];
    let best: PlayerKey | null = null;
    let bestD = Infinity;
    for (const o of keys) {
      if (o === k || slots[o].immuneMs > 0) continue;
      const dx = bodies[o].x - me.x;
      const dy = bodies[o].y - me.y;
      const d = Math.hypot(dx, dy);
      if (d > c.reachPx || d >= bestD) continue;
      if (d > TOUCH_PX && (dx * fx + dy * fy) / d < CONE_COS) continue;
      best = o;
      bestD = d;
    }
    if (!best) continue;
    const t = slots[best];
    const dx = bodies[best].x - me.x;
    const dy = bodies[best].y - me.y;
    const d = Math.hypot(dx, dy);
    [t.dirX, t.dirY] = d > 0.001 ? [dx / d, dy / d] : [fx, fy];
    t.stunMs = c.stunMs;
    t.immuneMs = c.immuneMs;
    t.swingMs = 0;
    hits.push({ from: k, to: best });
  }
  return hits;
}

/**
 * Advance a slot's timers by dt seconds. Returns the slide of this step: the push starts fast and
 * eases out, adding up to exactly pushPx over stunMs.
 */
export function stepShove(s: ShoveSlot, dt: number): { dx: number; dy: number } {
  const c = CONFIG.shove;
  const ms = dt * 1000;
  let dist = 0;
  if (s.stunMs > 0) {
    const r0 = s.stunMs;
    const r1 = Math.max(0, r0 - ms);
    dist = (c.pushPx * (r0 * r0 - r1 * r1)) / (c.stunMs * c.stunMs);
    s.stunMs = r1;
  }
  s.cooldownMs = Math.max(0, s.cooldownMs - ms);
  s.immuneMs = Math.max(0, s.immuneMs - ms);
  s.swingMs = Math.max(0, s.swingMs - ms);
  return { dx: s.dirX * dist, dy: s.dirY * dist };
}

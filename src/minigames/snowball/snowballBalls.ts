import { CONFIG } from '../../config';
import { segmentHit, type Arena, type Solid } from '../common/arena';
import type { PlayerKey } from '../types';
import type { Ball } from './snowballHost';

/** Balls fly at chest height: this far above the thrower's/victim's feet. */
export const BALL_LIFT = 8;
/** Player hit capsule: vertical segment from feet − BODY_TOP (head) to feet − BODY_BOTTOM (feet). */
export const BODY_TOP = 22;
export const BODY_BOTTOM = 3;
/** Search iterations for the first contact along a ball step (the distance is convex in t). */
const SEARCH_STEPS = 40;

/** A player a ball can hit, at the (possibly rewound) feet position to test against. */
export type BallTarget = { key: PlayerKey; x: number; y: number };

export type BallEvent =
  | { kind: 'player'; victim: PlayerKey; x: number; y: number }
  | { kind: 'solid'; solid: Solid | null; x: number; y: number; normal: 'x' | 'y' }
  | { kind: 'spent'; x: number; y: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Does a ball circle at (x, y) overlap the solid? */
export function ballOverlaps(s: Solid, x: number, y: number): boolean {
  const r = CONFIG.snowball.ballRadius;
  const dx = x - Math.max(s.x, Math.min(x, s.x + s.w));
  const dy = y - Math.max(s.y, Math.min(y, s.y + s.h));
  return dx * dx + dy * dy < r * r;
}

/**
 * Ids of the solids a freshly spawned ball overlaps and flies away from (or along): the ball skips
 * them until it no longer overlaps them. A throw into the overlapped solid still breaks on it.
 */
export function spawnIgnores(x: number, y: number, vx: number, vy: number, solids: Solid[]): string[] {
  const ids: string[] = [];
  for (const s of solids) {
    if (!ballOverlaps(s, x, y)) continue;
    let nx = x - Math.max(s.x, Math.min(x, s.x + s.w));
    let ny = y - Math.max(s.y, Math.min(y, s.y + s.h));
    // Centre inside the rect: push direction is from the rect's centre.
    if (nx === 0 && ny === 0) { nx = x - (s.x + s.w / 2); ny = y - (s.y + s.h / 2); }
    if (nx * vx + ny * vy >= 0) ids.push(s.id);
  }
  return ids;
}

/** Distance from a point to the hit capsule's axis of a player with feet at (fx, fy). */
export function bodyDistance(px: number, py: number, fx: number, fy: number): number {
  const cy = Math.min(fy - BODY_BOTTOM, Math.max(fy - BODY_TOP, py));
  return Math.hypot(px - fx, py - cy);
}

/** Hit reach of a ball: ball radius plus the capsule radius (plus the giant bonus). */
export function hitReach(kind: Ball['kind']): number {
  const c = CONFIG.snowball;
  return c.ballRadius + c.bodyHitRadius + (kind === 'riesenball' ? c.giantExtraRadius : 0);
}

/**
 * First t in 0..1 where the segment (x0, y0) -> (x1, y1) comes within `reach` of the capsule axis
 * of a player with feet at (fx, fy), or null. The distance along a line to a segment is convex,
 * so: minimum by ternary search, then the first crossing by bisection.
 */
export function firstContact(x0: number, y0: number, x1: number, y1: number, fx: number, fy: number, reach: number): number | null {
  const d = (t: number) => bodyDistance(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, fx, fy);
  if (d(0) <= reach) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (d(m1) <= d(m2)) hi = m2; else lo = m1;
  }
  const tMin = (lo + hi) / 2;
  if (d(tMin) > reach && d(1) > reach) return null;
  let a = 0;
  let b = d(tMin) <= reach ? tMin : 1;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const m = (a + b) / 2;
    if (d(m) <= reach) b = m; else a = m;
  }
  return b;
}

/** Speed (px/s) and max flight distance (px) of a left-click (normal) or right-click (strong) throw. */
export function throwPower(strong: boolean): { speed: number; range: number } {
  const c = CONFIG.snowball;
  return strong ? { speed: c.strongSpeed, range: c.strongRange } : { speed: c.normalSpeed, range: c.normalRange };
}

/**
 * Advance a ball by dt seconds (mutates its position and remaining range). Returns what ended
 * the ball this step, or null while it keeps flying. A player in front of a solid wins.
 */
export function advanceBall(b: Ball, dt: number, arena: Arena, solids: Solid[], targets: BallTarget[]): BallEvent | null {
  const c = CONFIG.snowball;
  const speed = Math.hypot(b.vx, b.vy);
  if (!(speed > 0)) return { kind: 'spent', x: b.x, y: b.y };
  const step = Math.min(speed * dt, b.left);
  const ex = b.x + (b.vx / speed) * step;
  const ey = b.y + (b.vy / speed) * step;
  const wall = segmentHit(arena, b.x, b.y, ex, ey, c.ballRadius, solids);
  const stopT = wall ? wall.t : 1;
  const sx = lerp(b.x, ex, stopT);
  const sy = lerp(b.y, ey, stopT);

  // First player touched along the free part of the path (incl. its end, where a ball lands):
  // the ball reaches the vertical capsule over the whole figure.
  const reach = hitReach(b.kind);
  const dx = sx - b.x;
  const dy = sy - b.y;
  let victim: BallTarget | null = null;
  let victimT = Infinity;
  for (const tg of targets) {
    if (tg.key === b.owner) continue;
    const t = firstContact(b.x, b.y, sx, sy, tg.x, tg.y, reach);
    if (t === null || t >= victimT) continue;
    victim = tg;
    victimT = t;
  }
  if (victim) {
    b.x += dx * victimT;
    b.y += dy * victimT;
    return { kind: 'player', victim: victim.key, x: b.x, y: b.y };
  }
  b.x = sx;
  b.y = sy;
  if (wall) return { kind: 'solid', solid: wall.solid, x: b.x, y: b.y, normal: wall.normal };
  b.left -= step;
  return b.left <= 1e-6 ? { kind: 'spent', x: b.x, y: b.y } : null;
}

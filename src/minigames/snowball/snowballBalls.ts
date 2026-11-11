import { CONFIG } from '../../config';
import { segmentHit, type Arena, type Solid } from '../common/arena';
import type { PlayerKey } from '../types';
import type { Ball } from './snowballHost';

/** Balls fly at chest height: this far above the thrower's/victim's feet. */
export const BALL_LIFT = 8;

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

/** Speed (px/s) and range (px) of a throw with the given charge 0..1. */
export function throwPower(charge: number): { speed: number; range: number } {
  const c = CONFIG.snowball;
  const t = Math.min(1, Math.max(0, Number.isFinite(charge) ? charge : 0));
  return { speed: lerp(c.ballSpeed[0], c.ballSpeed[1], t), range: lerp(c.ballRange[0], c.ballRange[1], t) };
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

  // Nearest player along the free part of the path (closest approach within the hit circle).
  const radius = b.kind === 'riesenball' ? c.giantHitRadius : c.hitRadius;
  const dx = sx - b.x;
  const dy = sy - b.y;
  const len2 = dx * dx + dy * dy;
  let victim: BallTarget | null = null;
  let victimT = Infinity;
  for (const tg of targets) {
    if (tg.key === b.owner) continue;
    const cx = tg.x;
    const cy = tg.y - BALL_LIFT;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((cx - b.x) * dx + (cy - b.y) * dy) / len2)) : 0;
    if (Math.hypot(b.x + dx * t - cx, b.y + dy * t - cy) > radius || t >= victimT) continue;
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

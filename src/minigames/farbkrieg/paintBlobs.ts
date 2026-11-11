import { CONFIG } from '../../config';
import { segmentHit, type Arena } from '../common/arena';
import type { PlayerKey } from '../types';
import type { Blob } from './paintHost';

/** A player a blob can hit, at its feet. */
export type BlobTarget = { key: PlayerKey; x: number; y: number };

export type BlobEvent =
  | { kind: 'player'; victim: PlayerKey; x: number; y: number }
  | { kind: 'land'; x: number; y: number };

/** Float slack for the remaining flight distance. */
const EPS = 1e-6;

/**
 * First t in 0..1 where the segment (x0, y0) -> (x1, y1) comes within `reach` of the point (fx, fy),
 * or null. Paint blobs fly along the floor, so this is a plain distance in the floor plane (the
 * Schneeball `firstContact` measures against a capsule above the feet instead).
 */
export function pointContact(x0: number, y0: number, x1: number, y1: number, fx: number, fy: number, reach: number): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const ox = x0 - fx;
  const oy = y0 - fy;
  const c = ox * ox + oy * oy - reach * reach;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (ox * dx + oy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * Advance a blob by dt seconds (mutates its position and remaining flight). Returns what ended the
 * blob this step, or null while it keeps flying. It lands on a wall or at the end of its flight; a
 * player (never the owner) whose feet the path comes within blobHitPx of is hit first.
 */
export function advanceBlob(b: Blob, dt: number, arena: Arena, targets: BlobTarget[]): BlobEvent | null {
  const c = CONFIG.farbkrieg;
  const speed = Math.hypot(b.vx, b.vy);
  if (!(speed > 0)) return { kind: 'land', x: b.x, y: b.y };
  const step = Math.min(speed * dt, b.left);
  const ex = b.x + (b.vx / speed) * step;
  const ey = b.y + (b.vy / speed) * step;
  const wall = segmentHit(arena, b.x, b.y, ex, ey, c.blobRadius);
  const stopT = wall ? wall.t : 1;
  const sx = b.x + (ex - b.x) * stopT;
  const sy = b.y + (ey - b.y) * stopT;

  let victim: BlobTarget | null = null;
  let victimT = Infinity;
  for (const tg of targets) {
    if (tg.key === b.owner) continue;
    const t = pointContact(b.x, b.y, sx, sy, tg.x, tg.y, c.blobHitPx);
    if (t === null || t >= victimT) continue;
    victim = tg;
    victimT = t;
  }
  if (victim) {
    b.x += (sx - b.x) * victimT;
    b.y += (sy - b.y) * victimT;
    return { kind: 'player', victim: victim.key, x: b.x, y: b.y };
  }
  b.x = sx;
  b.y = sy;
  if (wall) return { kind: 'land', x: b.x, y: b.y };
  b.left -= step;
  return b.left <= EPS ? { kind: 'land', x: b.x, y: b.y } : null;
}

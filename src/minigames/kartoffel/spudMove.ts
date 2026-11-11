import { CONFIG } from '../../config';
import type { InputState } from '../../net/protocol';
import { moveCircle, type Arena } from '../common/arena';
import type { Facing } from '../common/shove';
import type { Mover } from '../snowball/snowballMove';

/**
 * One walking step at `speed` px/s (no ice), shared by the host simulation and the client
 * prediction. Same math as the non-ice branch of the Schneeball `stepMover`.
 */
export function stepWalker(m: Mover, input: InputState, dt: number, arena: Arena, speed: number): Mover {
  let ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let iy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(ix, iy);
  const dir: Facing = ix > 0 ? 'side' : ix < 0 ? 'left' : iy < 0 ? 'up' : iy > 0 ? 'down' : m.dir;
  if (len > 0) { ix /= len; iy /= len; }
  let vx = ix * speed;
  let vy = iy * speed;
  if (!Number.isFinite(vx)) vx = 0;
  if (!Number.isFinite(vy)) vy = 0;
  const r = moveCircle(arena, m.x, m.y, vx * dt, vy * dt, CONFIG.kartoffel.bodyRadius);
  return { x: r.x, y: r.y, vx: r.hitX ? 0 : vx, vy: r.hitY ? 0 : vy, dir };
}

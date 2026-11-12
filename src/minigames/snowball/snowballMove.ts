import { CONFIG } from '../../config';
import type { InputState } from '../../net/protocol';
import { moveCircle, tileAt, type Arena, type Solid } from '../common/arena';
import type { Facing } from '../common/shove';

import type { Mover } from '../common/mover';

export type { Mover };

/**
 * One movement step, shared by the host simulation and the client prediction. On snow/path the
 * velocity follows the input directly; on the frozen pond it accelerates and slides with friction.
 * `solids` defaults to all arena solids (the host passes the list without broken snowmen).
 */
export function stepMover(m: Mover, input: InputState, dt: number, arena: Arena, solids: Solid[] = arena.solids): Mover {
  const c = CONFIG.snowball;
  let ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let iy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(ix, iy);
  const dir: Facing = ix > 0 ? 'side' : ix < 0 ? 'left' : iy < 0 ? 'up' : iy > 0 ? 'down' : m.dir;
  if (len > 0) { ix /= len; iy /= len; }
  let { vx, vy } = m;
  if (tileAt(arena, m.x, m.y) === 'j') {
    vx = (vx + ix * c.iceAccel * dt) * (1 - c.iceFriction * dt);
    vy = (vy + iy * c.iceAccel * dt) * (1 - c.iceFriction * dt);
    const speed = Math.hypot(vx, vy);
    const max = c.walkSpeed * 1.5;
    if (speed > max) { vx *= max / speed; vy *= max / speed; }
  } else {
    vx = ix * c.walkSpeed;
    vy = iy * c.walkSpeed;
  }
  if (!Number.isFinite(vx)) vx = 0;
  if (!Number.isFinite(vy)) vy = 0;
  const r = moveCircle(arena, m.x, m.y, vx * dt, vy * dt, c.bodyRadius, solids);
  return { x: r.x, y: r.y, vx: r.hitX ? 0 : vx, vy: r.hitY ? 0 : vy, dir };
}

import { CONFIG } from '../../config';
import type { InputState } from '../../net/protocol';
import { moveCircle, type Arena } from '../common/arena';
import type { Facing } from '../common/shove';
import type { Mover } from '../common/mover';

/**
 * One walking step at `speed` px/s (no ice), shared by the host simulation and the client
 * prediction. Same math as the non-ice branch of the Schneeball `stepMover`.
 */
export function stepWalker(
  m: Mover, input: InputState, dt: number, arena: Arena, speed: number, radius: number = CONFIG.kartoffel.bodyRadius,
): Mover {
  let ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let iy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(ix, iy);
  const dir: Facing = ix > 0 ? 'side' : ix < 0 ? 'left' : iy < 0 ? 'up' : iy > 0 ? 'down' : m.dir;
  if (len > 0) { ix /= len; iy /= len; }
  let vx = ix * speed;
  let vy = iy * speed;
  if (!Number.isFinite(vx)) vx = 0;
  if (!Number.isFinite(vy)) vy = 0;
  const r = moveCircle(arena, m.x, m.y, vx * dt, vy * dt, radius);
  return { x: r.x, y: r.y, vx: r.hitX ? 0 : vx, vy: r.hitY ? 0 : vy, dir };
}

/** Client-side guess of the own sprint, before the host state confirms it. */
export type SprintGuess = { taps: number | null; leftMs: number };
export const NO_SPRINT_GUESS: SprintGuess = { taps: null, leftMs: 0 };

/**
 * Sprint prediction step (mirrors the host's sprint tap): a rising `primaryTaps` counter starts a
 * local sprint of sprintMs when the latest own state allows it (no cooldown, not stunned, no ghost).
 * The guess runs down by `dtMs` and ends once the own state shows the sprint (the host took over)
 * or its time runs out. A dropping counter (new connection) only re-bases.
 */
export function guessSprint(
  g: SprintGuess,
  taps: number,
  own: { sprintMs: number; sprintCdMs: number; stun: boolean; ghost: boolean },
  dtMs: number,
): SprintGuess {
  const rose = g.taps !== null && taps > g.taps;
  if (own.sprintMs > 0) return { taps, leftMs: 0 };
  if (rose && g.leftMs <= 0 && own.sprintCdMs <= 0 && !own.stun && !own.ghost) {
    return { taps, leftMs: CONFIG.kartoffel.sprintMs };
  }
  return { taps, leftMs: Math.max(0, g.leftMs - dtMs) };
}

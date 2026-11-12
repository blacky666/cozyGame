import type { Facing } from './shove';

/** Position (feet), velocity in px/s and facing of a walking body (shared by all top-down games). */
export type Mover = { x: number; y: number; vx: number; vy: number; dir: Facing };

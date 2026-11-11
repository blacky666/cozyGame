import { CONFIG } from '../../config';
import { buildArena } from '../common/arena';
import type { MiniGame, PlayerKey } from '../types';
import { createSnowballHost, type Ball, type SnowPlayer, type SnowState } from './snowballHost';
import { ARENA_FILE, ARENA_MAP, ARENA_OFFSET, SnowballView } from './snowballView';

/** Snapshot interpolation: players and balls (by id) move, everything else comes from `b`. */
export function lerpSnow(a: SnowState, b: SnowState, t: number): SnowState {
  const players: Record<PlayerKey, SnowPlayer> = {};
  for (const [k, pb] of Object.entries(b.players)) {
    const pa = a.players[k];
    players[k] = pa ? { ...pb, x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t } : { ...pb };
  }
  const before = new Map(a.balls.map((x) => [x.id, x]));
  const balls: Ball[] = b.balls.map((bb) => {
    const ba = before.get(bb.id);
    return ba ? { ...bb, x: ba.x + (bb.x - ba.x) * t, y: ba.y + (bb.y - ba.y) * t } : { ...bb };
  });
  return { ...b, players, balls };
}

export const snowball: MiniGame<SnowState> = {
  id: 'schneeball',
  title: 'Schneeball-Schlacht',
  rule: 'Triff die anderen! Treffer +2, getroffen −1.',
  controls: 'WASD laufen · Maus zielen · Klick werfen (halten = stärker) · Leertaste schubsen',
  durationMs: CONFIG.snowball.durationMs,
  aimOffset: ARENA_OFFSET,
  createHost: (players, rand, opts) => {
    const file = opts?.assets?.[ARENA_FILE];
    if (!file) throw new Error(`schneeball: assets missing (${ARENA_FILE}); pass opts.assets to createHost`);
    return createSnowballHost(players, rand, buildArena(file, ARENA_MAP), opts?.durationMs ?? CONFIG.snowball.durationMs);
  },
  createView: (scene, players, selfKey) => new SnowballView(scene, players, selfKey),
  lerp: lerpSnow,
};

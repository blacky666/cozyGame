import { CONFIG } from '../../config';
import { buildArena } from '../common/arena';
import type { BotView, MiniGame, PlayerKey } from '../types';
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

/** Keep this far from the nearest opponent while shooting. */
const BOT_DISTANCE = 60;
/** Keep-distance targets stay inside the fence (map coordinates). */
const BOT_BOUNDS = { minX: 16, maxX: 400, minY: 52, maxY: 188 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Bots reload while standing still; with ammo they hold a distance from the nearest opponent and aim at it. */
export function snowballBotView(s: SnowState, key: PlayerKey): BotView | null {
  const me = s.players[key];
  if (!me) return null;
  const self = { x: me.x, y: me.y };
  if (me.balls < 1) return { self, targets: [], idle: true };
  let near: SnowPlayer | null = null;
  let nearD = Infinity;
  for (const [k, p] of Object.entries(s.players)) {
    if (k === key) continue;
    const d = Math.hypot(p.x - me.x, p.y - me.y);
    if (d < nearD) { near = p; nearD = d; }
  }
  if (!near) return { self, targets: [], idle: true };
  const d = nearD || 1;
  const target = {
    x: clamp(near.x - ((near.x - me.x) / d) * BOT_DISTANCE, BOT_BOUNDS.minX, BOT_BOUNDS.maxX),
    y: clamp(near.y - ((near.y - me.y) / d) * BOT_DISTANCE, BOT_BOUNDS.minY, BOT_BOUNDS.maxY),
  };
  return { self, targets: [target], aim: { x: near.x, y: near.y } };
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
  botView: snowballBotView,
};

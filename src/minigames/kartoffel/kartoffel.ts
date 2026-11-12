import { CONFIG } from '../../config';
import { buildArena } from '../common/arena';
import type { BotView, MiniGame, PlayerKey } from '../types';
import { createSpudHost, type SpudPlayer, type SpudState } from './spudHost';
import { ARENA_FILE, ARENA_MAP, ARENA_OFFSET, SpudView } from './spudView';

/** Snapshot interpolation: players move, everything else (potatoes, pickups, fx, phase) comes from `b`. */
export function lerpSpud(a: SpudState, b: SpudState, t: number): SpudState {
  const players: Record<PlayerKey, SpudPlayer> = {};
  for (const [k, pb] of Object.entries(b.players)) {
    const pa = a.players[k];
    players[k] = pa ? { ...pb, x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t } : { ...pb };
  }
  return { ...b, players };
}

/** Non-holders run to a point at least this far from the nearest holder. */
const BOT_FLEE = 60;
/** Bot targets stay inside the garden fence (map coordinates): the map minus the fence margin. */
const BOT_BOUNDS = (() => {
  const { mapW, mapH, botMarginPx: m } = CONFIG.kartoffel;
  return { minX: m, maxX: mapW - m, minY: m, maxY: mapH - m };
})();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Nearest living player (other than `key`) passing `ok`, with its distance. */
function nearest(s: SpudState, key: PlayerKey, ok: (k: PlayerKey) => boolean): { p: SpudPlayer; d: number } | null {
  const me = s.players[key];
  let best: { p: SpudPlayer; d: number } | null = null;
  for (const [k, p] of Object.entries(s.players)) {
    if (k === key || p.ghost || !ok(k)) continue;
    const d = Math.hypot(p.x - me.x, p.y - me.y);
    if (!best || d < best.d) best = { p, d };
  }
  return best;
}

/**
 * Bots holding a potato chase the nearest living non-holder (not the one their potato cannot go back
 * to yet); the others run away from the nearest holder to a point max(BOT_FLEE, current distance)
 * from it, so a far bot never walks toward it. Ghosts and the pause/done phases idle.
 */
export function spudBotView(s: SpudState, key: PlayerKey): BotView | null {
  const me = s.players[key];
  if (!me) return null;
  const self = { x: me.x, y: me.y };
  const idle: BotView = { self, targets: [], idle: true };
  if (me.ghost || s.phase !== 'play') return idle;
  const holders = new Set(s.potatoes.map((p) => p.holder));
  if (holders.has(key)) {
    const blocked = new Set(
      s.potatoes.filter((p) => p.holder === key && p.noBackMs > 0 && p.noBackFrom).map((p) => p.noBackFrom),
    );
    const prey = nearest(s, key, (k) => !holders.has(k) && !blocked.has(k));
    return prey ? { self, targets: [{ x: prey.p.x, y: prey.p.y }] } : idle;
  }
  const hunter = nearest(s, key, (k) => holders.has(k));
  if (!hunter) return idle;
  // Standing exactly on the holder: flee to the right.
  const ux = hunter.d > 0 ? (me.x - hunter.p.x) / hunter.d : 1;
  const uy = hunter.d > 0 ? (me.y - hunter.p.y) / hunter.d : 0;
  const dist = Math.max(BOT_FLEE, hunter.d);
  const target = {
    x: clamp(hunter.p.x + ux * dist, BOT_BOUNDS.minX, BOT_BOUNDS.maxX),
    y: clamp(hunter.p.y + uy * dist, BOT_BOUNDS.minY, BOT_BOUNDS.maxY),
  };
  return { self, targets: [target] };
}

export const kartoffel: MiniGame<SpudState> = {
  id: 'kartoffel',
  title: 'Heiße Kartoffel',
  rule: 'Gib die Kartoffel durch Berühren weiter – wer sie beim Knall hält, fliegt raus!',
  controls: 'WASD laufen · Linksklick sprinten · Leertaste schubsen · F Streich',
  durationMs: null,
  // Pointer in simulation coordinates for the pranks' aim; no crosshair, the system cursor stays.
  aimOffset: ARENA_OFFSET,
  systemCursor: true,
  sounds: 'kartoffel',
  createHost: (players, rand, opts) => {
    const file = opts?.assets?.[ARENA_FILE];
    if (!file) throw new Error(`kartoffel: assets missing (${ARENA_FILE}); pass opts.assets to createHost`);
    return createSpudHost(players, rand, buildArena(file, ARENA_MAP, { wallChar: null }), { leaders: opts?.leaders, card: opts?.card });
  },
  createView: (scene, players, selfKey) => new SpudView(scene, players, selfKey),
  lerp: lerpSpud,
  botView: spudBotView,
};

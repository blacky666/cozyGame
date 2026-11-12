import { CONFIG } from '../../config';
import { buildArena } from '../common/arena';
import type { BotView, MiniGame, PlayerKey } from '../types';
import { createGrid, PAINT_TILE as TILE } from './paintGrid';
import { createPaintHost, type Blob, type PaintPlayer, type PaintState } from './paintHost';
import { ARENA_FILE, ARENA_MAP, ARENA_OFFSET, PaintView } from './paintView';

/** Snapshot interpolation: players and blobs (by id, incl. their remaining flight) move; grid, pickups, fx and finale come from `b`. */
export function lerpPaint(a: PaintState, b: PaintState, t: number): PaintState {
  const players: Record<PlayerKey, PaintPlayer> = {};
  for (const [k, pb] of Object.entries(b.players)) {
    const pa = a.players[k];
    players[k] = pa ? { ...pb, x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t } : { ...pb };
  }
  const before = new Map(a.blobs.map((x) => [x.id, x]));
  const blobs: Blob[] = b.blobs.map((bb) => {
    const ba = before.get(bb.id);
    return ba
      ? { ...bb, x: ba.x + (bb.x - ba.x) * t, y: ba.y + (bb.y - ba.y) * t, left: ba.left + (bb.left - ba.left) * t }
      : { ...bb };
  });
  return { ...b, players, blobs };
}

/**
 * Paint bots: walk to the nearest tile that is not their own (foreign tiles first, then neutral ones,
 * inside botMarginPx of the map edges, never one under another player). With the Klecks ready and a foreign tile within blobRange
 * they throw at the foreign tile in range with the most foreign tiles inside klecksPaintR; a held
 * extra is used at once (same aim, else at the walking target). Idle once the time is up.
 * `paintable` marks the floor tiles (walls and furniture are never targets); without it every tile counts.
 */
export function paintBotView(s: PaintState, key: PlayerKey, paintable?: Uint8Array): BotView | null {
  const me = s.players[key];
  if (!me) return null;
  const self = { x: me.x, y: me.y };
  if (s.timeLeftMs <= 0) return { self, targets: [], idle: true };
  const c = CONFIG.farbkrieg;
  const cols = Math.round(c.mapW / TILE);
  const rows = Math.round(c.mapH / TILE);
  if (s.grid.length !== cols * rows) return { self, targets: [] };
  const own = Number(key.slice(1)) + 1;
  const ownerOf = (i: number) => {
    const v = s.grid.charCodeAt(i) - 48;
    return v >= 1 && v <= 4 && (!paintable || paintable[i] === 1) ? v : 0;
  };
  const isForeign = (i: number) => {
    const o = ownerOf(i);
    return o !== 0 && o !== own;
  };
  const cx = (i: number) => (i % cols) * TILE + TILE / 2;
  const cy = (i: number) => Math.floor(i / cols) * TILE + TILE / 2;
  const m = c.botMarginPx;
  // A tile under another player's feet gets repainted at once: walking there would park the bot on it.
  const occupied = new Set<number>();
  for (const [k, p] of Object.entries(s.players)) {
    if (k === key) continue;
    const col = Math.floor(p.x / TILE);
    const row = Math.floor(p.y / TILE);
    if (col >= 0 && row >= 0 && col < cols && row < rows) occupied.add(row * cols + col);
  }

  let foreign: { i: number; d: number } | null = null;
  let neutral: { i: number; d: number } | null = null;
  const inRange: { i: number; d: number }[] = [];
  for (let i = 0; i < cols * rows; i++) {
    if (paintable && paintable[i] !== 1) continue;
    const o = ownerOf(i);
    if (o === own) continue;
    const d = Math.hypot(cx(i) - me.x, cy(i) - me.y);
    if (o !== 0 && d <= c.blobRange) inRange.push({ i, d });
    if (occupied.has(i) || cx(i) < m || cx(i) > c.mapW - m || cy(i) < m || cy(i) > c.mapH - m) continue;
    if (o !== 0) {
      if (!foreign || d < foreign.d) foreign = { i, d };
    } else if (!neutral || d < neutral.d) {
      neutral = { i, d };
    }
  }
  const goal = foreign ?? neutral;
  const targets = goal ? [{ x: cx(goal.i), y: cy(goal.i) }] : [];

  // Best splash spot: most foreign tiles within klecksPaintR (ties: the nearer one).
  const reach = Math.ceil(c.klecksPaintR / TILE);
  let best: { i: number; d: number; n: number } | null = null;
  for (const { i, d } of inRange) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    let n = 0;
    for (let r = Math.max(0, row - reach); r <= Math.min(rows - 1, row + reach); r++) {
      for (let cc = Math.max(0, col - reach); cc <= Math.min(cols - 1, col + reach); cc++) {
        const j = r * cols + cc;
        if (isForeign(j) && Math.hypot(cx(j) - cx(i), cy(j) - cy(i)) <= c.klecksPaintR) n++;
      }
    }
    if (!best || n > best.n || (n === best.n && d < best.d)) best = { i, d, n };
  }
  const aim = best ? { x: cx(best.i), y: cy(best.i) } : null;

  if (me.extra !== null) return { self, targets, aim: aim ?? targets[0] ?? self, fire: 'secondary' };
  if (me.klecksCdMs <= 0 && aim) return { self, targets, aim, fire: 'primary' };
  return { self, targets };
}

/** Floor tiles of the arena of the last host created here (bots only run on the host). */
let botPaintable: Uint8Array | undefined;

export const farbkrieg: MiniGame<PaintState> = {
  id: 'farbkrieg',
  title: 'Farbkrieg',
  rule: 'Färbe den Boden in deiner Farbe – am Ende zählt die Fläche!',
  controls: 'WASD laufen · Maus zielen · Linksklick Klecks · Rechtsklick Extra · Leertaste schubsen',
  durationMs: CONFIG.farbkrieg.durationMs,
  aimOffset: ARENA_OFFSET,
  sounds: 'farbkrieg',
  createHost: (players, rand, opts) => {
    const file = opts?.assets?.[ARENA_FILE];
    if (!file) throw new Error(`farbkrieg: assets missing (${ARENA_FILE}); pass opts.assets to createHost`);
    const arena = buildArena(file, ARENA_MAP);
    botPaintable = createGrid(arena).paintable;
    return createPaintHost(players, rand, arena, opts?.durationMs ?? CONFIG.farbkrieg.durationMs, { card: opts?.card });
  },
  createView: (scene, players, selfKey) => new PaintView(scene, players, selfKey),
  lerp: lerpPaint,
  botView: (s, key) => paintBotView(s, key, botPaintable),
};

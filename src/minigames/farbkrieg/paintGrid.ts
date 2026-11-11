import type { Arena } from '../common/arena';
import type { PlayerKey } from '../types';

/** Owner 0 is neutral; 1-4 are slot+1. `count` is the number of paintable tiles. */
export type Grid = { cols: number; rows: number; tile: number; owner: Uint8Array; paintable: Uint8Array; count: number };

/** Tile size of the Farbkrieg map (px): the grid is mapW/PAINT_TILE x mapH/PAINT_TILE (a test checks the map file). */
export const PAINT_TILE = 16;

/** Spawn point per slot (px). */
export const PAINT_SPAWNS: [number, number][] = [[40, 72], [376, 72], [48, 184], [368, 184]];

/** Paint pattern per slot (colour-blind friendly: the pattern tells players apart). */
export const MUSTER = ['punkte', 'streifen', 'karo', 'linien'] as const;

/** A tile is paintable when its centre is not inside any solid rect. */
export function createGrid(arena: Arena): Grid {
  const tile = arena.tile;
  const cols = Math.floor(arena.w / tile);
  const rows = Math.floor(arena.h / tile);
  const paintable = new Uint8Array(cols * rows);
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = c * tile + tile / 2;
      const cy = r * tile + tile / 2;
      const blocked = arena.solids.some((s) => cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h);
      if (!blocked) { paintable[r * cols + c] = 1; count++; }
    }
  }
  return { cols, rows, tile, owner: new Uint8Array(cols * rows), paintable, count };
}

export function tileIndex(g: Grid, x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const c = Math.floor(x / g.tile);
  const r = Math.floor(y / g.tile);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return null;
  return r * g.cols + c;
}

export function paintTile(g: Grid, i: number, owner: number): boolean {
  if (i < 0 || i >= g.owner.length || !g.paintable[i] || g.owner[i] === owner) return false;
  g.owner[i] = owner;
  return true;
}

/** Paints all paintable tiles whose centre is within r of (x, y); returns the changed count. */
export function paintDisc(g: Grid, x: number, y: number, r: number, owner: number): number {
  const t = g.tile;
  const c0 = Math.max(0, Math.floor((x - r) / t));
  const c1 = Math.min(g.cols - 1, Math.floor((x + r) / t));
  const r0 = Math.max(0, Math.floor((y - r) / t));
  const r1 = Math.min(g.rows - 1, Math.floor((y + r) / t));
  let n = 0;
  for (let row = r0; row <= r1; row++) {
    for (let c = c0; c <= c1; c++) {
      const dx = c * t + t / 2 - x;
      const dy = row * t + t / 2 - y;
      if (dx * dx + dy * dy <= r * r && paintTile(g, row * g.cols + c, owner)) n++;
    }
  }
  return n;
}

export function encodeGrid(g: Grid): string {
  let s = '';
  for (let i = 0; i < g.owner.length; i++) s += g.owner[i];
  return s;
}

export function decodeGrid(s: string, into: Grid): void {
  for (let i = 0; i < into.owner.length; i++) {
    const v = s.charCodeAt(i) - 48;
    into.owner[i] = into.paintable[i] && v >= 0 && v <= 4 ? v : 0;
  }
}

/** Same-owner neighbours as a bitmask N=1, E=2, S=4, W=8; outside / non-paintable neighbours count as different. */
export function edgeMask(g: Grid, i: number): number {
  const c = i % g.cols;
  const r = Math.floor(i / g.cols);
  const same = (nc: number, nr: number) => {
    if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) return false;
    const j = nr * g.cols + nc;
    return g.paintable[j] === 1 && g.owner[j] === g.owner[i];
  };
  return (same(c, r - 1) ? 1 : 0) | (same(c + 1, r) ? 2 : 0) | (same(c, r + 1) ? 4 : 0) | (same(c - 1, r) ? 8 : 0);
}

/** Tiles per owner, index 0..4. */
export function tileCounts(g: Grid): number[] {
  const out = [0, 0, 0, 0, 0];
  for (let i = 0; i < g.owner.length; i++) if (g.paintable[i]) out[g.owner[i]]++;
  return out;
}

/** Groups of keys by descending count; equal counts share a group. */
export function rankByCount(counts: Record<PlayerKey, number>): PlayerKey[][] {
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const groups: PlayerKey[][] = [];
  for (const k of keys) {
    const last = groups[groups.length - 1];
    if (last && counts[last[0]] === counts[k]) last.push(k);
    else groups.push([k]);
  }
  return groups;
}

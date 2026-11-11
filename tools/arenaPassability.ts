// Passability analysis for the top-down arenas: pinch gaps between solids, reachability of the
// walkable area (flood fill of the feet circle) and hitboxes that exceed the drawn sprite.
// Used by src/minigames/common/arenaPassability.test.ts and tools/arena-debug.ts.
import { readFileSync } from 'node:fs';
import type { AssetFile } from '../src/gfx/assetTypes';
import { buildArena, type Arena, type Rect, type Solid } from '../src/minigames/common/arena';
import { SPAWNS } from '../src/minigames/snowball/snowballHost';
import { SPUD_SPAWNS } from '../src/minigames/kartoffel/spudHost';
import { PAINT_SPAWNS } from '../src/minigames/farbkrieg/paintGrid';
import { CONFIG } from '../src/config';

export type ArenaCase = {
  name: string;
  file: AssetFile;
  map: string;
  arena: Arena;
  spawns: ReadonlyArray<readonly [number, number]>;
  /** Feet circle radius (the only collision shape of a figure; hats and bodies do not collide). */
  r: number;
};

const load = (f: string) => JSON.parse(readFileSync(`public/assets/${f}`, 'utf8')) as AssetFile;

export function loadArenaCases(): ArenaCase[] {
  const sb = load('arena-schneeball.json');
  const ka = load('arena-kartoffel.json');
  const fk = load('arena-farbkrieg.json');
  return [
    { name: 'schneeball', file: sb, map: 'schneeball.map', arena: buildArena(sb, 'schneeball.map'), spawns: SPAWNS, r: CONFIG.snowball.bodyRadius },
    { name: 'kartoffel', file: ka, map: 'kartoffel.map', arena: buildArena(ka, 'kartoffel.map', { wallChar: null }), spawns: SPUD_SPAWNS, r: CONFIG.kartoffel.bodyRadius },
    { name: 'farbkrieg', file: fk, map: 'farbkrieg.map', arena: buildArena(fk, 'farbkrieg.map'), spawns: PAINT_SPAWNS, r: CONFIG.farbkrieg.bodyRadius },
  ];
}

/** Same test as arena.ts (strict: touching is free). */
function hitsRect(s: Rect, x: number, y: number, r: number): boolean {
  const dx = x - Math.max(s.x, Math.min(x, s.x + s.w));
  const dy = y - Math.max(s.y, Math.min(y, s.y + s.h));
  return dx * dx + dy * dy < r * r;
}

export type Field = { cols: number; rows: number; step: number; free: Uint8Array; reach: Uint8Array };

/**
 * Flood fill of a circle of radius r from the spawn points over a grid with `step` px.
 * `free`: the circle fits there (inside the map, no solid); `reach`: free and connected to a spawn.
 */
export function floodFill(a: Arena, spawns: ReadonlyArray<readonly [number, number]>, r: number, step = 1): Field {
  const cols = Math.floor(a.w / step) + 1;
  const rows = Math.floor(a.h / step) + 1;
  const free = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const y = j * step;
    if (y < r || y > a.h - r) continue;
    // only solids that can touch this row
    const near = a.solids.filter((s) => y > s.y - r && y < s.y + s.h + r);
    for (let i = 0; i < cols; i++) {
      const x = i * step;
      if (x < r || x > a.w - r) continue;
      if (!near.some((s) => hitsRect(s, x, y, r))) free[j * cols + i] = 1;
    }
  }
  const reach = new Uint8Array(cols * rows);
  const stack: number[] = [];
  for (const [x, y] of spawns) {
    const k = Math.round(y / step) * cols + Math.round(x / step);
    if (free[k] && !reach[k]) { reach[k] = 1; stack.push(k); }
  }
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % cols;
    const j = (k - i) / cols;
    // 8 neighbours: the feet move continuously, a 1 px diagonal step past a corner is real movement
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if ((!di && !dj) || i + di < 0 || i + di >= cols || j + dj < 0 || j + dj >= rows) continue;
      const n = k + dj * cols + di;
      if (free[n] && !reach[n]) { reach[n] = 1; stack.push(n); }
    }
  }
  return { cols, rows, step, free, reach };
}

const SNOWMAN_PREFIX = 'schnee.solid.schneemann.';
const WALL_HITBOX: [number, number, number, number] = [1, 1, 14, 14];

/** Opaque bounding box of a sprite (all frames), relative to its top-left corner. */
function spriteArt(file: AssetFile, sprite: string): Rect | null {
  const def = file.sprites[sprite];
  if (!def) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of def.frames) f.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.' || ch === ' ') return;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  }));
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The drawn art of a solid in world px (its sprite's opaque bounding box), or the solid itself. */
export function solidArt(file: AssetFile, s: Solid): Rect {
  const hbSprite = s.sprite.startsWith(SNOWMAN_PREFIX) ? `${SNOWMAN_PREFIX}heil` : s.sprite;
  const hb = file.sprites[hbSprite]?.hitbox ?? WALL_HITBOX;
  const art = spriteArt(file, s.sprite);
  if (!art) return s;
  return { x: s.x - hb[0] + art.x, y: s.y - hb[1] + art.y, w: art.w, h: art.h };
}

/** Euclidean distance between two rects (0 when they touch or overlap). */
export function rectGap(s: Rect, t: Rect): number {
  const gx = Math.max(0, t.x - (s.x + s.w), s.x - (t.x + t.w));
  const gy = Math.max(0, t.y - (s.y + s.h), s.y - (t.y + t.h));
  return Math.hypot(gx, gy);
}

/** The free rect between two rects (the corner box when they are diagonal). */
function between(s: Rect, t: Rect): Rect {
  const span = (lo1: number, hi1: number, lo2: number, hi2: number): [number, number] =>
    hi1 <= lo2 ? [hi1, lo2] : hi2 <= lo1 ? [hi2, lo1] : [Math.max(lo1, lo2), Math.min(hi1, hi2)];
  const [x0, x1] = span(s.x, s.x + s.w, t.x, t.x + t.w);
  const [y0, y1] = span(s.y, s.y + s.h, t.y, t.y + t.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export type Gap = {
  a: string; b: string;
  /** Distance between the hitboxes (px). */
  gap: number;
  /** Distance between the drawn art of the two (px): what the player sees. */
  artGap: number;
  x: number; y: number;
  /** 'tight': passable only with < 2 px to spare; 'looksOpen': impassable but the art shows a gap the figure fits. */
  problem: 'tight' | 'looksOpen' | null;
};

const EDGE = (id: string, x: number, y: number, w: number, h: number): Solid => ({ id, sprite: id, kind: 'wall', x, y, w, h });

/**
 * Pinch gaps: pairs of solids (or a solid and the map edge) closer than 2r + margin whose gap a
 * figure can reach (a reachable feet position within r + 1 px of it). A gap is a problem when it is
 *  - tight: 2r <= gap < 2r + margin (passable only exactly; a diagonal approach snags), or
 *  - looksOpen: gap < 2r (impassable) although the art shows a gap at least as wide as the feet (2r).
 * Gaps narrower than the feet that also look narrow (art closer than 2r) are fine: nobody tries them
 * and the feet circle cannot enter them, so nobody gets stuck.
 */
export function pinchGaps(c: ArenaCase, margin = 2, field: Field = floodFill(c.arena, c.spawns, c.r, 1)): Gap[] {
  const a = c.arena;
  const r = c.r;
  const solids: Solid[] = [
    ...a.solids,
    EDGE('edge-left', -100, -100, 100, a.h + 200), EDGE('edge-right', a.w, -100, 100, a.h + 200),
    EDGE('edge-top', -100, -100, a.w + 200, 100), EDGE('edge-bottom', -100, a.h, a.w + 200, 100),
  ];
  const art = solids.map((s) => (s.id.startsWith('edge') ? s : solidArt(c.file, s)));
  const reachableNear = (g: Rect) => {
    const d = r + 1;
    const i0 = Math.max(0, Math.floor((g.x - d) / field.step));
    const i1 = Math.min(field.cols - 1, Math.ceil((g.x + g.w + d) / field.step));
    const j0 = Math.max(0, Math.floor((g.y - d) / field.step));
    const j1 = Math.min(field.rows - 1, Math.ceil((g.y + g.h + d) / field.step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!field.reach[j * field.cols + i]) continue;
      const x = i * field.step;
      const y = j * field.step;
      if (hitsRect(g, x, y, d)) return true;
    }
    return false;
  };
  const out: Gap[] = [];
  for (let p = 0; p < solids.length; p++) {
    for (let q = p + 1; q < solids.length; q++) {
      const s = solids[p];
      const t = solids[q];
      const gap = rectGap(s, t);
      if (gap <= 0 || gap >= 2 * r + margin) continue;
      const g = between(s, t);
      const x = g.x + g.w / 2;
      const y = g.y + g.h / 2;
      // a gap filled by a third solid is closed
      if (solids.some((u) => u !== s && u !== t && x >= u.x && x <= u.x + u.w && y >= u.y && y <= u.y + u.h)) continue;
      if (!reachableNear(g)) continue;
      const artGap = rectGap(art[p], art[q]);
      const problem = gap >= 2 * r ? 'tight' : artGap >= 2 * r ? 'looksOpen' : null;
      out.push({ a: `${s.id} ${s.sprite}`, b: `${t.id} ${t.sprite}`, gap: Math.round(gap * 100) / 100, artGap: Math.round(artGap * 100) / 100, x, y, problem });
    }
  }
  return out;
}

export type Region = { x0: number; y0: number; x1: number; y1: number; cells: number; hidden: boolean };

/**
 * Connected components of free but unreachable feet positions. `hidden`: every cell lies under the
 * art of a sprite drawn in front of it (behind a roof or a tree row), so the player cannot see it.
 */
export function unreachableRegions(c: ArenaCase, f: Field): Region[] {
  const map = c.file.maps![c.map];
  const covers: Rect[] = [];
  map.objects.forEach((o) => {
    const art = spriteArt(c.file, o.sprite);
    if (art) covers.push({ x: o.x + art.x, y: o.y + art.y, w: art.w, h: art.h });
  });
  const covered = (x: number, y: number) => covers.some((k) => x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h);
  const seen = new Uint8Array(f.free.length);
  const out: Region[] = [];
  for (let k = 0; k < f.free.length; k++) {
    if (!f.free[k] || f.reach[k] || seen[k]) continue;
    const reg: Region = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, cells: 0, hidden: true };
    const stack = [k];
    seen[k] = 1;
    while (stack.length) {
      const cell = stack.pop()!;
      const i = cell % f.cols;
      const j = (cell - i) / f.cols;
      reg.cells++;
      reg.x0 = Math.min(reg.x0, i * f.step); reg.x1 = Math.max(reg.x1, i * f.step);
      reg.y0 = Math.min(reg.y0, j * f.step); reg.y1 = Math.max(reg.y1, j * f.step);
      if (!covered(i * f.step, j * f.step)) reg.hidden = false;
      const nb = [i > 0 ? cell - 1 : -1, i < f.cols - 1 ? cell + 1 : -1, j > 0 ? cell - f.cols : -1, j < f.rows - 1 ? cell + f.cols : -1];
      for (const n of nb) if (n >= 0 && f.free[n] && !f.reach[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
    }
    out.push(reg);
  }
  return out;
}

/** Opaque pixel test of a sprite's first frame. */
function opaque(file: AssetFile, sprite: string): (x: number, y: number) => boolean {
  const rows = file.sprites[sprite]?.frames[0]?.rows ?? [];
  return (x, y) => {
    const ch = rows[y]?.[x];
    return ch !== undefined && ch !== '.' && ch !== ' ';
  };
}

/**
 * Hitbox rows/columns at the edges of the hitbox that contain no drawn pixel of the sprite:
 * how far a hitbox reaches beyond the art, per side (px).
 */
export function hitboxOverhang(file: AssetFile, sprite: string): { top: number; bottom: number; left: number; right: number } | null {
  const hb = file.sprites[sprite]?.hitbox;
  if (!hb) return null;
  const op = opaque(file, sprite);
  const [hx, hy, hw, hh] = hb;
  const rowHas = (y: number) => { for (let x = hx; x < hx + hw; x++) if (op(x, y)) return true; return false; };
  const colHas = (x: number) => { for (let y = hy; y < hy + hh; y++) if (op(x, y)) return true; return false; };
  let top = 0; while (top < hh && !rowHas(hy + top)) top++;
  let bottom = 0; while (bottom < hh && !rowHas(hy + hh - 1 - bottom)) bottom++;
  let left = 0; while (left < hw && !colHas(hx + left)) left++;
  let right = 0; while (right < hw && !colHas(hx + hw - 1 - right)) right++;
  return { top, bottom, left, right };
}

import type { AssetFile } from '../../gfx/assetTypes';

export type Rect = { x: number; y: number; w: number; h: number };
export type Solid = Rect & { id: string; sprite: string; kind: 'wall' | 'object' };
export type Arena = { w: number; h: number; tile: number; raster: string[]; solids: Solid[] };

const WALL_HITBOX: [number, number, number, number] = [1, 1, 14, 14];
const STEP = 2;
const SNOWMAN_PREFIX = 'schnee.solid.schneemann.';
const SNOWMAN_INTACT = 'schnee.solid.schneemann.heil';

/**
 * `wallChar`: raster character that becomes a wall solid (default 'w'; null = none, e.g. the garden
 * where 'w' is a path). Cells of the `rand` layer with a hitbox always become wall solids (the fence).
 */
export function buildArena(file: AssetFile, mapName: string, opts: { wallChar?: string | null } = {}): Arena {
  const wallChar = opts.wallChar === undefined ? 'w' : opts.wallChar;
  const map = file.maps?.[mapName];
  if (!map) throw new Error(`map not found: ${mapName}`);
  const { tile, raster } = map;
  const solids: Solid[] = [];
  map.objects.forEach((o, i) => {
    // Snowmen all start intact on the host (and the view shows that sprite): the map example's state must not matter.
    const sprite = o.sprite.startsWith(SNOWMAN_PREFIX) ? SNOWMAN_INTACT : o.sprite;
    const hb = file.sprites[sprite]?.hitbox ?? file.sprites[o.sprite]?.hitbox;
    if (!hb) return;
    solids.push({ id: `obj${i}`, sprite: o.sprite, kind: 'object', x: o.x + hb[0], y: o.y + hb[1], w: hb[2], h: hb[3] });
  });
  raster.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      if (wallChar === null || line[col] !== wallChar) continue;
      const sprite = map.layers.flaechen[row]?.[col] ?? 'schnee.solid.wall.0';
      const hb = file.sprites[sprite]?.hitbox ?? WALL_HITBOX;
      solids.push({ id: `wall${col},${row}`, sprite, kind: 'wall', x: col * tile + hb[0], y: row * tile + hb[1], w: hb[2], h: hb[3] });
    }
  });
  map.layers.rand?.forEach((line, row) => {
    line.forEach((sprite, col) => {
      const hb = sprite ? file.sprites[sprite]?.hitbox : undefined;
      if (!sprite || !hb) return;
      solids.push({ id: `rand${col},${row}`, sprite, kind: 'wall', x: col * tile + hb[0], y: row * tile + hb[1], w: hb[2], h: hb[3] });
    });
  });
  return { w: map.w * tile, h: map.h * tile, tile, raster, solids };
}

export function tileAt(a: Arena, x: number, y: number): string {
  const col = Math.floor(x / a.tile);
  const row = Math.floor(y / a.tile);
  if (col < 0 || row < 0 || row >= a.raster.length) return '#';
  return a.raster[row][col] ?? '#';
}

function hitsRect(s: Rect, x: number, y: number, r: number): boolean {
  const cx = Math.max(s.x, Math.min(x, s.x + s.w));
  const cy = Math.max(s.y, Math.min(y, s.y + s.h));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

function blocked(solids: Solid[], x: number, y: number, r: number): Solid | null {
  for (const s of solids) if (hitsRect(s, x, y, r)) return s;
  return null;
}

/** Move along one axis; returns new coordinate and whether it was blocked. */
function sweepAxis(a: Arena, solids: Solid[], x: number, y: number, d: number, r: number, axis: 'x' | 'y'): [number, boolean] {
  const lo = r;
  const hi = (axis === 'x' ? a.w : a.h) - r;
  let pos = axis === 'x' ? x : y;
  let remaining = d;
  while (remaining !== 0) {
    const step = Math.abs(remaining) > STEP ? Math.sign(remaining) * STEP : remaining;
    remaining -= step;
    let next = pos + step;
    let hit = false;
    if (next < lo) { next = lo; hit = true; }
    else if (next > hi) { next = hi; hit = true; }
    const free = (p: number) => (axis === 'x' ? !blocked(solids, p, y, r) : !blocked(solids, x, p, r));
    if (!free(next)) {
      // bisect between the free position and the blocked one
      let good = pos;
      let bad = next;
      for (let i = 0; i < 12; i++) {
        const mid = (good + bad) / 2;
        if (free(mid)) good = mid; else bad = mid;
      }
      return [good, true];
    }
    pos = next;
    if (hit) return [pos, true];
  }
  return [pos, false];
}

/** Push a circle out of overlapping solids (minimum translation), then clamp to the map. */
function depenetrate(a: Arena, solids: Solid[], x: number, y: number, r: number): [number, number] {
  for (let it = 0; it < 4; it++) {
    const s = blocked(solids, x, y, r);
    if (!s) break;
    const cx = Math.max(s.x, Math.min(x, s.x + s.w));
    const cy = Math.max(s.y, Math.min(y, s.y + s.h));
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      x += (dx / d) * (r - d + 1e-6);
      y += (dy / d) * (r - d + 1e-6);
    } else {
      // centre inside the rect: leave through the nearest side
      const opts: [number, number, number][] = [
        [x - s.x, -(x - s.x) - r - 1e-6, 0],
        [s.x + s.w - x, s.x + s.w - x + r + 1e-6, 0],
        [y - s.y, 0, -(y - s.y) - r - 1e-6],
        [s.y + s.h - y, 0, s.y + s.h - y + r + 1e-6],
      ];
      const best = opts.reduce((m, o) => (o[0] < m[0] ? o : m));
      x += best[1];
      y += best[2];
    }
    x = Math.max(r, Math.min(a.w - r, x));
    y = Math.max(r, Math.min(a.h - r, y));
  }
  return [Math.max(r, Math.min(a.w - r, x)), Math.max(r, Math.min(a.h - r, y))];
}

export function moveCircle(
  a: Arena, x: number, y: number, dx: number, dy: number, r: number, solids: Solid[] = a.solids,
): { x: number; y: number; hitX: boolean; hitY: boolean } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x, y, hitX: false, hitY: false };
  if (!Number.isFinite(dx)) dx = 0;
  if (!Number.isFinite(dy)) dy = 0;
  [x, y] = depenetrate(a, solids, x, y, r);
  const [nx, hitX] = sweepAxis(a, solids, x, y, dx, r, 'x');
  const [ny, hitY] = sweepAxis(a, solids, nx, y, dy, r, 'y');
  return { x: nx, y: ny, hitX, hitY };
}

export function segmentHit(
  a: Arena, x0: number, y0: number, x1: number, y1: number, r: number, solids: Solid[] = a.solids,
): { t: number; solid: Solid | null; normal: 'x' | 'y' } | null {
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len)); // <= 1 px per sample
  const at = (t: number): [number, number] => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  const outside = (x: number, y: number) => x < r || x > a.w - r || y < r || y > a.h - r;
  const hitAt = (t: number) => {
    const [x, y] = at(t);
    return outside(x, y) || blocked(solids, x, y, r) !== null;
  };
  let prev = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!hitAt(t)) { prev = t; continue; }
    let good = prev;
    let bad = t;
    if (i === 0) good = bad = 0;
    else for (let k = 0; k < 12; k++) {
      const mid = (good + bad) / 2;
      if (hitAt(mid)) bad = mid; else good = mid;
    }
    const [, fy] = at(good);
    const [ox, oy] = at(bad);
    const solid = blocked(solids, ox, oy, r);
    // which axis is responsible: does moving only in x from the free point already collide?
    const xOut = ox < r || ox > a.w - r;
    const yOut = oy < r || oy > a.h - r;
    let normal: 'x' | 'y';
    if (xOut || yOut) normal = xOut ? 'x' : 'y';
    else normal = blocked(solids, ox, fy, r) ? 'x' : 'y';
    return { t: good, solid: xOut || yOut ? null : solid, normal };
  }
  return null;
}

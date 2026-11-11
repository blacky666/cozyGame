import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AssetFile } from '../../gfx/assetTypes';
import { buildArena } from '../common/arena';
import {
  createGrid, decodeGrid, edgeMask, encodeGrid, PAINT_TILE, paintDisc, paintTile, rankByCount, tileCounts, tileIndex,
  type Grid,
} from './paintGrid';

const file = JSON.parse(readFileSync('public/assets/arena-farbkrieg.json', 'utf8')) as AssetFile;
const arena = buildArena(file, 'farbkrieg.map');
const at = (g: Grid, c: number, r: number) => r * g.cols + c;

/** Fully paintable synthetic grid. */
function open(cols: number, rows: number): Grid {
  return { cols, rows, tile: 16, owner: new Uint8Array(cols * rows), paintable: new Uint8Array(cols * rows).fill(1), count: cols * rows };
}

describe('paintGrid', () => {
  it('paintable mask', () => {
    const g = createGrid(arena);
    expect([g.cols, g.rows, g.tile]).toEqual([26, 13, 16]);
    expect(g.tile).toBe(PAINT_TILE);
    expect(g.count).toBe(235);
    for (let c = 0; c < 26; c++) for (const r of [0, 1]) expect(g.paintable[at(g, c, r)]).toBe(0);
    for (let r = 0; r < 13; r++) for (const c of [0, 25]) expect(g.paintable[at(g, c, r)]).toBe(0);
    // the bottom wall is closed: archway base and the wall pieces beside it
    for (let c = 0; c < 26; c++) expect(g.paintable[at(g, c, 12)]).toBe(0);
  });
  it('tileIndex is null outside', () => {
    const g = createGrid(arena);
    expect(tileIndex(g, -1, 5)).toBeNull();
    expect(tileIndex(g, 5, 208)).toBeNull();
    expect(tileIndex(g, 17, 33)).toBe(at(g, 1, 2));
  });
  it('paintDisc paints only paintable tiles', () => {
    const g = createGrid(arena);
    const n = paintDisc(g, 24, 40, 24, 1);
    expect(n).toBeGreaterThan(0);
    for (let r = 0; r < 13; r++) for (let c = 0; c < 26; c++) {
      if (g.owner[at(g, c, r)] !== 0) {
        expect(c).not.toBe(0);
        expect(r).toBeGreaterThan(1);
      }
    }
    expect(paintDisc(g, 24, 40, 24, 1)).toBe(0);
  });
  it('paintTile returns false when unchanged or not paintable', () => {
    const g = createGrid(arena);
    const i = at(g, 5, 5);
    expect(paintTile(g, i, 2)).toBe(true);
    expect(paintTile(g, i, 2)).toBe(false);
    expect(paintTile(g, at(g, 0, 0), 2)).toBe(false);
    expect(g.owner[at(g, 0, 0)]).toBe(0);
  });
  it('edgeMask', () => {
    const g = open(5, 5);
    paintTile(g, at(g, 2, 2), 1);
    expect(edgeMask(g, at(g, 2, 2))).toBe(0);
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) paintTile(g, at(g, c, r), 1);
    const rows = [1, 2, 3].map((r) => [1, 2, 3].map((c) => edgeMask(g, at(g, c, r))));
    expect(rows).toEqual([[6, 14, 12], [7, 15, 13], [3, 11, 9]]);
    const real = createGrid(arena);
    paintTile(real, at(real, 1, 2), 1);
    paintTile(real, at(real, 2, 2), 1);
    expect(edgeMask(real, at(real, 1, 2))).toBe(2);
  });
  it('edgeMask never exceeds 15 for every tile of a fully painted grid', () => {
    for (const g of [createGrid(arena), open(4, 3)]) {
      for (let i = 0; i < g.owner.length; i++) paintTile(g, i, 2);
      for (let i = 0; i < g.owner.length; i++) {
        const m = edgeMask(g, i);
        expect(Number.isInteger(m)).toBe(true);
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(15);
      }
    }
  });
  it('encode/decode round trip', () => {
    const g = createGrid(arena);
    paintDisc(g, 200, 100, 40, 3);
    paintDisc(g, 100, 100, 20, 4);
    const s = encodeGrid(g);
    expect(s.length).toBe(338);
    expect(/^[0-4]+$/.test(s)).toBe(true);
    const h = createGrid(arena);
    decodeGrid(s, h);
    expect(Array.from(h.owner)).toEqual(Array.from(g.owner));
    expect(encodeGrid(createGrid(arena))).toBe('0'.repeat(338));
    expect(tileCounts(g).reduce((a, b) => a + b, 0)).toBe(235);
  });
  it('rankByCount', () => {
    expect(rankByCount({ a: 5, b: 5, c: 2 })).toEqual([['a', 'b'], ['c']]);
  });
});

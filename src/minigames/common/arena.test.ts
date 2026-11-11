import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AssetFile } from '../../gfx/assetTypes';
import { buildArena, moveCircle, segmentHit, tileAt } from './arena';

const file = JSON.parse(readFileSync('public/assets/arena-schneeball.json', 'utf8')) as AssetFile;
const a = buildArena(file, 'schneeball.map');
const hitsRect = (s: { x: number; y: number; w: number; h: number }, x: number, y: number, r: number) => {
  const dx = x - Math.max(s.x, Math.min(x, s.x + s.w));
  const dy = y - Math.max(s.y, Math.min(y, s.y + s.h));
  return dx * dx + dy * dy < r * r;
};
const kartoffelFile = JSON.parse(readFileSync('public/assets/arena-kartoffel.json', 'utf8')) as AssetFile;
const wall = a.solids.find((s) => s.id === 'wall11,8')!;

describe('arena', () => {
  it('reads size and builds solids for walls and objects with a hitbox', () => {
    expect([a.w, a.h]).toEqual([416, 208]);
    expect(a.solids.some((s) => s.sprite === 'schnee.solid.schneemann.heil')).toBe(true);
    expect(a.solids.filter((s) => s.kind === 'wall').length).toBe(a.raster.join('').split('w').length - 1);
    expect(a.solids.some((s) => s.sprite.startsWith('schnee.deco'))).toBe(false);
  });
  it('gives every snowman solid the hitbox of the intact (heil) sprite', () => {
    const snowmen = a.solids.filter((s) => s.sprite.startsWith('schnee.solid.schneemann.'));
    expect(snowmen.length).toBeGreaterThan(0);
    for (const s of snowmen) expect([s.w, s.h]).toEqual([12, 12]);
  });
  it('finds the pond', () => {
    expect(tileAt(a, 15 * 16 + 8, 5 * 16 + 8)).toBe('j');
    expect(tileAt(a, -1, 5)).toBe('#');
  });
  it('never ends inside a solid when pushed into a wall', () => {
    const r = 5;
    const res = moveCircle(a, wall.x - 30, wall.y + 7, 40, 0, r);
    expect(res.x).toBeLessThanOrEqual(wall.x - r + 1e-6);
    expect(res.hitX).toBe(true);
  });
  it('slides along a wall', () => {
    const r = 5;
    const res = moveCircle(a, wall.x - r - 1, wall.y + 7, 10, 6, r);
    expect(res.x).toBeLessThanOrEqual(wall.x - r + 1e-6);
    expect(res.y).toBeGreaterThan(wall.y + 7 + 5);
    expect(res.hitX).toBe(true);
    expect(res.hitY).toBe(false);
  });
  it('stays inside the map', () => {
    const res = moveCircle(a, 5, 5, -50, -50, 5);
    expect(res.x).toBe(5);
    expect(res.y).toBe(5);
  });
  it('segmentHit finds the first solid and reports the axis normal', () => {
    const hit = segmentHit(a, wall.x - 40, wall.y + 7, wall.x + 5, wall.y + 7, 2);
    expect(hit).not.toBeNull();
    expect(hit!.normal).toBe('x');
    expect(hit!.t).toBeGreaterThan(0);
    expect(hit!.t).toBeLessThan(1);
    expect(hit!.solid?.id).toBe('wall11,8');
    expect(segmentHit(a, 200, 150, 210, 150, 2)).toBeNull();
    expect(segmentHit(a, 30, 150, -50, 150, 2, [])!.solid).toBeNull();
  });

  it('ignores NaN and Infinity movement without hanging', () => {
    const r = moveCircle(a, 100, 150, NaN, Infinity, 5);
    expect(r).toEqual({ x: 100, y: 150, hitX: false, hitY: false });
    const bad = moveCircle(a, NaN, 10, 1, 1, 5);
    expect(bad.hitX).toBe(false);
    expect(segmentHit(a, 0, 0, NaN, 5, 2)).toBeNull();
    expect(segmentHit(a, 0, 0, Infinity, 5, 2)).toBeNull();
  });
  it('pushes a circle out of a solid it starts inside', () => {
    const r = 5;
    const cx = wall.x + wall.w / 2;
    const cy = wall.y + wall.h / 2;
    const res = moveCircle(a, cx, cy, 0, 0, r);
    expect(a.solids.some((s) => hitsRect(s, res.x, res.y, r))).toBe(false);
    expect(Math.hypot(res.x - cx, res.y - cy)).toBeLessThanOrEqual(wall.w / 2 + r + 1);
  });
  it('ends free after a diagonal move into a wall corner', () => {
    const r = 5;
    const res = moveCircle(a, wall.x - 10, wall.y - 10, 30, 30, r);
    expect(a.solids.some((s) => hitsRect(s, res.x, res.y, r))).toBe(false);
  });
  it('does not tunnel through a thin solid in one big step', () => {
    const lantern = a.solids.find((s) => s.sprite === 'schnee.solid.laterne')!;
    const r = 2;
    const y = lantern.y + lantern.h / 2;
    const res = moveCircle(a, lantern.x - 20, y, 40 + lantern.w, 0, r, [lantern]);
    expect(res.x).toBeLessThanOrEqual(lantern.x - r + 1e-6);
    expect(res.hitX).toBe(true);
  });
  it('segmentHit returns a free t', () => {
    const hit = segmentHit(a, wall.x - 40, wall.y + 7, wall.x + 5, wall.y + 7, 2)!;
    const x = wall.x - 40 + 45 * hit.t;
    expect(hitsRect(wall, x, wall.y + 7, 2)).toBe(false);
  });
});

describe('garden arena (kartoffel)', () => {
  const g = buildArena(kartoffelFile, 'kartoffel.map', { wallChar: null });
  it('garden: paths are walkable, the fence blocks', () => {
    const run = moveCircle(g, 100, 104, 40, 0, 5);
    expect(run.y).toBe(104);
    expect(run.x).toBeCloseTo(140, 5);
    const up = moveCircle(g, 100, 30, 0, -40, 5);
    expect(up.y).toBeGreaterThanOrEqual(13 + 5 - 1e-6);
    expect(up.hitY).toBe(true);
  });
  it('garden: no solid at the four spawn points', () => {
    const spawns = [[72, 88], [344, 88], [72, 184], [344, 184]];
    for (const [x, y] of spawns) expect(g.solids.some((s) => hitsRect(s, x, y, 7))).toBe(false);
  });
  it('adds rand-layer solids with id rand<col>,<row>', () => {
    expect(g.solids.some((s) => s.id.startsWith('rand') && s.kind === 'wall')).toBe(true);
  });
  it('schneeball arena unchanged', () => {
    expect(a.solids.length).toBe(82);
    expect(a.solids.some((s) => s.id.startsWith('rand'))).toBe(false);
  });
});

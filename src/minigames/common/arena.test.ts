import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AssetFile } from '../../gfx/assetTypes';
import { buildArena, moveCircle, segmentHit, tileAt } from './arena';

const file = JSON.parse(readFileSync('public/assets/arena-schneeball.json', 'utf8')) as AssetFile;
const a = buildArena(file, 'schneeball.map');
const wall = a.solids.find((s) => s.id === 'wall11,8')!;

describe('arena', () => {
  it('reads size and builds solids for walls and objects with a hitbox', () => {
    expect([a.w, a.h]).toEqual([416, 208]);
    expect(a.solids.some((s) => s.sprite === 'schnee.solid.schneemann.heil')).toBe(true);
    expect(a.solids.filter((s) => s.kind === 'wall').length).toBe(a.raster.join('').split('w').length - 1);
    expect(a.solids.some((s) => s.sprite.startsWith('schnee.deco'))).toBe(false);
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
});

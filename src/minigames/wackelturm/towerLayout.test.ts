import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AssetFile } from '../../gfx/assetTypes';
import { readLayout } from './towerLayout';

const file = JSON.parse(readFileSync('public/assets/arena-wackelturm.json', 'utf8')) as AssetFile;

describe('towerLayout', () => {
  it('reads the geometry table from the asset', () => {
    const l = readLayout(file);
    expect(l.plots.map((p) => p.left)).toEqual([10, 112, 214, 316]);
    expect(l.plots.map((p) => p.w)).toEqual([96, 96, 96, 96]);
    expect(l.pitch).toBe(102);
    expect(l.plots[0]).toEqual({ left: 10, w: 96, centre: 58, minX: 7, maxX: 109 });
    expect(l.surfaceY).toBe(164);
    expect(l.goalY).toBe(57);
    expect(l.goalPx).toBe(107);
    expect(l.hangTopStart).toBe(66);
    expect(l.hookOffsetX).toBe(54);
  });

  it('throws when a sprite is missing', () => {
    const broken = JSON.parse(JSON.stringify(file)) as AssetFile;
    delete broken.sprites['turm.kran.haken'];
    expect(() => readLayout(broken)).toThrow(/turm\.kran\.haken/);
  });
});

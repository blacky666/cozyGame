import { describe, expect, it } from 'vitest';
import { rasterize } from './rasterize';
import type { AssetFile } from './assetTypes';

function file(palette: Record<string, string>, recolor: AssetFile['recolor'] = {}): AssetFile {
  return { palette, recolor, sprites: {} };
}

describe('rasterize', () => {
  it('maps palette keys to RGBA and "." to transparent', () => {
    const f = file({ o: '#3b2418' });
    const out = rasterize({ rows: ['o.'] }, f, {});
    expect(Array.from(out)).toEqual([59, 36, 24, 255, 0, 0, 0, 0]);
  });

  it('applies recolor slots', () => {
    const f = file({ c: '#2f5fb3' }, { c: 'player' });
    const out = rasterize({ rows: ['c'] }, f, { player: '#c4462f' });
    expect(Array.from(out)).toEqual([196, 70, 47, 255]);
  });

  it('keeps palette color when slot has no override', () => {
    const f = file({ c: '#2f5fb3' }, { c: 'player' });
    expect(Array.from(rasterize({ rows: ['c'] }, f, {}))).toEqual([47, 95, 179, 255]);
  });

  it('respects 8-digit hex alpha', () => {
    const f = file({ x: '#2b181047' });
    expect(rasterize({ rows: ['x'] }, f, {})[3]).toBe(71);
  });
});

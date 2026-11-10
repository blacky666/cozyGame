import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAssetFile } from '../src/gfx/validate';
import type { AssetFile, FrameDef } from '../src/gfx/assetTypes';

function mk(name: string, frame: FrameDef, w = 2, h = 1): AssetFile {
  return {
    palette: { o: '#000000' },
    recolor: {},
    sprites: { [name]: { w, h, pivot: [0, 0], fps: 1, loop: false, frames: [frame] } },
  };
}

describe('validateAssetFile', () => {
  it('reports wrong row length with sprite name and frame index', () => {
    const errs = validateAssetFile('t.json', mk('foo.bar', { rows: ['o'] }));
    expect(errs.some((e) => e.includes('foo.bar') && e.includes('[0]'))).toBe(true);
  });

  it('reports unknown palette key', () => {
    const errs = validateAssetFile('t.json', mk('foo', { rows: ['oz'] }));
    expect(errs.some((e) => e.includes("unknown key 'z'"))).toBe(true);
  });

  it('reports char.body frame without anchors.head', () => {
    const errs = validateAssetFile('t.json', mk('char.body.down.idle', { rows: ['oo'] }));
    expect(errs.some((e) => e.includes('anchor head'))).toBe(true);
  });

  it('applies the anchor rule to outfit sprites too', () => {
    const errs = validateAssetFile('t.json', mk('outfit.x.down.idle', { rows: ['oo'] }));
    expect(errs.some((e) => e.includes('anchor head'))).toBe(true);
  });

  it.each(['char-body', 'char-head', 'char-misc', 'outfits'])('real %s.json is valid', (n) => {
    const file = JSON.parse(readFileSync(`public/assets/${n}.json`, 'utf-8')) as AssetFile;
    expect(validateAssetFile(`${n}.json`, file)).toEqual([]);
  });
});

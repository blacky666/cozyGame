import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AssetFile } from './assetTypes';
import { layerPlan, mirrorX } from './layerPlan';
import { defaultProfile } from '../save/profile';

const load = (n: string) =>
  JSON.parse(readFileSync(`public/assets/${n}.json`, 'utf-8')) as AssetFile;
const assets: Record<string, AssetFile> = {
  'char-body': load('char-body'),
  'char-head': load('char-head'),
  'char-misc': load('char-misc'),
  outfits: load('outfits'),
  accessories: load('accessories'),
};
const look = () => ({ ...defaultProfile().look, hat: null });

describe('layerPlan', () => {
  it('places the head at anchors.head minus pivot (down.idle frame 0)', () => {
    const plan = layerPlan(look(), 0, 'down', 'idle', 0, assets);
    const a = assets['char-body'].sprites['char.body.down.idle'].frames[0].anchors!.head;
    const head = plan.find((l) => l.sprite === 'char.head.down.normal')!;
    expect([head.x, head.y]).toEqual([a[0] - 8, a[1] - 14]);
  });

  it('orders shadow, body, head, hair, symbol', () => {
    const names = layerPlan(look(), 0, 'down', 'idle', 0, assets).map((l) => l.sprite);
    expect(names).toEqual([
      'char.shadow',
      'char.body.down.idle',
      'char.head.down.normal',
      'char.hair.kurz.down',
      'ui.symbol.kreis',
    ]);
  });

  it('uses char.head.fall for down.fall frame 2', () => {
    const plan = layerPlan(look(), 0, 'down', 'fall', 2, assets);
    expect(plan.some((l) => l.sprite === 'char.head.fall' && l.frame === 2)).toBe(true);
    expect(plan.some((l) => l.sprite === 'char.hair.kurz.fall')).toBe(true);
  });

  it('uses char.head.fall_laugh for down.laugh', () => {
    const plan = layerPlan(look(), 0, 'down', 'laugh', 0, assets);
    expect(plan.some((l) => l.sprite === 'char.head.fall_laugh')).toBe(true);
  });

  it('maps slot 2 to the player ramp colour', () => {
    const plan = layerPlan(look(), 2, 'down', 'idle', 0, assets);
    const body = plan.find((l) => l.sprite.startsWith('char.body'))!;
    expect(body.colors.player).toBe(assets['char-misc'].ramps!.player![2].c);
    expect(plan.at(-1)!.sprite).toBe('ui.symbol.quadrat');
  });

  it('uses outfit sprites for non-tunika outfits', () => {
    const plan = layerPlan({ ...look(), outfit: 'ruestung' }, 0, 'down', 'idle', 0, assets);
    expect(plan.some((l) => l.sprite === 'outfit.ruestung.down.idle')).toBe(true);
  });

  it('falls back to down/side for single-direction animations', () => {
    expect(
      layerPlan(look(), 0, 'side', 'cheer', 0, assets).some((l) => l.sprite === 'char.body.down.cheer'),
    ).toBe(true);
    expect(
      layerPlan(look(), 0, 'down', 'build_idle', 0, assets).some((l) => l.sprite === 'char.body.side.build_idle'),
    ).toBe(true);
  });

  it('skips missing accessories silently', () => {
    expect(() => layerPlan({ ...look(), hat: 'nope', glasses: 'nope', back: 'nope' }, 0, 'down', 'idle', 0, assets)).not.toThrow();
  });

  it('places glasses as face.<n>.<dir> at anchors.head - [10,20]', () => {
    const plan = layerPlan({ ...look(), glasses: 'rundbrille' }, 0, 'down', 'idle', 0, assets);
    const a = assets['char-body'].sprites['char.body.down.idle'].frames[0].anchors!.head;
    const g = plan.find((l) => l.sprite === 'face.rundbrille.down')!;
    expect([g.x, g.y]).toEqual([a[0] - 10, a[1] - 20]);
  });

  it('uses hat.<n>.fall with the head_pose frame on lying poses', () => {
    const plan = layerPlan({ ...look(), hat: 'zylinder' }, 0, 'down', 'fall', 2, assets);
    const h = plan.find((l) => l.sprite === 'hat.zylinder.fall')!;
    expect(h.frame).toBe(2);
  });

  it('draws the cape after the body when facing up, before it otherwise', () => {
    const idx = (dir: 'up' | 'down', n: string) => {
      const names = layerPlan({ ...look(), back: 'umhang_rot' }, 0, dir, 'idle', 0, assets).map((l) => l.sprite);
      return [names.indexOf(`cape.umhang_rot.${dir}`), names.indexOf(n)];
    };
    const [cu, bu] = idx('up', 'char.body.up.idle');
    expect(cu).toBeGreaterThan(bu);
    const [cd, bd] = idx('down', 'char.body.down.idle');
    expect(cd).toBeGreaterThanOrEqual(0);
    expect(cd).toBeLessThan(bd);
  });

  it('hides the cape on lying poses but keeps the symbol', () => {
    const plan = layerPlan({ ...look(), back: 'umhang_rot' }, 0, 'down', 'fall', 2, assets);
    expect(plan.some((l) => l.sprite.startsWith('cape.'))).toBe(false);
    expect(plan.some((l) => l.sprite === 'ui.symbol.kreis')).toBe(true);
  });

  it('keeps head/symbol when a frame has no back anchor, and symbol without head anchor', () => {
    const a2 = structuredClone(assets);
    const fr = a2['char-body'].sprites['char.body.down.idle'].frames[0];
    delete (fr.anchors as Partial<typeof fr.anchors>)!.back;
    const p1 = layerPlan({ ...look(), back: 'umhang_rot' }, 0, 'down', 'idle', 0, a2);
    expect(p1.some((l) => l.sprite === 'char.head.down.normal')).toBe(true);
    expect(p1.some((l) => l.sprite.startsWith('cape.'))).toBe(false);
    delete fr.anchors;
    const p2 = layerPlan(look(), 0, 'down', 'idle', 0, a2);
    expect(p2.some((l) => l.sprite === 'ui.symbol.kreis')).toBe(true);
  });

  it('mirrors x around the body centre', () => {
    expect(mirrorX(4, 10)).toBe(10);
    expect(mirrorX(0, 24)).toBe(0);
    expect(mirrorX(mirrorX(3, 7), 7)).toBe(3);
  });
});

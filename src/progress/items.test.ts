import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import type { AssetFile } from '../gfx/assetTypes';
import { FREE_ITEMS, HAIR_COLORS, HAIRS, ITEMS, itemLabel, itemSprite, nextReward, ownedItems, rewardLevel, isBoxItem } from './items';

const sprites = new Set<string>();
for (const f of readdirSync('public/assets').filter((n) => n.endsWith('.json'))) {
  const file = JSON.parse(readFileSync(`public/assets/${f}`, 'utf8')) as AssetFile;
  for (const k of Object.keys(file.sprites)) sprites.add(k);
}

describe('reward table', () => {
  const rewards = CONFIG.progress.rewards;
  it('has exactly one reward for each level 2..30', () => {
    const levels = Object.keys(rewards).map(Number).sort((a, b) => a - b);
    expect(levels).toEqual(Array.from({ length: 29 }, (_, i) => i + 2));
  });
  it('never repeats an item and covers every item with free and box pool', () => {
    const all = [...Object.values(rewards), ...CONFIG.progress.boxPool, ...FREE_ITEMS];
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(ITEMS.map((i) => i.id)));
  });
  it('puts the big rewards on every fifth level', () => {
    expect([5, 10, 15, 20, 25, 30].map((l) => rewards[l])).toEqual([
      'prank.furzkissen', 'cape.sternenumhang', 'outfit.ruestung', 'prank.tintenklecks', 'cape.engelsfluegel', 'hat.krone_glitzer',
    ]);
  });
  it('rewardLevel and isBoxItem', () => {
    expect(rewardLevel('hat.zylinder')).toBe(3);
    expect(rewardLevel('hat.bauhelm')).toBeNull();
    expect(rewardLevel('emote.winken')).toBeNull();
    expect(isBoxItem('hat.bauhelm')).toBe(true);
    expect(isBoxItem('hat.zylinder')).toBe(false);
  });
});

describe('catalog', () => {
  it('every item has a real sprite', () => {
    for (const it of ITEMS) expect(sprites.has(itemSprite(it.id)), itemSprite(it.id)).toBe(true);
  });
  it('every hairstyle has a sprite and there are 6 hair colour labels', () => {
    for (const h of HAIRS) expect(sprites.has(`char.hair.${h.name}.down`)).toBe(true);
    expect(HAIR_COLORS).toEqual(['Braun', 'Rot', 'Blond', 'Schwarz', 'Grau', 'Grün']);
  });
  it('labels in German and never offers the Gemeinheit hat', () => {
    expect(itemLabel('outfit.maleroverall')).toBe('Maler-Overall');
    expect(itemLabel('emote.zunge')).toBe('Zunge rausstrecken');
    expect(ITEMS.some((i) => i.id === 'hat.gurke')).toBe(false);
  });
  it('item ids are <category>.<name>', () => {
    for (const it of ITEMS) expect(it.id).toBe(`${it.cat}.${it.name}`);
  });
});

describe('ownedItems', () => {
  it('xp 0 owns only the free items', () => {
    const o = ownedItems(0, []);
    expect(o).toEqual(new Set(FREE_ITEMS));
    expect(o.has('emote.winken')).toBe(true);
    expect(o.has('emote.zunge')).toBe(false);
  });
  it('xp 280 adds the level 2 and 3 rewards', () => {
    const o = ownedItems(280, []);
    expect(o.has('emote.zunge')).toBe(true);
    expect(o.has('hat.zylinder')).toBe(true);
    expect(o.has('face.rundbrille')).toBe(false);
  });
  it('unlocked counts only for box pool items', () => {
    const o = ownedItems(0, ['hat.bauhelm', 'hat.zylinder', 'foo']);
    expect(o.has('hat.bauhelm')).toBe(true);
    expect(o.has('hat.zylinder')).toBe(false);
    expect(o.has('foo')).toBe(false);
  });
});

describe('nextReward', () => {
  it.each([
    [0, { level: 2, item: 'emote.zunge', xpLeft: 120 }],
    [250, { level: 3, item: 'hat.zylinder', xpLeft: 30 }],
    [19720, { level: null, item: 'box', xpLeft: 1000 }],
    [20000, { level: null, item: 'box', xpLeft: 720 }],
  ])('xp %i', (xp, r) => {
    expect(nextReward(xp)).toEqual(r);
  });
});

describe('feat config', () => {
  it('config featXp has exactly the FEAT_IDS keys and values in 5..10', async () => {
    const { FEAT_IDS, featLabel } = await import('./feats');
    expect(Object.keys(CONFIG.progress.featXp).sort()).toEqual([...FEAT_IDS].sort());
    for (const id of FEAT_IDS) {
      expect(CONFIG.progress.featXp[id]).toBeGreaterThanOrEqual(5);
      expect(CONFIG.progress.featXp[id]).toBeLessThanOrEqual(10);
      expect(featLabel(id).length).toBeGreaterThan(0);
    }
    expect(FEAT_IDS).toHaveLength(11);
  });
});

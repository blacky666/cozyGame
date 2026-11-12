import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { neutralInput } from '../../net/protocol';
import { maskButtons } from './prankInput';
import { ownInputFx, PRANK_SPRITES, prankSounds, screenFx } from './prankLayer';
import { emptyPrankSnap, PRANK_IDS, type CueKind, type PrankCue, type PrankFx, type PrankSnap } from './pranks';

// The layer module also holds the Phaser drawing part, which needs a browser.
vi.mock('phaser', () => ({ default: {} }));

const cue = (n: number, kind: CueKind, from: string | null, to: string[]): PrankCue => ({ n, kind, from, to, leftMs: 1000 });
const fx = (key: string, kind: PrankFx['kind'], n = 1): PrankFx => ({ key, kind, leftMs: 1000, n });

describe('prankSounds', () => {
  it('each cue sounds once; the prankster hears streich_los first', () => {
    const c = cue(1, 'furzkissen', 'p0', ['p2']);
    const a = prankSounds(new Set(), [c], 'p1');
    expect(a.sounds).toEqual(['streich.furzkissen']);
    expect(prankSounds(a.seen, [c], 'p1').sounds).toEqual([]);
    expect(prankSounds(new Set(), [c], 'p0').sounds).toEqual(['streich.streich_los', 'streich.furzkissen']);
  });

  it('maps banana, slip, freeze and thaw cues', () => {
    expect(prankSounds(new Set(), [cue(1, 'eis', null, ['p1'])], 'p0').sounds).toEqual(['karte.falle_einfrieren']);
    expect(prankSounds(new Set(), [cue(1, 'eis_weg', null, ['p1'])], 'p0').sounds).toEqual(['karte.falle_auftauen']);
    expect(prankSounds(new Set(), [cue(2, 'rutsch', 'p0', ['p1'])], 'p1').sounds).toEqual(['streich.bananenschale_rutschen']);
    expect(prankSounds(new Set(), [cue(3, 'bananenschale', 'p1', [])], 'p0').sounds).toEqual(['streich.bananenschale_ablegen']);
  });

  it('a slip caused by the own banana does not play streich_los again', () => {
    expect(prankSounds(new Set(), [cue(2, 'rutsch', 'p0', ['p1'])], 'p0').sounds).toEqual(['streich.bananenschale_rutschen']);
  });

  it('every sound id it can return exists in public/audio/*/sounds.json', () => {
    const ids = new Set<string>();
    for (const pkg of ['streich', 'karte']) {
      const file = JSON.parse(readFileSync(`public/audio/${pkg}/sounds.json`, 'utf8')) as { toene: { id: string }[] };
      for (const t of file.toene) ids.add(t.id);
    }
    const kinds: CueKind[] = [...PRANK_IDS, 'rutsch', 'eis', 'eis_weg'];
    const all = kinds.flatMap((k, i) => prankSounds(new Set(), [cue(i + 1, k, 'p0', ['p1'])], 'p0').sounds);
    for (const id of all) expect(ids.has(id), id).toBe(true);
  });
});

describe('prank sprites', () => {
  it('every sprite the layer uses and every prank icon exists in public/assets/*.json', () => {
    const names = new Set<string>();
    for (const f of readdirSync('public/assets').filter((n) => n.endsWith('.json'))) {
      const file = JSON.parse(readFileSync(`public/assets/${f}`, 'utf8')) as { sprites?: Record<string, unknown> };
      for (const k of Object.keys(file.sprites ?? {})) names.add(k);
    }
    expect(PRANK_SPRITES.length).toBeGreaterThan(10);
    for (const id of PRANK_SPRITES) expect(names.has(id), id).toBe(true);
    for (const id of PRANK_IDS) expect(names.has(`streich.${id}.icon`), id).toBe(true);
  });
});

describe('screenFx / ownInputFx', () => {
  it('screenFx: only the own ink and confetti', () => {
    const list = [fx('p1', 'ink', 1), fx('p1', 'reverse', 2), fx('p2', 'ink', 3), fx('p1', 'confetti', 4)];
    expect(screenFx(list, 'p1').map((f) => f.n)).toEqual([1, 4]);
  });

  it('ownInputFx + maskButtons: reversed self predicts the swapped direction', () => {
    const snap: PrankSnap = { ...emptyPrankSnap(), fx: [fx('p1', 'reverse'), fx('p2', 'frozen')] };
    const own = ownInputFx(snap, 'p1');
    expect(own.map((f) => f.kind)).toEqual(['reverse']);
    const predicted = maskButtons({ ...neutralInput(), left: true }, own);
    expect(predicted.right).toBe(true);
    expect(predicted.left).toBe(false);
    expect(ownInputFx(null, 'p1')).toEqual([]);
  });
});

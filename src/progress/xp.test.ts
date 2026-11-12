import { describe, expect, it } from 'vitest';
import { eveningXp, podiumItems, type RoundRecord, type XpLine } from './xp';

const P = ['p0', 'p1', 'p2'];
const sum = (lines: XpLine[]) => lines.reduce((a, l) => a + l.xp, 0);
const R1: RoundRecord = { placements: [['p0'], ['p1'], ['p2']], feats: { p2: ['schubser'] } };
const R2: RoundRecord = { placements: [['p1', 'p2'], ['p0']], feats: {} };

describe('eveningXp', () => {
  it('sums participation, round places, feats and the overall places', () => {
    const xp = eveningXp(P, [R1, R2], [['p1'], ['p0'], ['p2']]);
    expect(sum(xp.p0)).toBe(105);
    expect(sum(xp.p1)).toBe(130);
    expect(sum(xp.p2)).toBe(90);
    expect(xp.p0[0]).toEqual({ kind: 'teilnahme', xp: 50 });
    expect(xp.p2).toContainEqual({ kind: 'erfolg', round: 1, feat: 'schubser', xp: 5 });
    expect(xp.p0).toContainEqual({ kind: 'platz', round: 2, place: 3, xp: 10 });
    expect(xp.p1).toContainEqual({ kind: 'gesamt', place: 1, xp: 40 });
  });
  it('a tie for the overall win gives both +40 and nobody +20', () => {
    const xp = eveningXp(P, [R1, R2], [['p0', 'p1'], ['p2']]);
    expect(xp.p0).toContainEqual({ kind: 'gesamt', place: 1, xp: 40 });
    expect(xp.p1).toContainEqual({ kind: 'gesamt', place: 1, xp: 40 });
    expect(xp.p2.some((l) => l.kind === 'gesamt')).toBe(false);
  });
  it('without final omits gesamt', () => {
    const xp = eveningXp(P, [R1], null);
    for (const k of P) expect(xp[k].some((l) => l.kind === 'gesamt')).toBe(false);
    expect(sum(xp.p0)).toBe(75);
  });
  it('with no rounds every player gets nothing', () => {
    expect(eveningXp(P, [], [['p0'], ['p1'], ['p2']])).toEqual({ p0: [], p1: [], p2: [] });
  });
  it('drops unknown feats, repeated feats in one round and unknown players', () => {
    const xp = eveningXp(P, [{ placements: [['p0'], ['p1'], ['p2']], feats: { p0: ['bogus', 'turm_ziel', 'turm_ziel'], p9: ['schubser'] } }], null);
    expect(xp.p0.filter((l) => l.kind === 'erfolg')).toEqual([{ kind: 'erfolg', round: 1, feat: 'turm_ziel', xp: 10 }]);
    expect(Object.keys(xp)).toEqual(P);
  });
});

describe('podiumItems', () => {
  it('lists p2 in the binding order', () => {
    const xp = eveningXp(P, [R1, R2], [['p1'], ['p0'], ['p2']]);
    expect(podiumItems(xp.p2)).toEqual([
      { label: 'Teilnahme', xp: 50 },
      { label: 'Rundenplätze', xp: 35 },
      { label: '3 Schubser gelandet', xp: 5 },
    ]);
    expect(podiumItems(xp.p1)).toEqual([
      { label: 'Teilnahme', xp: 50 },
      { label: 'Rundenplätze', xp: 40 },
      { label: 'Gesamtsieg', xp: 40 },
    ]);
    expect(podiumItems(xp.p0).at(-1)).toEqual({ label: 'Platz 2 gesamt', xp: 20 });
  });
  it('groups a feat earned in two rounds and puts the day bonus last', () => {
    const lines: XpLine[] = [
      { kind: 'teilnahme', xp: 50 },
      { kind: 'erfolg', round: 1, feat: 'schubser', xp: 5 },
      { kind: 'erfolg', round: 2, feat: 'turm_ziel', xp: 10 },
      { kind: 'tag', xp: 50 },
      { kind: 'erfolg', round: 3, feat: 'schubser', xp: 5 },
      { kind: 'gesamt', place: 1, xp: 40 },
    ];
    expect(podiumItems(lines)).toEqual([
      { label: 'Teilnahme', xp: 50 },
      { label: '3 Schubser gelandet ×2', xp: 10 },
      { label: 'Zielhöhe erreicht', xp: 10 },
      { label: 'Gesamtsieg', xp: 40 },
      { label: 'Erster Abend heute', xp: 50 },
    ]);
  });
});

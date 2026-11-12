import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { defaultProfile, type Profile } from '../save/profile';
import { podiumScript, type PodiumStep } from './podiumScript';
import { settleEvening, type SettleReport } from './settle';
import type { XpLine } from './xp';

const P = CONFIG.progress.podium;
const TODAY = '2026-11-12';
const prof = (o: Partial<Profile>): Profile => ({ ...defaultProfile('Mo'), ...o });
const LINES_105: XpLine[] = [
  { kind: 'teilnahme', xp: 50 },
  { kind: 'platz', round: 1, place: 1, xp: 25 },
  { kind: 'platz', round: 2, place: 3, xp: 10 },
  { kind: 'erfolg', round: 1, feat: 'schubser', xp: 5 },
  { kind: 'platz', round: 3, place: 4, xp: 15 },
];
const report = (p: Profile, lines: XpLine[], pool?: string[]): SettleReport => {
  const r = settleEvening(pool ? { ...p, unlocked: pool } : p, 'e1', lines, { today: TODAY, rand: () => 0 }).report;
  if (!r) throw new Error('no report');
  return r;
};
const of = <K extends PodiumStep['kind']>(s: PodiumStep[], k: K) => s.filter((x): x is Extract<PodiumStep, { kind: K }> => x.kind === k);

describe('podiumScript', () => {
  const levelUpReport = () => report(prof({ xp: 100, lastPlayDay: '2026-11-11' }), LINES_105);

  it('lists the items one by one, then fills the bar, levels up and shows the unlock', () => {
    const s = podiumScript(levelUpReport(), { tip: true });
    const items = of(s, 'item');
    expect(items.map((i) => i.label)).toEqual(['Teilnahme', 'Rundenplätze', '3 Schubser gelandet', 'Erster Abend heute']);
    expect(items.map((i) => i.xp)).toEqual([50, 50, 5, 50]);
    expect(items.map((i) => i.at)).toEqual([0, P.itemMs, 2 * P.itemMs, 3 * P.itemMs]);

    const bars = of(s, 'bar');
    expect(bars.map(({ level, from, to, need }) => ({ level, from, to, need }))).toEqual([
      { level: 1, from: 100, to: 120, need: 120 },
      { level: 2, from: 0, to: 135, need: 160 },
    ]);
    expect(bars[0].at).toBe(4 * P.itemMs);
    expect(bars[0].ms).toBe(P.barMs);

    const iUp = s.findIndex((x) => x.kind === 'levelUp');
    expect(s[iUp]).toEqual({ at: bars[0].at + P.barMs, kind: 'levelUp', level: 2, need: 160 });
    expect(s[iUp + 1]).toMatchObject({ kind: 'unlock', item: 'emote.zunge' });
    expect(bars[1].at).toBeGreaterThanOrEqual(s[iUp + 1].at + P.unlockMs);
    expect(s[s.length - 1].kind).toBe('tip');
    expect(s[s.length - 1].at).toBeGreaterThanOrEqual(bars[1].at + P.barMs);
    // Sorted by time.
    expect(s.map((x) => x.at)).toEqual([...s.map((x) => x.at)].sort((a, b) => a - b));
  });

  it('has no tip step when no tip is due', () => {
    expect(of(podiumScript(levelUpReport(), { tip: false }), 'tip')).toEqual([]);
  });

  it('without a level-up: one bar segment, no levelUp, unlock or tip', () => {
    const r = report(prof({ xp: 0, lastPlayDay: TODAY }), [{ kind: 'teilnahme', xp: 50 }]);
    const s = podiumScript(r, { tip: false });
    expect(of(s, 'bar').map(({ level, from, to, need }) => ({ level, from, to, need }))).toEqual([{ level: 1, from: 0, to: 50, need: 120 }]);
    expect(s.some((x) => x.kind === 'levelUp' || x.kind === 'unlock' || x.kind === 'tip')).toBe(false);
  });

  it('after level 30 the bar opens boxes', () => {
    const r = report(prof({ xp: 19700, lastPlayDay: TODAY }), [{ kind: 'teilnahme', xp: 1100 }]);
    const s = podiumScript(r, { tip: false });
    expect(of(s, 'bar').map(({ level, from, to, need }) => ({ level, from, to, need }))).toEqual([
      { level: 29, from: 1220, to: 1240, need: 1240 },
      { level: 30, from: 0, to: 1000, need: 1000 },
      { level: 30, from: 0, to: 80, need: 1000 },
    ]);
    expect(s.filter((x) => x.kind !== 'item' && x.kind !== 'bar').map((x) => x.kind)).toEqual(['levelUp', 'unlock', 'box']);
    expect(of(s, 'box')).toMatchObject([{ item: 'emote.schnarchen' }]);
    expect(of(s, 'unlock')).toMatchObject([{ item: 'hat.krone_glitzer' }]);
  });

  it('a box with every pool item owned gives only the star', () => {
    const r = report(prof({ xp: 19720, lastPlayDay: TODAY }), [{ kind: 'teilnahme', xp: 1000 }], [...CONFIG.progress.boxPool]);
    expect(of(podiumScript(r, { tip: false }), 'box')).toMatchObject([{ item: null }]);
  });

  it('exactly on a level boundary the level-up step carries the new level and its need (bar resets to 0/need)', () => {
    const r = report(prof({ xp: 0, lastPlayDay: TODAY }), [{ kind: 'teilnahme', xp: 120 }]);
    const s = podiumScript(r, { tip: false });
    expect(of(s, 'bar')).toMatchObject([{ level: 1, from: 0, to: 120, need: 120 }]);
    expect(of(s, 'levelUp')).toEqual([{ at: expect.any(Number), kind: 'levelUp', level: 2, need: 160 }]);
  });
});

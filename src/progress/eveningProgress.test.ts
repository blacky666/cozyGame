import { beforeEach, describe, expect, it } from 'vitest';
import type { EveningPhase } from '../flow/evening';
import { defaultProfile, type Profile } from '../save/profile';
import { createEveningProgress, resetSaveTip } from './eveningProgress';
import type { XpLine } from './xp';

const TODAY = '2026-11-12';
const lines = (xp: number): Record<string, XpLine[]> => ({ p1: [{ kind: 'teilnahme', xp }], p0: [{ kind: 'teilnahme', xp: 999 }] });
const standings = (id: string, xp: number, round = 1): EveningPhase => ({
  kind: 'standings', round, points: {}, totals: {}, tieOrder: [], eveningId: id, xp: lines(xp),
});
const podium = (id: string, xp: number): EveningPhase => ({
  kind: 'podium', ranking: [], totals: {}, tieOrder: [], eveningId: id, xp: lines(xp),
});

function setup(start: Partial<Profile> = {}) {
  let stored: Profile = { ...defaultProfile('Mo'), lastPlayDay: TODAY, ...start };
  const saves: Profile[] = [];
  const progress = createEveningProgress({
    selfKey: () => 'p1',
    load: () => stored,
    save: (p) => {
      stored = p;
      saves.push(p);
    },
    today: () => TODAY,
    rand: () => 0,
  });
  return { progress, saves, stored: () => stored };
}

beforeEach(() => resetSaveTip());

describe('eveningProgress', () => {
  it('standings then podium save once with the podium lines; repeats change nothing', () => {
    const s = setup();
    s.progress.onPhase(standings('e1', 60));
    expect(s.saves).toHaveLength(0);
    expect(s.progress.report()).toBeNull();
    s.progress.onPhase(podium('e1', 150));
    expect(s.saves).toHaveLength(1);
    expect(s.stored().xp).toBe(150);
    expect(s.progress.report()).toMatchObject({ xpBefore: 0, xpAfter: 150 });
    s.progress.onPhase(podium('e1', 150));
    expect(s.saves).toHaveLength(1);
    expect(s.progress.report()).not.toBeNull();
  });

  it('hostLost after a standings settles the standings lines', () => {
    const s = setup();
    s.progress.onPhase(standings('e1', 60));
    s.progress.onPhase(standings('e1', 90, 2));
    s.progress.hostLost();
    expect(s.saves).toHaveLength(1);
    expect(s.stored()).toMatchObject({ xp: 90, lastEveningId: 'e1' });
  });

  it('hostLost after the podium saves nothing more', () => {
    const s = setup();
    s.progress.onPhase(standings('e1', 60));
    s.progress.onPhase(podium('e1', 150));
    s.progress.hostLost();
    expect(s.saves).toHaveLength(1);
    expect(s.stored().xp).toBe(150);
  });

  it('hostLost before any standings saves nothing', () => {
    const s = setup();
    s.progress.onPhase({ kind: 'intro', round: 1, game: 'g', double: false });
    s.progress.hostLost();
    expect(s.saves).toHaveLength(0);
  });

  it('ignores phases without own lines or with malformed xp data', () => {
    const s = setup();
    s.progress.onPhase({ ...standings('e1', 60), xp: {} } as EveningPhase);
    s.progress.onPhase({ ...podium('e1', 60), xp: { p1: 'nope' } } as unknown as EveningPhase);
    s.progress.hostLost();
    expect(s.saves).toHaveLength(0);
    expect(s.progress.report()).toBeNull();
  });
});

describe('takeSaveTip', () => {
  it('is true once after a level-up report, then false', () => {
    const s = setup();
    s.progress.onPhase(podium('e1', 150));
    expect(s.progress.takeSaveTip()).toBe(true);
    expect(s.progress.takeSaveTip()).toBe(false);
    // A second evening in the same page session: no tip again.
    const t = setup({ xp: 150 });
    t.progress.onPhase(podium('e2', 500));
    expect(t.progress.report()!.levelAfter).toBeGreaterThan(t.progress.report()!.levelBefore);
    expect(t.progress.takeSaveTip()).toBe(false);
  });

  it('is false without a level-up and without a report', () => {
    const s = setup();
    expect(s.progress.takeSaveTip()).toBe(false);
    s.progress.onPhase(podium('e1', 60));
    expect(s.progress.report()!.levelAfter).toBe(1);
    expect(s.progress.takeSaveTip()).toBe(false);
  });
});

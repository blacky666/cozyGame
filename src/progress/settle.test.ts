import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { defaultProfile, type Profile } from '../save/profile';
import { settleEvening } from './settle';
import type { XpLine } from './xp';

const TODAY = '2026-11-12';
const prof = (o: Partial<Profile>): Profile => ({ ...defaultProfile('Mo'), ...o });
/** Lines summing 105: Teilnahme 50, Platz 25, Platz 10, Erfolg 5, Platz 2 gesamt 15 -> as from the host. */
const LINES_105: XpLine[] = [
  { kind: 'teilnahme', xp: 50 },
  { kind: 'platz', round: 1, place: 1, xp: 25 },
  { kind: 'platz', round: 2, place: 3, xp: 10 },
  { kind: 'erfolg', round: 1, feat: 'schubser', xp: 5 },
  { kind: 'platz', round: 3, place: 4, xp: 15 },
];
const one = (xp: number): XpLine[] => [{ kind: 'teilnahme', xp }];
const rand0 = () => 0;

describe('settleEvening', () => {
  it('adds the lines and the day bonus, levels up and lists the unlock', () => {
    const p = prof({ xp: 100, lastPlayDay: '2026-11-11' });
    const { profile, report } = settleEvening(p, 'e1', LINES_105, { today: TODAY, rand: rand0 });
    expect(report).not.toBeNull();
    expect(report!.xpBefore).toBe(100);
    expect(report!.xpAfter).toBe(255);
    expect(report!.lines).toContainEqual({ kind: 'tag', xp: 50 });
    expect(report!.lines.slice(0, LINES_105.length)).toEqual(LINES_105);
    expect([report!.levelBefore, report!.levelAfter]).toEqual([1, 2]);
    expect(report!.unlocks).toEqual([{ level: 2, item: 'emote.zunge' }]);
    expect(report!.boxes).toEqual([]);
    expect(profile).toMatchObject({ xp: 255, lastPlayDay: TODAY, lastEveningId: 'e1' });
    expect(p.xp).toBe(100); // the input stays untouched
  });

  it('on the same day there is no day bonus', () => {
    const { report } = settleEvening(prof({ xp: 100, lastPlayDay: TODAY }), 'e1', LINES_105, { today: TODAY, rand: rand0 });
    expect(report!.lines.some((l) => l.kind === 'tag')).toBe(false);
    expect(report!.xpAfter).toBe(205);
  });

  it('settles one evening id only once', () => {
    const first = settleEvening(prof({ xp: 100 }), 'e1', LINES_105, { today: TODAY, rand: rand0 });
    const second = settleEvening(first.profile, 'e1', LINES_105, { today: TODAY, rand: rand0 });
    expect(second.report).toBeNull();
    expect(second.profile).toEqual(first.profile);
  });

  it('does nothing without lines', () => {
    const p = prof({ xp: 100 });
    const r = settleEvening(p, 'e1', [], { today: TODAY, rand: rand0 });
    expect(r.report).toBeNull();
    expect(r.profile).toBe(p);
  });

  it('crossing level 30 unlocks the crown and opens a box', () => {
    const p = prof({ xp: 19700, lastPlayDay: TODAY });
    const { profile, report } = settleEvening(p, 'e1', one(1100), { today: TODAY, rand: rand0 });
    expect(report!.xpAfter).toBe(20800);
    expect(report!.unlocks).toEqual([{ level: 30, item: 'hat.krone_glitzer' }]);
    expect(report!.boxes).toEqual([{ item: 'emote.schnarchen' }]);
    expect(profile.unlocked).toContain('emote.schnarchen');
  });

  it('a box with the whole pool unlocked gives only the star', () => {
    const p = prof({ xp: 19700, lastPlayDay: TODAY, unlocked: [...CONFIG.progress.boxPool] });
    const { profile, report } = settleEvening(p, 'e1', one(1100), { today: TODAY, rand: rand0 });
    expect(report!.boxes).toEqual([{ item: null }]);
    expect(profile.unlocked).toEqual([...CONFIG.progress.boxPool]);
  });

  it('several boxes in one evening never give an item twice', () => {
    const p = prof({ xp: 19720, lastPlayDay: TODAY });
    const { profile, report } = settleEvening(p, 'e1', one(3000), { today: TODAY, rand: rand0 });
    expect(report!.boxes.map((b) => b.item)).toEqual(['emote.schnarchen', 'hat.bauhelm', 'hat.kochmuetze']);
    expect(profile.unlocked).toEqual(['emote.schnarchen', 'hat.bauhelm', 'hat.kochmuetze']);
  });

  it('a multi-level jump lists every level reward in order', () => {
    const { report } = settleEvening(prof({ xp: 0 }), 'e1', one(950), { today: TODAY, rand: rand0 });
    expect(report!.xpAfter).toBe(1000);
    expect(report!.unlocks.map((u) => u.level)).toEqual([2, 3, 4, 5, 6]);
    expect(report!.unlocks.map((u) => u.item)).toEqual(['emote.zunge', 'hat.zylinder', 'face.rundbrille', 'prank.furzkissen', 'emote.tanzen']);
  });

  it('ignores malformed lines and a tag line from the host', () => {
    const bad = [{ kind: 'teilnahme', xp: 50 }, { kind: 'tag', xp: 50 }, { kind: 'platz', xp: -5 }, { kind: 'x', xp: 9 }, null, { kind: 'teilnahme', xp: Number.NaN }];
    const { report } = settleEvening(prof({ xp: 0, lastPlayDay: TODAY }), 'e1', bad as XpLine[], { today: TODAY, rand: rand0 });
    expect(report!.xpAfter).toBe(50);
    expect(report!.lines).toEqual([{ kind: 'teilnahme', xp: 50 }]);
  });
});

import { describe, expect, it } from 'vitest';
import { levelInfo, xpToReach } from './levels';

describe('xpToReach', () => {
  it.each([
    [1, 0], [2, 120], [3, 280], [6, 1000], [11, 3000], [30, 19720],
  ])('level %i needs %i XP', (level, xp) => {
    expect(xpToReach(level)).toBe(xp);
  });
});

describe('levelInfo', () => {
  it.each([
    [0, { level: 1, into: 0, need: 120, boxes: 0 }],
    [119, { level: 1, into: 119, need: 120, boxes: 0 }],
    [120, { level: 2, into: 0, need: 160, boxes: 0 }],
    [19719, { level: 29, into: 1239, need: 1240, boxes: 0 }],
    [19720, { level: 30, into: 0, need: 1000, boxes: 0 }],
    [20719, { level: 30, into: 999, need: 1000, boxes: 0 }],
    [22720, { level: 30, into: 0, need: 1000, boxes: 3 }],
  ])('xp %i', (xp, info) => {
    expect(levelInfo(xp)).toEqual(info);
  });
  it('treats negative and NaN XP as level 1', () => {
    expect(levelInfo(-5)).toEqual({ level: 1, into: 0, need: 120, boxes: 0 });
    expect(levelInfo(Number.NaN)).toEqual({ level: 1, into: 0, need: 120, boxes: 0 });
  });
});

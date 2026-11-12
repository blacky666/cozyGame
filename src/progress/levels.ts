import { CONFIG } from '../config';

const P = CONFIG.progress;

/** Cumulative XP needed to reach `level` (level 1 = 0). XP from n to n+1 is levelBase + levelStep * n. */
export function xpToReach(level: number): number {
  const n = Math.max(0, Math.floor(level) - 1);
  return P.levelBase * n + (P.levelStep / 2) * n * (n + 1);
}

/**
 * level: current level (1..maxLevel). into/need: XP inside the current level, after maxLevel inside the
 * current box step. boxes: surprise boxes (= stars) earned after maxLevel.
 */
export type LevelInfo = { level: number; into: number; need: number; boxes: number };

export function levelInfo(xp: number): LevelInfo {
  const x = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  const capXp = xpToReach(P.maxLevel);
  if (x >= capXp) {
    const over = x - capXp;
    return { level: P.maxLevel, into: over % P.boxEveryXp, need: P.boxEveryXp, boxes: Math.floor(over / P.boxEveryXp) };
  }
  let level = 1;
  while (level < P.maxLevel && xpToReach(level + 1) <= x) level++;
  const base = xpToReach(level);
  return { level, into: x - base, need: xpToReach(level + 1) - base, boxes: 0 };
}

/** Level and stars as shown on the lobby cards. */
export function levelBadge(xp: number): { level: number; stars: number } {
  const i = levelInfo(xp);
  return { level: i.level, stars: i.boxes };
}

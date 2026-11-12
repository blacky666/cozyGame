import { CONFIG } from '../config';
import type { Profile } from '../save/profile';
import { isFeatId } from './feats';
import { isBoxItem, type ItemId } from './items';
import { levelInfo } from './levels';
import type { XpLine } from './xp';

const P = CONFIG.progress;

/** What one evening did to the own profile (drives the podium XP panel). */
export type SettleReport = {
  /** The host's lines plus the client-side 'tag' line. */
  lines: XpLine[];
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  /** Level rewards crossed, ascending. */
  unlocks: { level: number; item: ItemId }[];
  /** Surprise boxes crossed; null = every pool item already owned, only the star. */
  boxes: { item: ItemId | null }[];
};

const xpOk = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const intOk = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

/**
 * Keeps well-formed host lines only. A 'tag' line never comes from the host (the day bonus is added
 * here), so one arriving over the network is dropped.
 */
function cleanLines(raw: unknown): XpLine[] {
  if (!Array.isArray(raw)) return [];
  const out: XpLine[] = [];
  for (const l of raw as unknown[]) {
    if (typeof l !== 'object' || l === null) continue;
    const o = l as Record<string, unknown>;
    if (!xpOk(o.xp)) continue;
    if (o.kind === 'teilnahme') out.push({ kind: 'teilnahme', xp: o.xp });
    else if (o.kind === 'platz' && intOk(o.round) && intOk(o.place)) out.push({ kind: 'platz', round: o.round, place: o.place, xp: o.xp });
    else if (o.kind === 'gesamt' && (o.place === 1 || o.place === 2)) out.push({ kind: 'gesamt', place: o.place, xp: o.xp });
    else if (o.kind === 'erfolg' && intOk(o.round) && isFeatId(o.feat)) out.push({ kind: 'erfolg', round: o.round, feat: o.feat, xp: o.xp });
  }
  return out;
}

/**
 * Applies the own XP lines of one evening to the profile, exactly once per eveningId. Adds the day bonus
 * when the last settled evening was on another local day, and opens a box per boxEveryXp after maxLevel.
 * Returns the input profile and report null when there is nothing to settle.
 */
export function settleEvening(
  p: Profile,
  eveningId: string,
  lines: XpLine[],
  o: { today: string; rand: () => number },
): { profile: Profile; report: SettleReport | null } {
  const host = cleanLines(lines);
  if (p.lastEveningId === eveningId || host.length === 0) return { profile: p, report: null };
  const all: XpLine[] = p.lastPlayDay !== o.today ? [...host, { kind: 'tag', xp: P.dayBonusXp }] : host;
  const xpBefore = p.xp;
  const xpAfter = xpBefore + all.reduce((a, l) => a + l.xp, 0);
  const before = levelInfo(xpBefore);
  const after = levelInfo(xpAfter);

  const unlocks: SettleReport['unlocks'] = [];
  for (let level = before.level + 1; level <= after.level; level++) {
    const item = P.rewards[level];
    if (item) unlocks.push({ level, item });
  }

  const unlocked = p.unlocked.filter(isBoxItem);
  const boxes: SettleReport['boxes'] = [];
  for (let i = before.boxes; i < after.boxes; i++) {
    const missing = P.boxPool.filter((id) => !unlocked.includes(id));
    const item = missing.length > 0 ? missing[Math.min(missing.length - 1, Math.floor(o.rand() * missing.length))] : null;
    if (item) unlocked.push(item);
    boxes.push({ item });
  }

  return {
    profile: { ...p, xp: xpAfter, unlocked, lastEveningId: eveningId, lastPlayDay: o.today },
    report: { lines: all, xpBefore, xpAfter, levelBefore: before.level, levelAfter: after.level, unlocks, boxes },
  };
}

import { CONFIG } from '../config';
import type { ItemId } from './items';
import { levelInfo, xpToReach } from './levels';
import type { SettleReport } from './settle';
import { podiumItems } from './xp';

const P = CONFIG.progress;

/** One beat of the podium XP panel; `at` is relative to podium.startMs. */
export type PodiumStep =
  | { at: number; kind: 'item'; label: string; xp: number }
  | { at: number; kind: 'bar'; level: number; from: number; to: number; need: number; ms: number }
  | { at: number; kind: 'levelUp'; level: number }
  | { at: number; kind: 'unlock'; item: ItemId }
  | { at: number; kind: 'box'; item: ItemId | null }
  | { at: number; kind: 'tip' };

/**
 * The podium's XP settlement as a timeline: the item rows one per itemMs, then the level bar one segment
 * per level (or box step after maxLevel) touched, barMs each. A full segment ends in a levelUp plus that
 * level's unlock card, or in a box after maxLevel; each card holds the bar for unlockMs. The save tip last.
 */
export function podiumScript(r: SettleReport, o: { tip: boolean }): PodiumStep[] {
  const out: PodiumStep[] = [];
  let t = 0;
  for (const it of podiumItems(r.lines)) {
    out.push({ at: t, kind: 'item', label: it.label, xp: it.xp });
    t += P.podium.itemMs;
  }

  const capXp = xpToReach(P.maxLevel);
  const unlockAt = new Map(r.unlocks.map((u) => [u.level, u.item]));
  const boxes = [...r.boxes];
  let x = r.xpBefore;
  let first = true;
  while (first || x < r.xpAfter) {
    const info = levelInfo(x);
    // End of the current segment in absolute XP: next level, or next box step after maxLevel.
    const end = x >= capXp ? x - info.into + info.need : xpToReach(info.level + 1);
    const segEnd = Math.min(end, r.xpAfter);
    const from = info.into;
    const to = from + (segEnd - x);
    if (to > from || first) {
      out.push({ at: t, kind: 'bar', level: info.level, from, to, need: info.need, ms: P.podium.barMs });
      t += P.podium.barMs;
    }
    first = false;
    if (segEnd === end) {
      if (x < capXp) {
        const level = info.level + 1;
        out.push({ at: t, kind: 'levelUp', level });
        const item = unlockAt.get(level);
        if (item) out.push({ at: t, kind: 'unlock', item });
        t += P.podium.unlockMs;
      } else {
        out.push({ at: t, kind: 'box', item: boxes.shift()?.item ?? null });
        t += P.podium.unlockMs;
      }
    }
    if (segEnd <= x) break; // no progress (xpAfter === xpBefore)
    x = segEnd;
  }

  if (o.tip) out.push({ at: t, kind: 'tip' });
  return out;
}

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
  | { at: number; kind: 'levelUp'; level: number; need: number }
  | { at: number; kind: 'unlock'; item: ItemId }
  | { at: number; kind: 'box'; item: ItemId | null }
  | { at: number; kind: 'tip' };

/** Rows the XP panel can show. */
export const MAX_ITEM_ROWS = 8;
const FIXED_ROWS = new Set(['Teilnahme', 'Rundenplätze', 'Gesamtsieg', 'Platz 2 gesamt', 'Erster Abend heute']);

/** Fit the rows into max: surplus feat rows (anything not fixed) merge into one "Weitere Erfolge" row, summed XP. */
export function capItems(rows: { label: string; xp: number }[], max = MAX_ITEM_ROWS): { label: string; xp: number }[] {
  if (rows.length <= max) return rows;
  const feats = rows.filter((r) => !FIXED_ROWS.has(r.label));
  const keep = new Set(feats.slice(0, Math.max(0, max - (rows.length - feats.length) - 1)));
  const rest = feats.filter((r) => !keep.has(r));
  const out: { label: string; xp: number }[] = [];
  let merged = false;
  for (const r of rows) {
    if (!FIXED_ROWS.has(r.label) && !keep.has(r)) {
      if (!merged) {
        out.push({ label: 'Weitere Erfolge', xp: rest.reduce((a, x) => a + x.xp, 0) });
        merged = true;
      }
    } else out.push(r);
  }
  return out;
}

/**
 * The podium's XP settlement as a timeline: the item rows one per itemMs, then the level bar one segment
 * per level (or box step after maxLevel) touched, barMs each. A full segment ends in a levelUp plus that
 * level's unlock card, or in a box after maxLevel; each card holds the bar for unlockMs. The save tip last.
 */
export function podiumScript(r: SettleReport, o: { tip: boolean }): PodiumStep[] {
  const out: PodiumStep[] = [];
  let t = 0;
  for (const it of capItems(podiumItems(r.lines))) {
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
        out.push({ at: t, kind: 'levelUp', level, need: levelInfo(xpToReach(level)).need });
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

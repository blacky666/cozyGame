import { CONFIG } from '../config';

/** Points for one round. `placements` = tie groups, best first. */
export function roundPoints(
  placements: string[][],
  playerCount: number,
  multiplier: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  let place = 0;
  for (const group of placements) {
    const base = place < playerCount ? (CONFIG.points[place] ?? 0) : 0;
    for (const id of group) out[id] = base * multiplier;
    place += group.length;
  }
  return out;
}

/** Final standings as tie groups: total points, then round wins. */
export function finalRanking(
  totals: Record<string, number>,
  roundWins: Record<string, number>,
): string[][] {
  const ids = Object.keys(totals).sort(
    (a, b) => totals[b] - totals[a] || (roundWins[b] ?? 0) - (roundWins[a] ?? 0),
  );
  const groups: string[][] = [];
  for (const id of ids) {
    const prev = groups[groups.length - 1]?.[0];
    if (prev !== undefined && totals[prev] === totals[id] && (roundWins[prev] ?? 0) === (roundWins[id] ?? 0)) {
      groups[groups.length - 1].push(id);
    } else {
      groups.push([id]);
    }
  }
  return groups;
}

/** 1-based rank of a player by points (ties share a rank). */
export function rankOf(totals: Record<string, number>, key: string): number {
  return 1 + Object.values(totals).filter((t) => t > (totals[key] ?? 0)).length;
}

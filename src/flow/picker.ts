/**
 * Picks one minigame per round: never the same game twice in a row (when
 * avoidable) and every game at least once when rounds >= ids.length. Always
 * chooses among the least-used candidates, so usage stays balanced.
 */
export function pickMinigames(ids: string[], rounds: number, rand: () => number): string[] {
  if (ids.length === 0) throw new Error('no minigames to pick from');
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));
  const out: string[] = [];
  for (let i = 0; i < rounds; i++) {
    const prev = out[i - 1];
    let candidates = ids.filter((id) => id !== prev);
    if (candidates.length === 0) candidates = ids;
    const min = Math.min(...candidates.map((id) => counts.get(id)!));
    const pool = candidates.filter((id) => counts.get(id) === min);
    const pick = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
    counts.set(pick, counts.get(pick)! + 1);
    out.push(pick);
  }
  return out;
}

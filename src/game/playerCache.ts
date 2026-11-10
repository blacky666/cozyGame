import type { PlayerInfo } from '../net/roster';
import { playerKey, type PlayerKey } from '../minigames/types';

/**
 * Players of one evening by PlayerKey. Live roster entries win; players whose reconnect grace
 * expired (and who left the roster) stay known, so standings and podium can still name them.
 */
export function createPlayerCache(roster: () => PlayerInfo[]): () => PlayerInfo[] {
  const cache = new Map<PlayerKey, PlayerInfo>();
  return () => {
    const live = new Set<PlayerKey>();
    for (const p of roster()) {
      const k = playerKey(p.slot);
      live.add(k);
      cache.set(k, { ...p });
    }
    for (const [k, p] of cache) if (!live.has(k) && p.connected) cache.set(k, { ...p, connected: false });
    return [...cache.values()].sort((a, b) => a.slot - b.slot);
  };
}

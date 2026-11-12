import type { EveningPhase } from '../flow/evening';
import type { PlayerKey } from '../minigames/types';
import { localDay, type Profile } from '../save/profile';
import { settleEvening, type SettleReport } from './settle';
import type { XpLine } from './xp';

/**
 * Client-side settlement of one evening (the host runs the same for its own player): remembers the own
 * lines of every standings, settles and saves on the podium, or with the last standings when the host
 * is lost (spec §3.2). Settling is idempotent per eveningId (profile.lastEveningId).
 */
export interface EveningProgress {
  /** standings: remember the own lines; podium: settle and save. */
  onPhase(p: EveningPhase): void;
  /** Settle the last remembered standings lines (nothing before round 1 ended). */
  hostLost(): void;
  /** The podium's report (null before, or when nothing was earned). */
  report(): SettleReport | null;
  /** True once per page session, and only when the report shows a level-up. */
  takeSaveTip(): boolean;
}

// One page session is about one evening (also across "Nochmal?"): the save tip shows at most once (§3.3).
let saveTipShown = false;

/** Test hook: forget that the save tip was shown. */
export function resetSaveTip(): void {
  saveTipShown = false;
}

export function createEveningProgress(o: {
  selfKey: () => PlayerKey;
  load: () => Profile;
  save: (p: Profile) => void;
  today?: () => string;
  rand?: () => number;
}): EveningProgress {
  const today = o.today ?? (() => localDay(new Date()));
  const rand = o.rand ?? Math.random;
  let pending: { eveningId: string; lines: XpLine[] } | null = null;
  let last: SettleReport | null = null;

  const own = (p: { eveningId?: unknown; xp?: unknown }): { eveningId: string; lines: XpLine[] } | null => {
    if (typeof p.eveningId !== 'string' || typeof p.xp !== 'object' || p.xp === null) return null;
    const lines = (p.xp as Record<string, unknown>)[o.selfKey()];
    return Array.isArray(lines) ? { eveningId: p.eveningId, lines: lines as XpLine[] } : null;
  };

  const settle = (eveningId: string, lines: XpLine[]): SettleReport | null => {
    const r = settleEvening(o.load(), eveningId, lines, { today: today(), rand });
    if (r.report) o.save(r.profile);
    return r.report;
  };

  return {
    onPhase(p) {
      if (p.kind === 'standings') {
        const mine = own(p);
        if (!mine) return;
        if (pending?.eveningId !== mine.eveningId) last = null;
        pending = mine;
      } else if (p.kind === 'podium') {
        const mine = own(p);
        if (!mine) return;
        pending = null;
        const r = settle(mine.eveningId, mine.lines);
        if (r) last = r;
      }
    },
    hostLost() {
      if (!pending) return;
      const { eveningId, lines } = pending;
      pending = null;
      settle(eveningId, lines);
    },
    report() {
      return last;
    },
    takeSaveTip() {
      if (saveTipShown || !last || last.levelAfter <= last.levelBefore) return false;
      saveTipShown = true;
      return true;
    },
  };
}

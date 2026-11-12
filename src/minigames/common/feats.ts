import { CONFIG } from '../../config';
import type { FeatId } from '../../progress/feats';
import type { PlayerKey } from '../types';
import type { ShoveHit } from './shove';

/** Per-round achievement bookkeeping of a minigame host (one tracker per round). */
export class FeatTracker {
  private readonly counts = new Map<string, number>();
  private readonly awarded = new Map<PlayerKey, FeatId[]>();

  /** Adds n to the player's counter for this feat and returns the new count. */
  count(key: PlayerKey, id: FeatId, n = 1): number {
    const k = `${key}|${id}`;
    const c = (this.counts.get(k) ?? 0) + n;
    this.counts.set(k, c);
    return c;
  }

  /** Sets the player's counter for this feat back to 0 (e.g. a broken streak). */
  reset(key: PlayerKey, id: FeatId): void {
    this.counts.delete(`${key}|${id}`);
  }

  /** Awards a feat (once per player). */
  award(key: PlayerKey, id: FeatId): void {
    const list = this.awarded.get(key) ?? [];
    if (list.includes(id)) return;
    list.push(id);
    this.awarded.set(key, list);
  }

  has(key: PlayerKey, id: FeatId): boolean {
    return this.awarded.get(key)?.includes(id) ?? false;
  }

  /** Awarded feats per player, in award order. */
  result(): Record<PlayerKey, FeatId[]> {
    const out: Record<PlayerKey, FeatId[]> = {};
    for (const [k, list] of this.awarded) out[k] = [...list];
    return out;
  }
}

/** Counts landed shoves per shover and awards `schubser` at CONFIG.progress.feats.shoves. */
export function countShoves(t: FeatTracker, hits: readonly ShoveHit[]): void {
  for (const h of hits) {
    if (t.count(h.from, 'schubser') >= CONFIG.progress.feats.shoves) t.award(h.from, 'schubser');
  }
}

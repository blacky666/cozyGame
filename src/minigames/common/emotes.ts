import { CONFIG } from '../../config';
import type { InputState } from '../../net/protocol';
import { ITEMS } from '../../progress/items';
import type { PlayerKey } from '../types';
import { Edge } from './edges';

const E = CONFIG.progress.emote;
const KNOWN: ReadonlySet<string> = new Set(ITEMS.filter((i) => i.cat === 'emote').map((i) => i.name));

/** One emote bubble on screen; n counts the shows of that player (a new n = a new bubble + sound). */
export type EmoteShow = { key: PlayerKey; id: string; n: number; leftMs: number };

type PlayerState = { edge: Edge; cooldownMs: number; n: number; show: EmoteShow | null };

/**
 * Host-side emotes (spec §7.3), game-agnostic: a fresh press of key 1–4 (the `emotes` counter, slot in
 * `emote`) shows that slot's emote for showMs when the player's cooldown (counted from the press) is
 * over. Presses during the cooldown, on an empty slot or with an unknown id are dropped and start no
 * cooldown. The slot is resolved here from the roster look, so clients never send emote ids.
 */
export class EmoteHost {
  private readonly players = new Map<PlayerKey, PlayerState>();

  tick(dtMs: number, inputs: Record<PlayerKey, InputState>, slotsOf: (key: PlayerKey) => readonly (string | null)[]): void {
    for (const st of this.players.values()) {
      st.cooldownMs = Math.max(0, st.cooldownMs - dtMs);
      if (st.show) {
        st.show.leftMs -= dtMs;
        if (st.show.leftMs <= 0) st.show = null;
      }
    }
    for (const [key, input] of Object.entries(inputs)) {
      let st = this.players.get(key);
      if (!st) {
        st = { edge: new Edge(), cooldownMs: 0, n: 0, show: null };
        this.players.set(key, st);
      }
      const presses = st.edge.take(input.emotes);
      if (presses <= 0 || st.cooldownMs > 0 || input.emote === 0) continue;
      const id = slotsOf(key)[input.emote - 1];
      if (typeof id !== 'string' || !KNOWN.has(id)) continue;
      st.n++;
      st.cooldownMs = E.cooldownMs;
      st.show = { key, id, n: st.n, leftMs: E.showMs };
    }
  }

  /** Current bubbles (copies). */
  shows(): EmoteShow[] {
    const out: EmoteShow[] = [];
    for (const st of this.players.values()) if (st.show) out.push({ ...st.show });
    return out;
  }

  /** Drop the bubbles (new round); edges, cooldowns and show counters persist. */
  clear(): void {
    for (const st of this.players.values()) st.show = null;
  }
}

import { isCardId, type CardId } from '../flow/cards';

/**
 * Dev-only URL flags (only honoured together with `?dev=1`):
 * - `bots=N` (1-3): the host adds N bot players (see bots.ts).
 * - `fast=1`: all evening timings (intro, standings, minigame duration) run at 20 % for
 *   quick manual end-to-end checks. Host-side only; CONFIG defaults stay untouched.
 * - `game=<id>`: every round plays this minigame (unknown ids: the normal rotation).
 * - `card=<id>`: this Gemeinheit card is always offered first and picked by bots / on timeouts (unknown ids: off).
 */
export type DevFlags = { bots: number; timeScale: number; game: string | null; card: CardId | null };

export const FAST_SCALE = 0.2;

export function devFlags(search: string): DevFlags {
  const q = new URLSearchParams(search);
  if (q.get('dev') !== '1') return { bots: 0, timeScale: 1, game: null, card: null };
  const n = Number(q.get('bots'));
  const bots = Number.isInteger(n) ? Math.min(3, Math.max(0, n)) : 0;
  const card = q.get('card');
  return { bots, timeScale: q.get('fast') === '1' ? FAST_SCALE : 1, game: q.get('game') || null, card: isCardId(card) ? card : null };
}

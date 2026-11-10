import { CONFIG } from '../config';
import type { PlayerInfo } from '../net/roster';

export type SlotView = PlayerInfo & { isSelf: boolean };

export function lobbyModel(
  roster: PlayerInfo[],
  selfId: string,
  isHost: boolean,
  _rounds: number,
): { slots: (SlotView | null)[]; canStart: boolean; startHint: string } {
  const slots: (SlotView | null)[] = [null, null, null, null];
  for (const p of roster) slots[p.slot] = { ...p, isSelf: p.id === selfId };
  const connected = roster.filter((p) => p.connected);
  const enough = connected.length >= CONFIG.players.min;
  const allReady = connected.every((p) => p.ready);
  const canStart = isHost && enough && allReady;
  const startHint = !enough ? 'Warte auf Mitspieler …' : !allReady ? 'Warte, bis alle bereit sind …' : '';
  return { slots, canStart, startHint };
}

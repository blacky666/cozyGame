import { sandbox } from './sandbox/sandbox';
import type { MiniGame } from './types';

// Plan 2 replaces the placeholder with the real games.
export const MINIGAMES: MiniGame[] = [sandbox as MiniGame];

export function getMinigame(id: string): MiniGame | undefined {
  return MINIGAMES.find((g) => g.id === id);
}

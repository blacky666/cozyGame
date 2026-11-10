import type { MiniGame } from './types';

// Task 9 adds the placeholder game.
export const MINIGAMES: MiniGame[] = [];

export function getMinigame(id: string): MiniGame | undefined {
  return MINIGAMES.find((g) => g.id === id);
}

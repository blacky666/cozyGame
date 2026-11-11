import { sandbox } from './sandbox/sandbox';
import { snowball } from './snowball/snowball';
import type { MiniGame } from './types';

export const MINIGAMES: MiniGame[] = [snowball as MiniGame, sandbox as MiniGame];

export function getMinigame(id: string): MiniGame | undefined {
  return MINIGAMES.find((g) => g.id === id);
}

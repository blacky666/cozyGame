import { farbkrieg } from './farbkrieg/farbkrieg';
import { kartoffel } from './kartoffel/kartoffel';
import { snowball } from './snowball/snowball';
import type { MiniGame } from './types';

// Münzjagd (./sandbox) left the rotation; its code stays as a headless test fixture.
export const MINIGAMES: MiniGame[] = [snowball as MiniGame, kartoffel as MiniGame, farbkrieg as MiniGame];

export function getMinigame(id: string): MiniGame | undefined {
  return MINIGAMES.find((g) => g.id === id);
}

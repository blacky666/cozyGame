import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { MINIGAMES } from '../minigames/registry';
import { SOUND_PACKAGES } from './packages';

// The registry pulls in the views (Phaser needs a window); only the game definitions matter here.
vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {} } } }));

describe('sound packages', () => {
  it('every game package is preloaded and shipped', () => {
    for (const g of MINIGAMES) if (g.sounds) expect(SOUND_PACKAGES).toContain(g.sounds);
    for (const p of SOUND_PACKAGES) expect(existsSync(`public/audio/${p}/sounds.json`)).toBe(true);
  });
});

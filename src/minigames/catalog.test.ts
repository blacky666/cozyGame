import { describe, expect, it, vi } from 'vitest';
import { cleanSelection, GAME_CATALOG, GAMES_KEY, loadSelection } from './catalog';
import { MINIGAMES } from './registry';

vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {} } } }));

const store = (v: string | null): Storage => ({ getItem: (k: string) => (k === GAMES_KEY ? v : null) }) as Storage;

describe('game catalog', () => {
  it('matches the registry (ids and titles)', () => {
    expect(GAME_CATALOG.map((g) => g.id)).toEqual(['schneeball', 'kartoffel', 'farbkrieg', 'wackelturm']);
    expect(GAME_CATALOG.map((g) => [g.id, g.title])).toEqual(MINIGAMES.map((g) => [g.id, g.title]));
  });

  it('keeps known ids in catalog order; empty means all', () => {
    expect(cleanSelection(['kartoffel', 'gibtsnicht', 'muenzjagd', 'schneeball'])).toEqual(['schneeball', 'kartoffel']);
    expect(cleanSelection(['farbkrieg', 'schneeball'])).toEqual(['schneeball', 'farbkrieg']);
    expect(cleanSelection(['gibtsnicht'])).toEqual(['schneeball', 'kartoffel', 'farbkrieg', 'wackelturm']);
  });

  it('loads the stored choice, falls back to all', () => {
    expect(loadSelection(store('["kartoffel"]'))).toEqual(['kartoffel']);
    expect(loadSelection(store('{oops'))).toEqual(['schneeball', 'kartoffel', 'farbkrieg', 'wackelturm']);
    expect(loadSelection(store(null))).toEqual(['schneeball', 'kartoffel', 'farbkrieg', 'wackelturm']);
  });
});

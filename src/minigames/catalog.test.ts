import { describe, expect, it, vi } from 'vitest';
import { cleanSelection, GAME_CATALOG, GAMES_KEY, loadSelection } from './catalog';
import { MINIGAMES } from './registry';

vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {} } } }));

const store = (v: string | null): Storage => ({ getItem: (k: string) => (k === GAMES_KEY ? v : null) }) as Storage;

describe('game catalog', () => {
  it('matches the registry (ids and titles)', () => {
    expect(GAME_CATALOG.map((g) => [g.id, g.title])).toEqual(MINIGAMES.map((g) => [g.id, g.title]));
  });

  it('keeps known ids in catalog order; empty means all', () => {
    expect(cleanSelection(['muenzjagd', 'gibtsnicht', 'schneeball'])).toEqual(['schneeball', 'muenzjagd']);
    expect(cleanSelection(['gibtsnicht'])).toEqual(['schneeball', 'muenzjagd']);
  });

  it('loads the stored choice, falls back to all', () => {
    expect(loadSelection(store('["muenzjagd"]'))).toEqual(['muenzjagd']);
    expect(loadSelection(store('{oops'))).toEqual(['schneeball', 'muenzjagd']);
    expect(loadSelection(store(null))).toEqual(['schneeball', 'muenzjagd']);
  });
});

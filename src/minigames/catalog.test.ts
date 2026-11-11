import { describe, expect, it, vi } from 'vitest';
import { cleanSelection, GAME_CATALOG, GAMES_KEY, GAMES_OFF_KEY, loadSelection, saveSelection } from './catalog';
import { MINIGAMES } from './registry';

vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {} } } }));

const ALL = ['schneeball', 'kartoffel', 'farbkrieg', 'wackelturm'];

/** Map-backed Storage. */
function memory(init: Record<string, string> = {}): Storage & { map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as unknown as Storage & { map: Map<string, string> };
}

describe('game catalog', () => {
  it('matches the registry (ids and titles)', () => {
    expect(GAME_CATALOG.map((g) => g.id)).toEqual(ALL);
    expect(GAME_CATALOG.map((g) => [g.id, g.title])).toEqual(MINIGAMES.map((g) => [g.id, g.title]));
  });

  it('keeps known ids in catalog order; empty means all', () => {
    expect(cleanSelection(['kartoffel', 'gibtsnicht', 'muenzjagd', 'schneeball'])).toEqual(['schneeball', 'kartoffel']);
    expect(cleanSelection(['farbkrieg', 'schneeball'])).toEqual(['schneeball', 'farbkrieg']);
    expect(cleanSelection(['gibtsnicht'])).toEqual(ALL);
  });

  it('migrates the old chosen-ids key: games newer than it are on, the old key is gone', () => {
    const s = memory({ [GAMES_KEY]: '["kartoffel"]' });
    expect(loadSelection(s)).toEqual(['kartoffel', 'wackelturm']);
    expect(s.map.has(GAMES_KEY)).toBe(false);
    expect(JSON.parse(s.map.get(GAMES_OFF_KEY)!)).toEqual(['schneeball', 'farbkrieg']);
    expect(loadSelection(s)).toEqual(['kartoffel', 'wackelturm']);
  });

  it('loads the deselected ids', () => {
    expect(loadSelection(memory({ [GAMES_OFF_KEY]: '["farbkrieg"]' }))).toEqual(['schneeball', 'kartoffel', 'wackelturm']);
  });

  it('save/load round trip stores the deselected ids and drops the old key', () => {
    const s = memory({ [GAMES_KEY]: '["schneeball"]' });
    saveSelection(['kartoffel', 'wackelturm'], s);
    expect(JSON.parse(s.map.get(GAMES_OFF_KEY)!)).toEqual(['schneeball', 'farbkrieg']);
    expect(s.map.has(GAMES_KEY)).toBe(false);
    expect(loadSelection(s)).toEqual(['kartoffel', 'wackelturm']);
  });

  it('falls back to all games on broken JSON or nothing stored', () => {
    expect(loadSelection(memory({ [GAMES_OFF_KEY]: '{oops' }))).toEqual(ALL);
    expect(loadSelection(memory({ [GAMES_KEY]: '{oops' }))).toEqual(ALL);
    expect(loadSelection(memory())).toEqual(ALL);
    // An old choice without a valid id meant all games, and migrates to nothing deselected.
    const empty = memory({ [GAMES_KEY]: '["gibtsnicht"]' });
    expect(loadSelection(empty)).toEqual(ALL);
    expect(JSON.parse(empty.map.get(GAMES_OFF_KEY)!)).toEqual([]);
  });

  it('a game added to the catalog later is on by default', () => {
    // Saved before 'wackelturm' was chosen or not: only the deselected ids are stored, so any id
    // the catalog gains afterwards is not in the list and therefore on.
    const s = memory({ [GAMES_OFF_KEY]: '["schneeball"]' });
    expect(loadSelection(s)).toContain('wackelturm');
    const old = memory({ [GAMES_KEY]: '["schneeball","kartoffel","farbkrieg"]' });
    expect(loadSelection(old)).toEqual(ALL);
  });

  it('everything deselected still plays all games', () => {
    expect(loadSelection(memory({ [GAMES_OFF_KEY]: JSON.stringify(ALL) }))).toEqual(ALL);
  });
});

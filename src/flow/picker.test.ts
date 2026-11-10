import { describe, expect, it } from 'vitest';
import { pickMinigames } from './picker';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('pickMinigames', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('never puts equal games next to each other', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const r = pickMinigames(ids, 8, lcg(seed));
      expect(r).toHaveLength(8);
      for (let i = 1; i < r.length; i++) expect(r[i]).not.toBe(r[i - 1]);
    }
  });
  it('uses every game when rounds >= number of games', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(new Set(pickMinigames(ids, 6, lcg(seed)))).toEqual(new Set(ids));
    }
  });
  it('allows repeats with a single game', () => {
    expect(pickMinigames(['x'], 5, lcg(1))).toEqual(['x', 'x', 'x', 'x', 'x']);
  });
  it('is deterministic for a given rand', () => {
    expect(pickMinigames(ids, 8, lcg(7))).toEqual(pickMinigames(ids, 8, lcg(7)));
  });
  it('avoids neighbours with two games', () => {
    expect(pickMinigames(['a', 'b'], 5, lcg(3))).toHaveLength(5);
    const r = pickMinigames(['a', 'b'], 5, lcg(3));
    for (let i = 1; i < r.length; i++) expect(r[i]).not.toBe(r[i - 1]);
  });
});

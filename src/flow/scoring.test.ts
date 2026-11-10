import { describe, expect, it } from 'vitest';
import { finalRanking, roundPoints } from './scoring';

describe('roundPoints', () => {
  it('awards 5/3/1/0 for four distinct places', () => {
    expect(roundPoints([['a'], ['b'], ['c'], ['d']], 4, 1)).toEqual({ a: 5, b: 3, c: 1, d: 0 });
  });
  it('gives tied players the points of their best place', () => {
    expect(roundPoints([['a', 'b'], ['c'], ['d']], 4, 1)).toEqual({ a: 5, b: 5, c: 1, d: 0 });
  });
  it('uses only 5/3 with two players', () => {
    expect(roundPoints([['a'], ['b']], 2, 1)).toEqual({ a: 5, b: 3 });
  });
  it('applies the multiplier', () => {
    expect(roundPoints([['a'], ['b'], ['c'], ['d']], 4, 2)).toEqual({ a: 10, b: 6, c: 2, d: 0 });
  });
});

describe('finalRanking', () => {
  it('orders by total, then round wins', () => {
    expect(finalRanking({ a: 10, b: 10, c: 3 }, { a: 2, b: 1, c: 0 })).toEqual([['a'], ['b'], ['c']]);
  });
  it('keeps ties when totals and wins are equal', () => {
    expect(finalRanking({ a: 10, b: 10, c: 3 }, { a: 1, b: 1, c: 0 })).toEqual([['a', 'b'], ['c']]);
  });
});

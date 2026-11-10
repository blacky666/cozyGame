import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { Evening } from './evening';
import { roundPoints } from './scoring';

const P = ['p0', 'p1', 'p2', 'p3'];
const games = ['g1', 'g2', 'g3'];
const rand = () => 0.5;

describe('Evening', () => {
  it('runs a full evening to the podium with doubled last round', () => {
    const rounds = CONFIG.rounds.min;
    const ev = new Evening(P, rounds, games, rand);
    const expected: Record<string, number> = { p0: 0, p1: 0, p2: 0, p3: 0 };
    const order = [
      [['p0'], ['p1'], ['p2'], ['p3']],
      [['p1'], ['p0', 'p2'], ['p3']],
      [['p3'], ['p2'], ['p1'], ['p0']],
      [['p0'], ['p1'], ['p2'], ['p3']],
      [['p2'], ['p3'], ['p0'], ['p1']],
    ];
    for (let r = 1; r <= rounds; r++) {
      const last = r === rounds;
      expect(ev.phase).toMatchObject({ kind: 'intro', round: r, double: last });
      const game = (ev.phase as { game: string }).game;
      expect(games).toContain(game);
      expect(ev.advance({ type: 'introDone' })).toEqual({ kind: 'playing', round: r, game });
      const placements = order[r - 1];
      const pts = roundPoints(placements, 4, last ? CONFIG.lastRoundMultiplier : 1);
      for (const k of P) expected[k] += pts[k];
      const next = ev.advance({ type: 'gameResult', placements });
      if (last) {
        expect(next.kind).toBe('podium');
      } else {
        expect(next).toMatchObject({ kind: 'standings', round: r, points: pts, totals: expected });
        ev.advance({ type: 'standingsDone' });
      }
    }
    const end = ev.phase;
    if (end.kind !== 'podium') throw new Error('expected podium');
    expect(end.totals).toEqual(expected);
    expect(end.ranking.flat().sort()).toEqual(P);
  });

  it('throws on an event that does not fit the phase', () => {
    const ev = new Evening(P, 5, games, rand);
    expect(() => ev.advance({ type: 'standingsDone' })).toThrow();
  });

  it('validates rounds and player count', () => {
    expect(() => new Evening(P, CONFIG.rounds.min - 1, games, rand)).toThrow();
    expect(() => new Evening(P, CONFIG.rounds.max + 1, games, rand)).toThrow();
    expect(() => new Evening(['p0'], 5, games, rand)).toThrow();
  });
});

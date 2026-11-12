import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { Evening } from './evening';
import { mulberry32 } from './rng';
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

  it('drops unknown and duplicate keys and appends missing players last', () => {
    const run = (placements: string[][]) => {
      const ev = new Evening(['p0', 'p1', 'p2'], 5, games, rand);
      ev.advance({ type: 'introDone' });
      const ph = ev.advance({ type: 'gameResult', placements });
      if (ph.kind !== 'standings') throw new Error('expected standings');
      return ph.points;
    };
    expect(run([['p1', 'p9'], ['p1'], ['p0']])).toEqual(run([['p1'], ['p0'], ['p2']]));
  });

  it('does not throw on empty or all-unknown placements', () => {
    const ev = new Evening(['p0', 'p1'], 5, games, rand);
    ev.advance({ type: 'introDone' });
    expect(() => ev.advance({ type: 'gameResult', placements: [['x'], []] })).not.toThrow();
  });

  it('keeps the same random tie order for the whole evening', () => {
    const ev = new Evening(P, 5, games, mulberry32(7));
    const orders: string[][] = [];
    for (let r = 1; r <= 2; r++) {
      ev.advance({ type: 'introDone' });
      const ph = ev.advance({ type: 'gameResult', placements: [P] });
      if (ph.kind !== 'standings') throw new Error('expected standings');
      orders.push(ph.tieOrder);
      ev.advance({ type: 'standingsDone' });
    }
    expect(orders[0]).toEqual(orders[1]);
    expect([...orders[0]].sort()).toEqual(P);
  });
});

describe('Evening XP', () => {
  const play = (ev: Evening, placements: string[][], feats?: Record<string, string[]>) => {
    ev.advance({ type: 'introDone' });
    return ev.advance({ type: 'gameResult', placements, feats });
  };
  it('standings carry the evening id and the XP lines so far', () => {
    const ev = new Evening(P, CONFIG.rounds.min, games, rand, 'abend-1');
    expect(ev.id).toBe('abend-1');
    const st = play(ev, [['p0'], ['p1'], ['p2'], ['p3']], { p1: ['schubser'], p7: ['schubser'] });
    if (st.kind !== 'standings') throw new Error('expected standings');
    expect(st.eveningId).toBe(ev.id);
    expect(st.xp.p0[0]).toEqual({ kind: 'teilnahme', xp: 50 });
    expect(st.xp.p0).toContainEqual({ kind: 'platz', round: 1, place: 1, xp: 25 });
    expect(st.xp.p1).toContainEqual({ kind: 'erfolg', round: 1, feat: 'schubser', xp: 5 });
    expect(Object.values(st.xp).flat().some((l) => l.kind === 'gesamt')).toBe(false);
  });
  it('the podium carries the gesamt lines', () => {
    const ev = new Evening(P, CONFIG.rounds.min, games, rand, 'abend-2');
    let ph = play(ev, [['p0'], ['p1'], ['p2'], ['p3']]);
    while (ph.kind === 'standings') {
      ev.advance({ type: 'standingsDone' });
      ph = play(ev, [['p0'], ['p1'], ['p2'], ['p3']]);
    }
    if (ph.kind !== 'podium') throw new Error('expected podium');
    expect(ph.eveningId).toBe('abend-2');
    expect(ph.xp.p0).toContainEqual({ kind: 'gesamt', place: 1, xp: 40 });
    expect(ph.xp.p1).toContainEqual({ kind: 'gesamt', place: 2, xp: 20 });
    expect(ph.xp.p0.filter((l) => l.kind === 'platz')).toHaveLength(CONFIG.rounds.min);
  });
  it('gets a random id by default', () => {
    const a = new Evening(P, CONFIG.rounds.min, games, rand);
    const b = new Evening(P, CONFIG.rounds.min, games, rand);
    expect(a.id).toMatch(/^[0-9a-f-]{16,}$/);
    expect(a.id).not.toBe(b.id);
  });
});

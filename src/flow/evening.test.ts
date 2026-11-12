import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { CARD_IDS } from './cards';
import { Evening, type EveningPhase } from './evening';
import { mulberry32 } from './rng';
import { roundPoints } from './scoring';

const P = ['p0', 'p1', 'p2', 'p3'];
const games = ['g1', 'g2', 'g3'];
const rand = () => 0.5;

/** After standings: walks through the card phases (first offered card) to the next intro. */
const toIntro = (ev: Evening): EveningPhase => {
  let ph = ev.advance({ type: 'standingsDone' });
  if (ph.kind === 'cards') {
    ev.advance({ type: 'cardPicked', card: ph.offer[0], random: false });
    ph = ev.advance({ type: 'revealDone' });
  }
  return ph;
};

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
      const card = (ev.phase as { card: unknown }).card;
      expect(ev.advance({ type: 'introDone' })).toEqual({ kind: 'playing', round: r, game, card });
      const placements = order[r - 1];
      const pts = roundPoints(placements, 4, last ? CONFIG.lastRoundMultiplier : 1);
      for (const k of P) expected[k] += pts[k];
      const next = ev.advance({ type: 'gameResult', placements });
      if (last) {
        expect(next.kind).toBe('podium');
      } else {
        expect(next).toMatchObject({ kind: 'standings', round: r, points: pts, totals: expected });
        const ph = ev.advance({ type: 'standingsDone' });
        if (ph.kind === 'cards') {
          const rv = ev.advance({ type: 'cardPicked', card: ph.offer[0], random: false });
          if (rv.kind === 'reveal' && rv.card === 'punkte_klau') {
            expected[rv.victim] -= 1;
            expected[rv.chooser] += 1;
          }
          ev.advance({ type: 'revealDone' });
        }
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
      toIntro(ev);
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
      toIntro(ev);
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

describe('Evening cards', () => {
  const P3 = ['p0', 'p1', 'p2'];
  const games5 = ['schneeball', 'kartoffel', 'farbkrieg', 'wackelturm', 'muenzjagd'];
  const play = (ev: Evening, placements: string[][]) => {
    ev.advance({ type: 'introDone' });
    return ev.advance({ type: 'gameResult', placements });
  };

  it('the last place picks a card for the first place; Punkte-Klau moves a point at the reveal', () => {
    const ev = new Evening(P3, 5, games5, () => 0);
    expect(ev.phase).toMatchObject({ kind: 'intro', round: 1, card: null });
    expect(ev.advance({ type: 'introDone' })).toMatchObject({ kind: 'playing', round: 1, card: null });
    ev.advance({ type: 'gameResult', placements: [['p0'], ['p1'], ['p2']] });
    const cards = ev.advance({ type: 'standingsDone' });
    if (cards.kind !== 'cards') throw new Error('expected cards');
    expect(cards).toMatchObject({ round: 1, chooser: 'p2', victim: 'p0' });
    expect(cards.offer).toHaveLength(3);
    expect(cards.offer).toContain('punkte_klau');
    const reveal = ev.advance({ type: 'cardPicked', card: 'punkte_klau', random: false });
    expect(reveal).toMatchObject({
      kind: 'reveal', round: 1, card: 'punkte_klau', chooser: 'p2', victim: 'p0', random: false, game: cards.game,
    });
    if (reveal.kind !== 'reveal') throw new Error('expected reveal');
    expect(reveal.totals).toEqual({ p0: 4, p1: 3, p2: 2 });
    const card = { id: 'punkte_klau', chooser: 'p2', victim: 'p0' };
    expect(ev.advance({ type: 'revealDone' })).toMatchObject({ kind: 'intro', round: 2, game: cards.game, card });
    expect(ev.advance({ type: 'introDone' })).toEqual({ kind: 'playing', round: 2, game: cards.game, card });
    const st2 = ev.advance({ type: 'gameResult', placements: [['p0'], ['p1'], ['p2']] });
    expect(st2).toMatchObject({ kind: 'standings', totals: { p0: 9, p1: 6, p2: 3 } });
    const c2 = ev.advance({ type: 'standingsDone' });
    if (c2.kind !== 'cards') throw new Error('expected cards');
    const hut = c2.offer.find((x) => x !== 'punkte_klau')!;
    ev.advance({ type: 'cardPicked', card: hut, random: true });
    expect(ev.advance({ type: 'revealDone' })).toMatchObject({ kind: 'intro', round: 3, card: { id: hut, chooser: 'p2', victim: 'p0' } });
    let ph: EveningPhase = ev.phase;
    for (let r = 3; r <= 5; r++) {
      ph = play(ev, [['p1'], ['p0'], ['p2']]);
      if (ph.kind === 'standings') {
        const c = ev.advance({ type: 'standingsDone' });
        if (c.kind !== 'cards') throw new Error('expected cards');
        ev.advance({ type: 'cardPicked', card: c.offer.find((x) => x !== 'punkte_klau')!, random: false });
        expect(ev.advance({ type: 'revealDone' })).toMatchObject({ kind: 'intro', card: { chooser: 'p2' } });
      }
    }
    if (ph.kind !== 'podium') throw new Error('expected podium');
    // Rounds 1-2: 5/3/1 each; rounds 3-5: p1 5+5+10, p0 3+3+6, p2 1+1+2; Punkte-Klau p0 -> p2 once.
    expect(ph.totals).toEqual({ p0: 10 + 12 - 1, p1: 6 + 20, p2: 2 + 4 + 1 });
    expect(ph.ranking).toEqual([['p1'], ['p0'], ['p2']]);
  });

  it('ties on last place are random', () => {
    let r = 0;
    const ev = new Evening(P, 5, games, () => r);
    play(ev, [['p0'], ['p1'], ['p2', 'p3']]);
    r = 0.99;
    expect(ev.advance({ type: 'standingsDone' })).toMatchObject({ kind: 'cards', chooser: 'p3', victim: 'p0' });
  });

  it('no card when all candidates are equal or fewer than 2 are present', () => {
    const a = new Evening(['p0', 'p1'], 5, games, () => 0);
    play(a, [['p0', 'p1']]);
    expect(a.advance({ type: 'standingsDone' })).toMatchObject({ kind: 'intro', round: 2, card: null });
    const b = new Evening(['p0', 'p1'], 5, games, () => 0);
    play(b, [['p0'], ['p1']]);
    expect(b.advance({ type: 'standingsDone', present: ['p0'] })).toMatchObject({ kind: 'intro', round: 2, card: null });
    const c = new Evening(P3, 5, games, () => 0);
    play(c, [['p0'], ['p1'], ['p2']]);
    expect(c.advance({ type: 'standingsDone', present: ['p0', 'p1'] })).toMatchObject({ kind: 'cards', chooser: 'p1', victim: 'p0' });
  });

  it('rejects a card that was not offered or a pick outside the card phase', () => {
    const ev = new Evening(P3, 5, games5, () => 0);
    expect(() => ev.advance({ type: 'cardPicked', card: 'falle', random: false })).toThrow();
    play(ev, [['p0'], ['p1'], ['p2']]);
    const c = ev.advance({ type: 'standingsDone' });
    if (c.kind !== 'cards') throw new Error('expected cards');
    const notOffered = CARD_IDS.find((id) => !c.offer.includes(id))!;
    expect(() => ev.advance({ type: 'cardPicked', card: notOffered, random: false })).toThrow();
    expect(() => ev.advance({ type: 'revealDone' })).toThrow();
  });

  it('the dev flag forces a card into the offer', () => {
    const ev = new Evening(P3, 5, ['schneeball'], () => 0, 'x', { forceCard: 'falle' });
    play(ev, [['p0'], ['p1'], ['p2']]);
    expect(ev.advance({ type: 'standingsDone' })).toMatchObject({ kind: 'cards', offer: ['falle', 'peinlicher_hut', 'punkte_klau'] });
  });

  it('the last round ends in the podium (no cards)', () => {
    const ev = new Evening(P3, 5, games5, mulberry32(3));
    let ph = play(ev, [['p0'], ['p1'], ['p2']]);
    while (ph.kind === 'standings') {
      toIntro(ev);
      ph = play(ev, [['p0'], ['p1'], ['p2']]);
    }
    expect(ph.kind).toBe('podium');
  });
});

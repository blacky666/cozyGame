import { describe, expect, it, vi } from 'vitest';
import { neutralInput, type InputState } from '../../net/protocol';
import { FEAT_IDS, featLabel } from '../../progress/feats';
import type { MiniGameHost, PlayerKey, PrankBody } from '../types';
import { PrankHost, PRANK_IDS } from './pranks';

const DT = 1000 / 30;
const inp = (o: Partial<InputState> = {}): InputState => ({ ...neutralInput(), ...o });

type Bodies = Record<PlayerKey, Partial<PrankBody> & { x: number; y: number }>;

/** Fake top-down game: bodies are mutable, prankKnock is a spy. */
function topDown(bodies: Bodies) {
  const knock = vi.fn();
  const game: MiniGameHost<unknown> = {
    tick() {},
    snapshot: () => null,
    result: () => null,
    prankBodies: () =>
      Object.entries(bodies).map(([key, b]) => ({ key, affectable: true, out: false, ...b })),
    prankKnock: knock,
  };
  return { game, knock };
}

const bodies3 = (): Bodies => ({ p0: { x: 100, y: 100 }, p1: { x: 150, y: 100 }, p2: { x: 300, y: 200 } });
const players = (prank: string, others = 'konfetti_kanone') => [
  { key: 'p0', prank },
  { key: 'p1', prank: others },
  { key: 'p2', prank: others },
];

/** Raw inputs with p0's prank counter and aim. */
const raw = (pranks: number, aimX = 0, aimY = 0, extra: Record<PlayerKey, Partial<InputState>> = {}) => ({
  p0: inp({ pranks, aimX, aimY, ...extra.p0 }),
  p1: inp(extra.p1),
  p2: inp(extra.p2),
});

/** A host after its baseline tick (pranks counter 0). */
function started(prank: string, uses = 1) {
  const h = new PrankHost(players(prank), () => uses, () => 0);
  return h;
}

describe('PrankHost top-down', () => {
  it('the first tick is a baseline', () => {
    const { game } = topDown(bodies3());
    const h = started('furzkissen');
    h.tick(DT, raw(3, 290, 190), game);
    expect(h.snap()).toMatchObject({ fx: [], cues: [], left: { p0: 1, p1: 1, p2: 1 } });
  });

  it('furzkissen hits the affectable opponent nearest the aim, once', () => {
    const { game } = topDown(bodies3());
    const h = started('furzkissen');
    h.tick(DT, raw(0, 290, 190), game);
    h.tick(DT, raw(1, 290, 190), game);
    const s = h.snap();
    expect(s.fx).toEqual([{ key: 'p2', kind: 'stumble', leftMs: 500, n: expect.any(Number) }]);
    expect(s.cues).toEqual([{ n: expect.any(Number), kind: 'furzkissen', from: 'p0', to: ['p2'], leftMs: 1200 }]);
    expect(s.left.p0).toBe(0);
    h.tick(DT, raw(2, 290, 190), game);
    expect(h.snap().cues).toHaveLength(1);
  });

  it('skips unaffectable players; nobody affectable or an out prankster fires nothing', () => {
    const b = bodies3();
    b.p2.affectable = false;
    const { game } = topDown(b);
    const h = started('furzkissen');
    h.tick(DT, raw(0, 290, 190), game);
    h.tick(DT, raw(1, 290, 190), game);
    expect(h.snap().fx.map((f) => f.key)).toEqual(['p1']);

    const b2 = bodies3();
    b2.p1.affectable = false;
    b2.p2.affectable = false;
    const h2 = started('furzkissen');
    h2.tick(DT, raw(0, 290, 190), topDown(b2).game);
    h2.tick(DT, raw(1, 290, 190), topDown(b2).game);
    expect(h2.snap()).toMatchObject({ fx: [], cues: [], left: { p0: 1 } });

    const b3 = bodies3();
    b3.p0.out = true;
    const h3 = started('furzkissen');
    h3.tick(DT, raw(0, 290, 190), topDown(b3).game);
    h3.tick(DT, raw(1, 290, 190), topDown(b3).game);
    expect(h3.snap()).toMatchObject({ fx: [], left: { p0: 1 } });
  });

  it('two uses: presses in two ticks fire, a third does not; two presses in one tick count once', () => {
    const { game } = topDown(bodies3());
    const h = started('furzkissen', 2);
    h.tick(DT, raw(0, 290, 190), game);
    h.tick(DT, raw(2, 290, 190), game);
    expect(h.snap().left.p0).toBe(1);
    h.tick(DT, raw(3, 290, 190), game);
    expect(h.snap().left.p0).toBe(0);
    h.tick(DT, raw(4, 290, 190), game);
    expect(h.snap().cues).toHaveLength(2);
  });

  it('pointed pranks give their effect; a repeat resets the time with a new n', () => {
    const cases = [
      ['verkehrte_welt', 'reverse', 3000],
      ['tintenklecks', 'ink', 3000],
      ['konfetti_kanone', 'confetti', 2000],
    ] as const;
    for (const [id, kind, ms] of cases) {
      const { game } = topDown(bodies3());
      const h = started(id);
      h.tick(DT, raw(0, 290, 190), game);
      h.tick(DT, raw(1, 290, 190), game);
      expect(h.snap().fx).toMatchObject([{ key: 'p2', kind, leftMs: ms }]);
    }
    const { game } = topDown(bodies3());
    const h = started('verkehrte_welt', 2);
    h.tick(DT, raw(0, 290, 190), game);
    h.tick(DT, raw(1, 290, 190), game);
    const first = h.snap().fx[0];
    for (let i = 0; i < 10; i++) h.tick(DT, raw(1, 290, 190), game);
    expect(h.snap().fx[0].leftMs).toBeLessThan(3000);
    h.tick(DT, raw(2, 290, 190), game);
    const fx = h.snap().fx;
    expect(fx).toHaveLength(1);
    expect(fx[0].leftMs).toBe(3000);
    expect(fx[0].n).not.toBe(first.n);
  });

  it('bananenschale: dropped at the feet, armed later, trips a non-owner once, expires', () => {
    const b = bodies3();
    const { game } = topDown(b);
    const h = started('bananenschale');
    h.tick(DT, raw(0), game);
    h.tick(DT, raw(1), game);
    expect(h.snap()).toMatchObject({ bananas: [{ owner: 'p0', x: 100, y: 100, armed: false }], left: { p0: 0 } });
    expect(h.feats()).toEqual({});
    b.p1 = { x: 103, y: 100 };
    let t = 0;
    while (t < 300) {
      h.tick(DT, raw(1, 0, 0, { p1: { right: true } }), game);
      t += DT;
    }
    expect(h.snap().fx).toEqual([]);
    while (t < 700) {
      h.tick(DT, raw(1, 0, 0, { p1: { right: true } }), game);
      t += DT;
      if (h.snap().fx.length > 0) break;
    }
    const s = h.snap();
    expect(s.fx).toMatchObject([{ key: 'p1', kind: 'slip', dir: 0, leftMs: 1000 }]);
    expect(s.cues.map((c) => c.kind)).toContain('rutsch');
    expect(s.cues.find((c) => c.kind === 'rutsch')).toMatchObject({ from: 'p0', to: ['p1'] });
    expect(s.bananas).toEqual([]);
    expect(h.feats()).toEqual({ p0: ['streich_gelandet'] });
  });

  it('a reversed victim slips in the direction he actually moves (Verkehrte Welt)', () => {
    const b = bodies3();
    b.p1 = { x: 103, y: 100 };
    const { game } = topDown(b);
    const h = new PrankHost(players('bananenschale', 'verkehrte_welt'), () => 1, () => 0);
    h.tick(DT, raw(0), game);
    // p0 drops the banana, p2 reverses p1 (aim on p1).
    h.tick(DT, raw(1, 0, 0, { p2: { pranks: 1, aimX: 103, aimY: 100 } }), game);
    expect(h.snap().fx).toMatchObject([{ key: 'p1', kind: 'reverse' }]);
    for (let t = 0; t < 700 && !h.snap().fx.some((f) => f.kind === 'slip'); t += DT) {
      h.tick(DT, raw(1, 0, 0, { p1: { right: true }, p2: { pranks: 1 } }), game);
    }
    // Holding D while reversed moves left (4), so he slips on to the left.
    expect(h.snap().fx.find((f) => f.kind === 'slip')).toMatchObject({ key: 'p1', dir: 4 });
  });

  it('the owner never slips on his banana; an untouched banana is gone after its life time', () => {
    const b = bodies3();
    const { game } = topDown(b);
    const h = started('bananenschale');
    h.tick(DT, raw(0), game);
    h.tick(DT, raw(1), game);
    for (let t = 0; t < 1000; t += DT) h.tick(DT, raw(1), game);
    expect(h.snap()).toMatchObject({ fx: [], bananas: [{ armed: true }] });
    for (let t = 1000; t < 20000; t += DT) h.tick(DT, raw(1), game);
    expect(h.snap().bananas).toEqual([]);
  });

  it('quietsche_hammer knocks everyone in range; nobody in range is not used up', () => {
    const b = bodies3();
    b.p1 = { x: 130, y: 100 };
    b.p2 = { x: 160, y: 100 };
    const { game, knock } = topDown(b);
    const h = started('quietsche_hammer');
    h.tick(DT, raw(0), game);
    h.tick(DT, raw(1), game);
    expect(knock.mock.calls).toEqual([['p0', 'p1']]);
    expect(h.snap().cues).toMatchObject([{ kind: 'quietsche_hammer', from: 'p0', to: ['p1'] }]);
    expect(h.feats()).toEqual({ p0: ['streich_gelandet'] });

    const far = topDown(bodies3());
    const h2 = started('quietsche_hammer');
    h2.tick(DT, raw(0), far.game);
    h2.tick(DT, raw(1), far.game);
    expect(far.knock).not.toHaveBeenCalled();
    expect(h2.snap().left.p0).toBe(1);
  });
});

describe('PrankHost tower', () => {
  function tower(ok = true) {
    const spy = vi.fn(() => ok);
    const game: MiniGameHost<unknown> = {
      tick() {},
      snapshot: () => null,
      result: () => null,
      prankPlot: (_f: PlayerKey, x: number) => (x > 200 ? 'p1' : null),
      prankTower: spy,
    };
    return { game, spy };
  }

  it('pointed pranks hit the owner of the plot under the pointer; own plot / gaps are not used up', () => {
    const { game } = tower();
    const h = started('tintenklecks');
    h.tick(DT, raw(0, 250), game);
    h.tick(DT, raw(1, 250), game);
    expect(h.snap().fx).toMatchObject([{ key: 'p1', kind: 'ink', leftMs: 3000 }]);

    const h2 = started('tintenklecks');
    h2.tick(DT, raw(0, 50), game);
    h2.tick(DT, raw(1, 50), game);
    expect(h2.snap()).toMatchObject({ fx: [], left: { p0: 1 } });
  });

  it('tower variants go through prankTower; a refusal is not used up and has no cue', () => {
    const { game, spy } = tower();
    const h = started('quietsche_hammer');
    h.tick(DT, raw(0, 250), game);
    h.tick(DT, raw(1, 250), game);
    expect(spy).toHaveBeenCalledWith('quietsche_hammer', 'p0', 'p1');
    expect(h.snap()).toMatchObject({ left: { p0: 0 }, cues: [{ kind: 'quietsche_hammer', to: ['p1'] }] });
    expect(h.feats()).toEqual({ p0: ['streich_gelandet'] });

    const no = tower(false);
    const h2 = started('furzkissen');
    h2.tick(DT, raw(0, 250), no.game);
    h2.tick(DT, raw(1, 250), no.game);
    expect(no.spy).toHaveBeenCalledWith('furzkissen', 'p0', 'p1');
    expect(h2.snap()).toMatchObject({ left: { p0: 1 }, cues: [], fx: [] });
  });
});

describe('PrankHost misc', () => {
  it('an unknown prank id or a game without hooks fires nothing', () => {
    const h = started('x');
    const { game } = topDown(bodies3());
    h.tick(DT, raw(0, 290, 190), game);
    h.tick(DT, raw(1, 290, 190), game);
    expect(h.snap()).toMatchObject({ fx: [], cues: [], left: { p0: 1 } });

    const plain: MiniGameHost<unknown> = { tick() {}, snapshot: () => null, result: () => null };
    const h2 = started('furzkissen');
    h2.tick(DT, raw(0, 290, 190), plain);
    h2.tick(DT, raw(1, 290, 190), plain);
    expect(h2.snap()).toMatchObject({ fx: [], cues: [], left: { p0: 1 } });
  });

  it('freeze: frozen fx and eis cue, thaw cue afterwards; mask blocks the input meanwhile', () => {
    const plain: MiniGameHost<unknown> = { tick() {}, snapshot: () => null, result: () => null };
    const h = started('furzkissen');
    h.freeze('p1', 3000);
    expect(h.snap().fx).toMatchObject([{ key: 'p1', kind: 'frozen', leftMs: 3000 }]);
    expect(h.snap().cues).toMatchObject([{ kind: 'eis', from: null, to: ['p1'] }]);
    const r = raw(0, 0, 0, { p1: { up: true } });
    expect(h.mask(r).p1.up).toBe(false);
    expect(h.mask(r).p0.up).toBe(false);
    let t = 0;
    while (t < 3000 - 1e-6) {
      h.tick(DT, r, plain);
      t += DT;
    }
    h.tick(DT, r, plain);
    const s = h.snap();
    expect(s.fx).toEqual([]);
    expect(s.cues.map((c) => c.kind)).toEqual(['eis_weg']);
    expect(h.mask(r).p1.up).toBe(true);
  });

  it('cues vanish after cueMs; streich_gelandet is listed once per round', () => {
    const { game } = topDown(bodies3());
    const h = started('furzkissen', 2);
    h.tick(DT, raw(0, 290, 190), game);
    h.tick(DT, raw(1, 290, 190), game);
    h.tick(DT, raw(2, 140, 100), game);
    expect(h.snap().cues).toHaveLength(2);
    for (let t = 0; t < 1250; t += DT) h.tick(DT, raw(2), game);
    expect(h.snap().cues).toEqual([]);
    expect(h.feats()).toEqual({ p0: ['streich_gelandet'] });
  });

  it('snap returns copies', () => {
    const h = started('furzkissen');
    h.freeze('p1', 3000);
    h.snap().fx[0].leftMs = 1;
    h.snap().left.p0 = 5;
    expect(h.snap()).toMatchObject({ fx: [{ leftMs: 3000 }], left: { p0: 1 } });
  });

  it('PRANK_IDS and the new feat', () => {
    expect(PRANK_IDS).toHaveLength(6);
    expect(FEAT_IDS).toHaveLength(12);
    expect(featLabel('streich_gelandet')).toBe('Streich gelandet');
  });
});

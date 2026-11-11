import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../config';
import { mulberry32 } from '../../flow/rng';
import type { AssetFile } from '../../gfx/assetTypes';
import { neutralInput, type InputState } from '../../net/protocol';
import { defaultProfile } from '../../save/profile';
import { buildArena } from '../common/arena';
import { playerKey, type GamePlayer, type PlayerKey } from '../types';
import { createSpudHost, SPUD_SPAWNS, speedOf, type SpudState } from './spudHost';
import { stepWalker } from './spudMove';

const file = JSON.parse(readFileSync('public/assets/arena-kartoffel.json', 'utf8')) as AssetFile;
const arena = buildArena(file, 'kartoffel.map', { wallChar: null });
const K = CONFIG.kartoffel;
const DT = 1 / 30;
const TICK_MS = DT * 1000;

const gp = (keys: string[]): GamePlayer[] =>
  keys.map((k) => {
    const slot = Number(k.slice(1)) as 0 | 1 | 2 | 3;
    return { key: playerKey(slot), slot, name: k, look: defaultProfile(k).look, remote: true };
  });

/**
 * Test driver: keeps per-player input incl. growing tap/shove counters. `absent` players never get
 * an input. rand () => 0 deals the potato to the first present player with a 12 s fuse.
 */
function driver(
  keys: string[],
  opts: { rand?: () => number; leaders?: PlayerKey[]; safetyMs?: number; absent?: string[] } = {},
) {
  const g = createSpudHost(gp(keys), opts.rand ?? mulberry32(7), arena, { leaders: opts.leaders, safetyMs: opts.safetyMs });
  const inputs: Record<PlayerKey, InputState> = {};
  for (const k of keys) if (!opts.absent?.includes(k)) inputs[k] = neutralInput();
  const tick = (n = 1) => { for (let i = 0; i < n; i++) g.tick(DT, inputs); };
  tick(); // baseline tick for the edge counters; deals the first potato
  const set = (k: string, p: Partial<InputState>) => {
    const { primaryTaps, secondaryTaps, shoves } = inputs[k];
    inputs[k] = { ...neutralInput(), primaryTaps, secondaryTaps, shoves, ...p };
  };
  /** Left click (sprint). */
  const tap = (k: string) => { inputs[k] = { ...inputs[k], primaryTaps: inputs[k].primaryTaps + 1 }; };
  const shove = (k: string) => { inputs[k] = { ...inputs[k], shoves: inputs[k].shoves + 1 }; };
  const drop = (k: string) => { delete inputs[k]; };
  const snap = (): SpudState => g.snapshot();
  const holder = (): PlayerKey | null => snap().potatoes[0]?.holder ?? null;
  const dist = (a: string, b: string) => {
    const s = snap();
    return Math.hypot(s.players[a].x - s.players[b].x, s.players[a].y - s.players[b].y);
  };
  /**
   * Walk k (axis by axis: first onto the other player's row, then along it) until it is within
   * `stopPx` of the other player. Returns the number of ticks walked. Calls `each` after every tick.
   */
  const approach = (k: string, other: string, stopPx: number, each?: () => void) => {
    let n = 0;
    for (; n < 1000; n++) {
      const s = snap();
      const me = s.players[k];
      const o = s.players[other];
      if (Math.hypot(me.x - o.x, me.y - o.y) <= stopPx) break;
      if (Math.abs(me.y - o.y) > 1.1) set(k, me.y < o.y ? { down: true } : { up: true });
      else set(k, me.x < o.x ? { right: true } : { left: true });
      tick();
      each?.();
    }
    set(k, {});
    return n;
  };
  /** Tick until a bang happened (bang counter grows); returns the ticks needed. */
  const untilBang = (each?: () => void) => {
    const b0 = snap().bang;
    let n = 0;
    while (snap().bang === b0 && n < 2000) { tick(); n++; each?.(); }
    return n;
  };
  return { g, inputs, tick, set, tap, shove, drop, snap, holder, dist, approach, untilBang };
}

describe('Heiße Kartoffel host', () => {
  it('one random living player starts with the real potato', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const d = driver(['p0', 'p1', 'p2'], { rand: mulberry32(seed) });
      const s = d.snap();
      expect(s.potatoes.length).toBe(1);
      expect(['p0', 'p1', 'p2']).toContain(s.potatoes[0].holder);
      expect(s.potatoes[0].heat).toBe(0);
      expect(s.phase).toBe('play');
      // Host-only fields stay out of the snapshot.
      expect(Object.keys(s.potatoes[0]).sort()).toEqual(['heat', 'holder', 'id', 'noBackFrom', 'noBackMs']);
    }
  });

  it('starts at the slot spawns', () => {
    const d = driver(['p0', 'p1', 'p2', 'p3']);
    const s = d.snap();
    for (const k of ['p0', 'p1', 'p2', 'p3']) {
      const [x, y] = SPUD_SPAWNS[Number(k.slice(1))];
      expect([s.players[k].x, s.players[k].y]).toEqual([x, y]);
    }
  });

  it('touch passes the potato, but not straight back within 1 s', () => {
    const d = driver(['p0', 'p1'], { rand: () => 0 });
    expect(d.holder()).toBe('p0');
    // p1 walks in: the pass happens in the first tick the feet are within touchPx, never before.
    let passedAt = -1;
    d.approach('p1', 'p0', 10, () => {
      if (passedAt < 0 && d.holder() === 'p1') passedAt = d.dist('p0', 'p1');
      if (d.holder() === 'p0') expect(d.dist('p0', 'p1')).toBeGreaterThan(K.touchPx);
    });
    expect(d.holder()).toBe('p1');
    expect(passedAt).toBeLessThanOrEqual(K.touchPx);
    expect(passedAt).toBeGreaterThan(K.touchPx - 2.2);
    const p = d.snap().potatoes[0];
    expect(p.noBackFrom).toBe('p0');
    expect(d.snap().fx.some((f) => f.kind === 'uebergabe')).toBe(true);
    // Both stand touching: p0 does not get it back within noBackMs.
    expect(d.dist('p0', 'p1')).toBeLessThanOrEqual(K.touchPx);
    // fx ids by the tick they appeared in (t = 0 is the last approach tick).
    const blockFx = new Map<number, number>();
    for (const f of d.snap().fx) if (f.kind === 'kein_zurueck') blockFx.set(f.id, 0);
    let t = 0;
    let backAt = -1;
    for (let i = 0; i < 60 && backAt < 0; i++) {
      d.tick();
      t += TICK_MS;
      for (const f of d.snap().fx) if (f.kind === 'kein_zurueck' && !blockFx.has(f.id)) blockFx.set(f.id, t);
      if (d.holder() === 'p0') backAt = t;
    }
    expect(backAt).toBeGreaterThanOrEqual(K.noBackMs - TICK_MS - 1e-6);
    expect(backAt).toBeLessThanOrEqual(K.noBackMs + TICK_MS + 1e-6);
    const times = [...blockFx.values()];
    expect(times.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(K.noBackFxMs - 1e-6);
  });

  it('no ping-pong: ≤ 1 pass per noBackMs between the same pair over 5 s', () => {
    const d = driver(['p0', 'p1'], { rand: () => 0 });
    d.approach('p1', 'p0', 8);
    let last = d.holder();
    const passes: number[] = [];
    for (let i = 0; i < 150; i++) {
      d.tick();
      expect(d.dist('p0', 'p1')).toBeLessThanOrEqual(K.touchPx);
      const h = d.holder();
      if (h !== last) passes.push(i * TICK_MS);
      last = h;
    }
    expect(passes.length).toBeGreaterThanOrEqual(4);
    expect(passes.length).toBeLessThanOrEqual(Math.ceil(5000 / K.noBackMs) + 1);
    for (let i = 1; i < passes.length; i++) expect(passes[i] - passes[i - 1]).toBeGreaterThanOrEqual(K.noBackMs - 1e-6);
  });

  it('a shove does not pass the potato', () => {
    const d = driver(['p0', 'p1'], { rand: () => 0 });
    // Walk p1 to a spot within shove reach but outside touch distance.
    d.approach('p1', 'p0', CONFIG.shove.reachPx);
    expect(d.dist('p0', 'p1')).toBeGreaterThan(K.touchPx);
    expect(d.dist('p0', 'p1')).toBeLessThanOrEqual(CONFIG.shove.reachPx);
    expect(d.snap().players.p1.dir).toBe('left');
    d.shove('p1');
    d.tick();
    expect(d.snap().players.p0.stun).toBe(true);
    let changes = 0;
    let last = d.holder();
    for (let i = 0; i < 45; i++) {
      d.tick();
      expect(d.dist('p0', 'p1')).toBeGreaterThan(K.touchPx);
      if (d.holder() !== last) changes++;
      last = d.holder();
    }
    expect(changes).toBe(0);
    expect(d.holder()).toBe('p0');
  });

  it('sprint: left click, faster for 400 ms, 3 s cooldown', () => {
    const d = driver(['p0', 'p1'], { rand: () => 0 });
    d.set('p1', { left: true });
    d.tap('p1');
    d.tick();
    expect(d.snap().players.p1.sprintMs).toBeCloseTo(K.sprintMs, 5);
    expect(d.snap().players.p1.sprintCdMs).toBeCloseTo(K.sprintCooldownMs, 5);
    expect(d.snap().fx.some((f) => f.kind === 'sprint' && f.who === 'p1')).toBe(true);
    const x0 = d.snap().players.p1.x;
    d.tick(9);
    expect(x0 - d.snap().players.p1.x).toBeCloseTo(K.walkSpeed * K.sprintFactor * 0.3, 3);
    d.tick(3);
    expect(d.snap().players.p1.sprintMs).toBe(0);
    // A second tap inside the cooldown does nothing.
    const cd = d.snap().players.p1.sprintCdMs;
    d.tap('p1');
    d.tick();
    expect(d.snap().players.p1.sprintMs).toBe(0);
    expect(d.snap().players.p1.sprintCdMs).toBeLessThan(cd);
    const x1 = d.snap().players.p1.x;
    d.tick(3);
    expect(x1 - d.snap().players.p1.x).toBeCloseTo(K.walkSpeed * 0.1, 3);
    // The cooldown counts down to 0, then sprinting works again.
    d.tick(Math.ceil(K.sprintCooldownMs / TICK_MS));
    expect(d.snap().players.p1.sprintCdMs).toBe(0);
    d.tap('p1');
    d.tick();
    expect(d.snap().players.p1.sprintMs).toBeGreaterThan(0);
  });

  it('fuse is 12–20 s and heat rises 0→3', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const d = driver(['p0', 'p1', 'p2'], { rand: mulberry32(seed) });
      let heat = 0;
      let reached3 = false;
      const n = d.untilBang(() => {
        const p = d.snap().potatoes[0];
        if (!p) return;
        expect(p.heat).toBeGreaterThanOrEqual(heat);
        heat = p.heat;
        if (heat === 3) reached3 = true;
      });
      const ms = n * TICK_MS;
      expect(ms).toBeGreaterThanOrEqual(K.fuseMinMs - 1e-6);
      expect(ms).toBeLessThanOrEqual(K.fuseMaxMs + TICK_MS + 1e-6);
      expect(reached3).toBe(true);
    }
  });

  it('bang: the holder becomes a ghost, is ranked out, the game pauses then gives a new potato to a living player', () => {
    const d = driver(['p0', 'p1', 'p2'], { rand: mulberry32(3) });
    const h = d.holder()!;
    d.untilBang();
    const s = d.snap();
    expect(s.out).toEqual([h]);
    expect(s.players[h].ghost).toBe(true);
    expect(s.players[h].losses).toBe(1);
    expect(s.phase).toBe('pause');
    expect(s.potatoes.length).toBe(0);
    expect(s.bang).toBe(1);
    expect(s.fx.some((f) => f.kind === 'knall' && f.who === h)).toBe(true);
    d.tick(Math.ceil(K.boomPauseMs / TICK_MS) - 1);
    expect(d.snap().phase).toBe('pause');
    d.tick();
    const s2 = d.snap();
    expect(s2.phase).toBe('play');
    expect(s2.potatoes.length).toBe(1);
    expect(s2.players[s2.potatoes[0].holder].ghost).toBe(false);
  });

  it('a pass in the bang tick: the receiver is out', () => {
    // p1 walks along the row to just outside touch distance of the holder p0, then waits.
    const setup = () => {
      const d = driver(['p0', 'p1', 'p2'], { rand: () => 0 });
      d.approach('p1', 'p0', K.touchPx + 2.2);
      expect(d.dist('p0', 'p1')).toBeGreaterThan(K.touchPx);
      return d;
    };
    // Dry run: how many more ticks until the bang.
    const dry = setup();
    const n = dry.untilBang();
    expect(dry.snap().out).toEqual(['p0']);
    // Real run: p1 steps in exactly in the bang tick.
    const d = setup();
    d.tick(n - 1);
    expect(d.holder()).toBe('p0');
    d.set('p1', { left: true });
    d.tick();
    const s = d.snap();
    expect(s.bang).toBe(1);
    expect(s.out).toEqual(['p1']);
    expect(s.players.p1.ghost).toBe(true);
    expect(s.players.p0.ghost).toBe(false);
  });

  it('ghosts neither touch nor get touched nor shove', () => {
    const d = driver(['p0', 'p1', 'p2'], { rand: () => 0 });
    d.untilBang();
    expect(d.snap().players.p0.ghost).toBe(true);
    d.tick(Math.ceil(K.boomPauseMs / TICK_MS));
    expect(d.holder()).toBe('p1');
    // The ghost floats onto the holder: no pass.
    d.approach('p0', 'p1', 4, () => expect(d.holder()).toBe('p1'));
    d.tick(30);
    expect(d.holder()).toBe('p1');
    // The ghost's shove presses do nothing.
    d.shove('p0');
    d.tick();
    expect(d.snap().players.p1.stun).toBe(false);
    expect(d.snap().players.p0.swing).toBe(false);
    expect(d.snap().players.p0.shoveCdMs).toBe(0);
    // The holder walks through the ghost: still no pass.
    d.set('p1', { left: true });
    d.tick(10);
    expect(d.holder()).toBe('p1');
  });

  it('result: last one standing first, then reverse elimination order', () => {
    const d = driver(['p0', 'p1', 'p2'], { rand: () => 0 });
    expect(d.g.result()).toBeNull();
    d.untilBang();
    expect(d.g.result()).toBeNull();
    d.untilBang();
    const s = d.snap();
    expect(s.out).toEqual(['p0', 'p1']);
    expect(s.phase).toBe('done');
    expect(d.g.result()).toEqual([['p2'], ['p1'], ['p0']]);
  });

  it('two players: best of three', () => {
    const d = driver(['p0', 'p1'], { rand: () => 0 });
    d.untilBang();
    let s = d.snap();
    expect(s.players.p0.ghost).toBe(false);
    expect(s.players.p1.ghost).toBe(false);
    expect(s.players.p0.losses).toBe(1);
    expect(s.out).toEqual([]);
    expect(s.phase).toBe('pause');
    expect(d.g.result()).toBeNull();
    d.untilBang();
    s = d.snap();
    expect(s.players.p0.losses).toBe(2);
    expect(s.bang).toBe(2);
    expect(s.phase).toBe('done');
    expect(d.g.result()).toEqual([['p1'], ['p0']]);
  });

  it('safety limit', () => {
    const d = driver(['p0', 'p1', 'p2'], { rand: () => 0, safetyMs: 1000 });
    d.tick(Math.ceil(1000 / TICK_MS) - 2);
    expect(d.g.result()).toBeNull();
    d.tick(2);
    expect(d.snap().phase).toBe('done');
    expect(d.g.result()).toEqual([['p0', 'p1', 'p2']]);
    // Nothing moves on once done.
    const t = d.snap().elapsedMs;
    d.tick(10);
    expect(d.snap().elapsedMs).toBe(t);
  });

  it('result is non-null after safetyMs in every phase (play, pause)', () => {
    // play
    const a = driver(['p0', 'p1'], { rand: () => 0, safetyMs: 5000 });
    a.tick(Math.ceil(5000 / TICK_MS));
    expect(a.snap().phase).toBe('done');
    expect(a.g.result()).toEqual([['p0', 'p1']]);
    // pause: the first bang comes at about 12 s, the limit falls inside the pause after it.
    const safetyMs = K.fuseMinMs + K.boomPauseMs / 2;
    const b = driver(['p0', 'p1', 'p2'], { rand: () => 0, safetyMs });
    b.untilBang();
    expect(b.snap().phase).toBe('pause');
    b.tick(Math.ceil(K.boomPauseMs / TICK_MS));
    expect(b.snap().phase).toBe('done');
    expect(b.g.result()).toEqual([['p1', 'p2'], ['p0']]);
  });

  it('leader is 5 % slower without the potato', () => {
    const d = driver(['p0', 'p1'], { rand: () => 0, leaders: ['p1'] });
    expect(d.holder()).toBe('p0');
    expect(d.snap().players.p1.leader).toBe(true);
    let x0 = d.snap().players.p1.x;
    d.set('p1', { left: true });
    d.tick(30);
    expect(x0 - d.snap().players.p1.x).toBeCloseTo(K.walkSpeed * K.leaderFactor, 3);
    // Holding the potato: full speed.
    const e = driver(['p0', 'p1'], { rand: () => 0.99, leaders: ['p1'] });
    expect(e.holder()).toBe('p1');
    expect(e.snap().players.p1.leader).toBe(false);
    x0 = e.snap().players.p1.x;
    e.set('p1', { left: true });
    e.tick(30);
    expect(x0 - e.snap().players.p1.x).toBeCloseTo(K.walkSpeed, 3);
  });

  it('speedOf multiplies sprint, slow and leader', () => {
    const base = { x: 0, y: 0, vx: 0, vy: 0, dir: 'down' as const, ghost: false, sprintMs: 0, sprintCdMs: 0, slowMs: 0, leader: false, stun: false, swing: false, shoveCdMs: 0, losses: 0 };
    expect(speedOf(base)).toBe(K.walkSpeed);
    expect(speedOf({ ...base, sprintMs: 1, slowMs: 1, leader: true })).toBeCloseTo(K.walkSpeed * K.sprintFactor * K.slowFactor * K.leaderFactor, 9);
  });

  it('stepWalker walks at the given speed and stops at solids', () => {
    const m = stepWalker({ x: 100, y: 104, vx: 0, vy: 0, dir: 'down' }, { ...neutralInput(), right: true }, 1, arena, 50);
    expect(m.x).toBeCloseTo(150, 5);
    expect(m.dir).toBe('side');
    const up = stepWalker({ x: 100, y: 30, vx: 0, vy: 0, dir: 'down' }, { ...neutralInput(), up: true }, 1, arena, 64);
    expect(up.y).toBeGreaterThanOrEqual(13 + K.bodyRadius - 1e-6);
    expect(up.vy).toBe(0);
  });

  it('absent players are neither touched nor given a new potato', () => {
    const d = driver(['p0', 'p1', 'p2'], { rand: () => 0.99, absent: ['p2'] });
    expect(d.holder()).toBe('p1');
    const never = () => expect(d.snap().potatoes.every((p) => p.holder !== 'p2')).toBe(true);
    d.approach('p1', 'p2', 8, never);
    d.untilBang(never);
    expect(d.snap().out).toEqual(['p1']);
    d.tick(Math.ceil(K.boomPauseMs / TICK_MS));
    expect(d.holder()).toBe('p0');
    d.untilBang(never);
    expect(d.snap().phase).toBe('done');
  });

  it('absent holder still bursts', () => {
    const d = driver(['p0', 'p1', 'p2'], { rand: () => 0 });
    expect(d.holder()).toBe('p0');
    d.drop('p0');
    d.approach('p1', 'p0', 8, () => expect(d.holder()).toBe('p0'));
    const n = d.untilBang(() => { if (d.snap().bang === 0) expect(d.holder()).toBe('p0'); });
    expect(n).toBeLessThan(2000);
    expect(d.snap().out).toEqual(['p0']);
    expect(d.snap().players.p0.ghost).toBe(true);
    d.tick(Math.ceil(K.boomPauseMs / TICK_MS));
    expect(d.snap().phase).toBe('play');
    expect(['p1', 'p2']).toContain(d.holder());
  });
});

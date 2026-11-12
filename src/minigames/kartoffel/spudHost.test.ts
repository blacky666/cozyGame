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

  it('CONFIG map size matches the garden map', () => {
    expect(arena.w).toBe(K.mapW);
    expect(arena.h).toBe(K.mapH);
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

  it('absent players are never dealt a potato while a present one exists, but catch it by touch', () => {
    // rand 0.99 picks the last candidate: p2 if absent players counted.
    const d = driver(['p0', 'p1', 'p2'], { rand: () => 0.99, absent: ['p2'] });
    expect(d.holder()).toBe('p1');
    d.untilBang();
    expect(d.snap().out).toEqual(['p1']);
    d.tick(Math.ceil(K.boomPauseMs / TICK_MS));
    // Dealt again: the present p0, not the absent (living) p2.
    expect(d.holder()).toBe('p0');
    // By touch the absent p2 catches it like anyone else, keeps it (it cannot pass) and bursts.
    d.approach('p0', 'p2', 8);
    expect(d.holder()).toBe('p2');
    d.untilBang(() => { if (d.snap().bang === 1) expect(d.holder()).toBe('p2'); });
    expect(d.snap().out).toEqual(['p1', 'p2']);
    expect(d.snap().phase).toBe('done');
    expect(d.g.result()).toEqual([['p0'], ['p2'], ['p1']]);
  });

  it('two players, one absent the whole round: the present one walking to it does not lose', () => {
    const d = driver(['p0', 'p1'], { rand: () => 0, absent: ['p1'] });
    let n = 0;
    while (d.snap().phase !== 'done' && n++ < 5000) {
      if (d.holder() === 'p0') d.approach('p0', 'p1', 8);
      d.tick();
    }
    expect(d.snap().phase).toBe('done');
    expect(d.g.result()?.[0]).not.toEqual(['p1']);
    expect(d.g.result()).toEqual([['p0'], ['p1']]);
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

  it('heat thresholds are jittered per potato, stay increasing and reach 3 before the bang', () => {
    const ratios: number[] = [];
    for (let seed = 1; seed <= 120; seed++) {
      const d = driver(['p0', 'p1', 'p2'], { rand: mulberry32(seed) });
      let t1 = -1;
      let t = 0;
      let heat = 0;
      let reached3 = false;
      const n = d.untilBang(() => {
        t++;
        const p = d.snap().potatoes[0];
        if (!p) return;
        expect(p.heat).toBeGreaterThanOrEqual(heat);
        heat = p.heat;
        if (heat >= 1 && t1 < 0) t1 = t;
        if (heat === 3) reached3 = true;
      });
      expect(reached3).toBe(true);
      ratios.push(t1 / n);
    }
    const first = K.heatSteps[0];
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(0.05);
    for (const r of ratios) {
      expect(r).toBeGreaterThan(first - K.heatJitter - 0.03);
      expect(r).toBeLessThan(first + K.heatJitter + 0.03);
    }
  });

  describe('garden extras', () => {
    const KINDS = ['fake', 'kurze_lunte', 'giesskanne'] as const;
    const FOUR = ['p0', 'p1', 'p2', 'p3'];
    const tileOf = (x: number, y: number) => arena.raster[Math.floor(y / arena.tile)][Math.floor(x / arena.tile)];
    /** Walk k to (x, y): first along y, then along x, until within 3 px (or the pickup is gone). */
    const walkTo = (d: ReturnType<typeof driver>, k: string, x: number, y: number, max = 600, stopWhenGone = true) => {
      for (let n = 0; n < max; n++) {
        const me = d.snap().players[k];
        if (Math.hypot(me.x - x, me.y - y) <= 3) break;
        if (Math.abs(me.y - y) > 1.1) d.set(k, me.y < y ? { down: true } : { up: true });
        else d.set(k, me.x < x ? { right: true } : { left: true });
        d.tick();
        if (stopWhenGone && d.snap().pickups.length === 0) break;
      }
      d.set(k, {});
    };
    /**
     * Seed search: a game where a pickup of `kind` appeared and the nearest non-holder walked onto it
     * before any bang. `run` gets the driver right after the pickup was taken and returns whether the
     * scenario was usable; at least one seed must be.
     */
    const collected = (kind: (typeof KINDS)[number], run: (d: ReturnType<typeof driver>, who: string, before: SpudState, realId: number, seed: number) => boolean, maxSeed = 80, wanted = 3): void => {
      let applicable = 0;
      for (let seed = 1; seed <= maxSeed && applicable < wanted; seed++) {
        const d = driver(FOUR, { rand: mulberry32(seed) });
        let n = 0;
        while (d.snap().pickups.length === 0 && d.snap().bang === 0 && n++ < 600) d.tick();
        const pk = d.snap().pickups.find((p) => p.kind === kind);
        if (!pk || d.snap().bang > 0) continue;
        const s0 = d.snap();
        const realId = s0.potatoes[0].id;
        const who = FOUR.filter((k) => k !== d.holder()).sort((a, b) =>
          Math.hypot(s0.players[a].x - pk.x, s0.players[a].y - pk.y) - Math.hypot(s0.players[b].x - pk.x, s0.players[b].y - pk.y))[0];
        walkTo(d, who, pk.x, pk.y);
        const s = d.snap();
        if (s.bang > 0 || s.pickups.some((p) => p.id === pk.id)) continue;
        if (run(d, who, s, realId, seed)) applicable++;
      }
      expect(applicable).toBeGreaterThan(0);
    };

    /** Walk the nearest non-holder onto pickup `id`; false if it was not taken by them before a bang. */
    const take = (d: ReturnType<typeof driver>, id: number): string | null => {
      const s0 = d.snap();
      const pk = s0.pickups.find((p) => p.id === id)!;
      const holders = new Set(s0.potatoes.map((p) => p.holder));
      const who = FOUR.filter((k) => !holders.has(k)).sort((a, b) =>
        Math.hypot(s0.players[a].x - pk.x, s0.players[a].y - pk.y) - Math.hypot(s0.players[b].x - pk.x, s0.players[b].y - pk.y))[0];
      if (!who) return null;
      for (let n = 0; n < 600 && d.snap().pickups.some((p) => p.id === id); n++) {
        const me = d.snap().players[who];
        if (Math.abs(me.y - pk.y) > 1.1) d.set(who, me.y < pk.y ? { down: true } : { up: true });
        else d.set(who, me.x < pk.x ? { right: true } : { left: true });
        d.tick();
        if (d.snap().bang > 0) break;
      }
      d.set(who, {});
      const s = d.snap();
      return s.bang === 0 && !s.pickups.some((p) => p.id === id) ? who : null;
    };
    /**
     * Seed search: a fake potato is taken, then (while the fake is still in play and before any bang)
     * a pickup of `second` is taken. `run` gets the driver right after that and returns whether the
     * scenario was usable; at least one seed must be.
     */
    const afterFake = (second: 'kurze_lunte' | 'giesskanne', run: (d: ReturnType<typeof driver>, atMs: number) => boolean, maxSeed = 600, wanted = 3): void => {
      let applicable = 0;
      for (let seed = 1; seed <= maxSeed && applicable < wanted; seed++) {
        const d = driver(FOUR, { rand: mulberry32(seed) });
        const wait = (kind: string) => {
          let n = 0;
          while (!d.snap().pickups.some((p) => p.kind === kind) && d.snap().bang === 0 && n++ < 900) d.tick();
          return d.snap().bang === 0 ? d.snap().pickups.find((p) => p.kind === kind) : undefined;
        };
        const fk = wait('fake');
        if (!fk || !take(d, fk.id) || d.snap().potatoes.length !== 2) continue;
        let n = 0;
        while (!d.snap().pickups.some((p) => p.kind === second) && d.snap().potatoes.length === 2 && d.snap().bang === 0 && n++ < 900) d.tick();
        const pk = d.snap().pickups.find((p) => p.kind === second);
        if (!pk || d.snap().potatoes.length !== 2 || d.snap().bang > 0) continue;
        if (!take(d, pk.id) || d.snap().potatoes.length !== 2) continue;
        if (run(d, d.snap().elapsedMs)) applicable++;
      }
      expect(applicable).toBeGreaterThan(0);
    };

    it('pickups spawn every 7 s on beet tiles, at most 2', () => {
      const d = driver(FOUR, { rand: mulberry32(5) });
      let max = 0;
      let firstAt = -1;
      for (let i = 0; i < Math.ceil(30000 / TICK_MS); i++) {
        d.tick();
        const ps = d.snap().pickups;
        max = Math.max(max, ps.length);
        if (ps.length > 0 && firstAt < 0) firstAt = d.snap().elapsedMs;
        expect(ps.length).toBeLessThanOrEqual(K.maxPickups);
        for (const p of ps) expect(tileOf(p.x, p.y)).toBe('b');
      }
      expect(firstAt).toBeGreaterThanOrEqual(K.pickupSpawnMs - TICK_MS);
      expect(firstAt).toBeLessThanOrEqual(K.pickupSpawnMs + 2 * TICK_MS);
      expect(max).toBe(K.maxPickups);
    });

    it('fake potato: a second potato of the same shape, bursts as confetti, nobody out', () => {
      collected('fake', (d, who, before, realId) => {
        const s = d.snap();
        expect(s.potatoes.length).toBe(2);
        expect(s.fx.some((f) => f.kind === 'pickup' && f.who === who)).toBe(true);
        const real = s.potatoes.find((p) => p.id === realId)!;
        const fake = s.potatoes.find((p) => p.id !== realId)!;
        expect(Object.keys(fake).sort()).toEqual(Object.keys(real).sort());
        expect(fake.holder).toBe(who);
        expect(before.out).toEqual([]);
        // Run until the fake is gone; while it exists no further fake spawns.
        let n = 0;
        while (d.snap().potatoes.length === 2 && d.snap().bang === 0 && n++ < 900) {
          d.tick();
          if (d.snap().potatoes.length === 2) expect(d.snap().pickups.every((p) => p.kind !== 'fake')).toBe(true);
        }
        const e = d.snap();
        if (e.bang > 0) return false;
        expect(e.potatoes.length).toBe(1);
        expect(e.potatoes[0].id).toBe(realId);
        expect(e.fx.some((f) => f.kind === 'konfetti')).toBe(true);
        expect(e.out).toEqual([]);
        expect(e.phase).toBe('play');
        return true;
      });
    });

    it('fake potato passes by touch like the real one', () => {
      collected('fake', (d, who, _b, realId) => {
        const fakeId = d.snap().potatoes.find((p) => p.id !== realId)!.id;
        const realHolder = d.snap().potatoes.find((p) => p.id === realId)!.holder;
        const other = FOUR.filter((k) => k !== who && k !== realHolder)[0];
        d.approach(other, who, 8);
        if (d.snap().bang > 0) return false;
        const f = d.snap().potatoes.find((p) => p.id === fakeId);
        if (!f) return false;
        expect(f.holder).toBe(other);
        expect(f.noBackFrom).toBe(who);
        return true;
      });
    });

    it('a player holding both passes both, each with its own no-back; ghosts never hold', () => {
      collected('fake', (d, who, _b, realId) => {
        const rh = d.snap().potatoes.find((p) => p.id === realId)!.holder;
        // The real holder walks to the fake holder and hands the real potato over: `who` holds both.
        d.approach(rh, who, 8);
        const s1 = d.snap();
        if (s1.bang > 0 || s1.potatoes.length !== 2 || s1.potatoes.some((p) => p.holder !== who)) return false;
        const third = FOUR.filter((k) => k !== who && k !== rh)[0];
        d.approach(third, who, 8);
        const s2 = d.snap();
        if (s2.bang > 0 || s2.potatoes.length !== 2) return false;
        expect(s2.potatoes.map((p) => p.holder)).toEqual([third, third]);
        for (const p of s2.potatoes) {
          expect(p.noBackFrom).toBe(who);
          expect(p.noBackMs).toBeGreaterThan(0);
        }
        d.untilBang();
        const e = d.snap();
        const ghosts = Object.keys(e.players).filter((k) => e.players[k].ghost);
        expect(ghosts.length).toBe(1);
        expect(e.potatoes.every((p) => !ghosts.includes(p.holder))).toBe(true);
        d.tick(Math.ceil(K.boomPauseMs / TICK_MS) + 5);
        expect(d.snap().potatoes.every((p) => !d.snap().players[p.holder].ghost)).toBe(true);
        return true;
      });
    });

    it('fake looks like the real one: same heat at pickup, id not ordered by creation', () => {
      let fakeLower = 0;
      let fakeHigher = 0;
      let glowing = 0;
      collected('fake', (d, _who, _b, realId) => {
        const s = d.snap();
        const real = s.potatoes.find((p) => p.id === realId)!;
        const fake = s.potatoes.find((p) => p.id !== realId)!;
        expect(fake.heat).toBe(real.heat);
        if (real.heat > 0) glowing++;
        if (fake.id < real.id) fakeLower++; else fakeHigher++;
        // The snapshot is ordered by id only.
        expect(s.potatoes.map((p) => p.id)).toEqual([...s.potatoes.map((p) => p.id)].sort((a, b) => a - b));
        return true;
      }, 300, 40);
      expect(fakeLower).toBeGreaterThan(0);
      expect(fakeHigher).toBeGreaterThan(0);
      expect(glowing).toBeGreaterThan(0);
    });

    it('short fuse never lengthens a fuse that is already shorter than 3 s', () => {
      collected('kurze_lunte', (d, _who, _b, _id, seed) => {
        const at = d.snap().elapsedMs;
        const dry = driver(FOUR, { rand: mulberry32(seed) });
        dry.untilBang();
        const dryBangAt = dry.snap().elapsedMs;
        if (dryBangAt - at >= K.shortFuseMs - 2 * TICK_MS) return false;
        d.untilBang();
        // The bang comes when it would have without the pickup (within a tick).
        expect(Math.abs(d.snap().elapsedMs - dryBangAt)).toBeLessThanOrEqual(TICK_MS + 1e-6);
        return true;
      }, 400);
    });

    it('short fuse: the real potato bursts within 3 s', () => {
      collected('kurze_lunte', (d) => {
        const s = d.snap();
        expect(s.fx.some((f) => f.kind === 'kurze_lunte')).toBe(true);
        expect(s.potatoes.length).toBe(1);
        const n = d.untilBang();
        expect(n * TICK_MS).toBeLessThanOrEqual(K.shortFuseMs + TICK_MS + 1e-6);
        expect(d.snap().bang).toBe(1);
        return true;
      });
    });

    it('watering can slows the current holder for 2 s', () => {
      collected('giesskanne', (d, who) => {
        const s = d.snap();
        const h = s.potatoes[0].holder;
        expect(s.fx.some((f) => f.kind === 'giesskanne')).toBe(true);
        expect(s.players[h].slowMs).toBeGreaterThan(0);
        expect(s.players[h].slowMs).toBeLessThanOrEqual(K.slowMs);
        for (const k of FOUR) if (k !== h) expect(s.players[k].slowMs).toBe(0);
        const x0 = s.players[h].x;
        d.set(h, { left: true });
        d.tick(3);
        expect(x0 - d.snap().players[h].x).toBeCloseTo(K.walkSpeed * K.slowFactor * 0.1, 1);
        d.tick(Math.ceil(K.slowMs / TICK_MS));
        expect(d.snap().players[h].slowMs).toBe(0);
        return who !== h;
      });
    });

    it('short fuse cuts the fake too: both potatoes glow alike and the fake never outlives the real', () => {
      afterFake('kurze_lunte', (d, atMs) => {
        // One kurze_lunte fx per live potato (the fake is not skipped).
        expect(d.snap().fx.filter((f) => f.kind === 'kurze_lunte').length).toBe(2);
        let last = d.snap();
        while (d.snap().bang === 0) { last = d.snap(); d.tick(); }
        // Only scenarios where the real potato had >= shortFuseMs left (so its cut fuse is exactly shortFuseMs).
        if (d.snap().elapsedMs - atMs < K.shortFuseMs - 2 * TICK_MS) return false;
        // Only scenarios where the fake is still in play on the tick before the bang (it had >= shortFuseMs left too).
        if (last.potatoes.length !== 2) return false;
        // Both were cut to the same remaining time: the fake glows at full heat alongside the real one.
        for (const p of last.potatoes) expect(p.heat).toBe(3);
        return true;
      });
    });

    it('watering can slows every potato holder, the fake one too', () => {
      afterFake('giesskanne', (d) => {
        const s = d.snap();
        const holders = [...new Set(s.potatoes.map((p) => p.holder))];
        if (holders.length !== 2) return false;
        expect(s.fx.filter((f) => f.kind === 'giesskanne').map((f) => f.who).sort()).toEqual([...holders].sort());
        for (const k of FOUR) {
          if (holders.includes(k)) expect(s.players[k].slowMs).toBeGreaterThan(0);
          else expect(s.players[k].slowMs).toBe(0);
        }
        return true;
      });
    });

    it('ghosts cannot pick up extras', () => {
      const d = driver(['p0', 'p1', 'p2'], { rand: () => 0 });
      d.untilBang(); // p0 is out at 12 s; the first pickup spawned at 7 s on the first beet tile
      expect(d.snap().players.p0.ghost).toBe(true);
      const pk = d.snap().pickups[0];
      expect(pk).toBeDefined();
      d.tick(Math.ceil(K.boomPauseMs / TICK_MS));
      walkTo(d, 'p0', pk.x, pk.y, 300, false);
      d.tick(10);
      const g = d.snap().players.p0;
      expect(Math.hypot(g.x - pk.x, g.y - pk.y)).toBeLessThanOrEqual(3);
      expect(d.snap().pickups.some((p) => p.id === pk.id)).toBe(true);
      expect(d.snap().potatoes.length).toBe(1);
    });
  });
});

describe('Heiße Kartoffel feats', () => {
  const feats = (d: ReturnType<typeof driver>) => d.g.feats?.() ?? {};
  /**
   * rand () => 0: p0 gets the real potato with a 12 s fuse. p1 waits 16 px away, then steps in once
   * about `leftMs` of the fuse are left (the potato was dealt in the baseline tick).
   */
  const passWithLeft = (leftMs: number) => {
    const d = driver(['p0', 'p1'], { rand: () => 0 });
    expect(d.holder()).toBe('p0');
    d.approach('p1', 'p0', K.touchPx + 3);
    expect(d.holder()).toBe('p0');
    while (d.snap().elapsedMs < K.fuseMinMs - leftMs) d.tick();
    d.approach('p1', 'p0', 8);
    expect(d.holder()).toBe('p1');
    expect(d.snap().bang).toBe(0);
    return d;
  };

  it('passing the real potato with about 1.3 s fuse left gives kartoffel_knapp', () => {
    const d = passWithLeft(1300);
    expect(feats(d).p0).toContain('kartoffel_knapp');
    expect(feats(d).p1).toBeUndefined();
  });
  it('passing it with 2 s left does not', () => {
    const d = passWithLeft(2000);
    expect(feats(d).p0 ?? []).not.toContain('kartoffel_knapp');
  });
  it('passing a fake in its last second never gives kartoffel_knapp', () => {
    // Deal with r ~ 1 (p2 gets a ~20 s real potato), then r = 0: the first pickup is a fake with 6 s left.
    let r = 0.999;
    const d = driver(['p0', 'p1', 'p2'], { rand: () => r });
    expect(d.holder()).toBe('p2');
    r = 0;
    while (d.snap().pickups.length === 0) d.tick();
    const pk = d.snap().pickups[0];
    expect(pk.kind).toBe('fake');
    for (let n = 0; n < 600 && d.snap().pickups.length > 0; n++) {
      const me = d.snap().players.p0;
      if (Math.abs(me.y - pk.y) > 1.1) d.set('p0', me.y < pk.y ? { down: true } : { up: true });
      else d.set('p0', me.x < pk.x ? { right: true } : { left: true });
      d.tick();
    }
    d.set('p0', {});
    const fake = d.snap().potatoes.find((p) => p.holder === 'p0');
    expect(fake).toBeDefined();
    const pickedAt = d.snap().elapsedMs;
    d.approach('p1', 'p0', K.touchPx + 3);
    expect(d.snap().potatoes.find((p) => p.id === fake!.id)?.holder).toBe('p0');
    while (d.snap().elapsedMs < pickedAt + K.fakeFuseMinMs - 1000) d.tick();
    d.approach('p1', 'p0', 8);
    expect(d.snap().potatoes.find((p) => p.id === fake!.id)?.holder).toBe('p1');
    expect(feats(d).p0 ?? []).not.toContain('kartoffel_knapp');
  });
  it('three passes give kartoffel_pass', () => {
    const d = driver(['p0', 'p1', 'p2'], { rand: () => 0 });
    expect(d.holder()).toBe('p0');
    d.approach('p1', 'p0', 8);
    expect(d.holder()).toBe('p1');
    // Standing together the potato goes back and forth once per noBackMs.
    let gives = 1;
    let last = d.holder();
    for (let n = 0; n < 300 && gives < 3; n++) {
      d.tick();
      const h = d.holder();
      if (last === 'p0' && h === 'p1') gives++;
      if (gives < 3) expect(feats(d).p0 ?? []).not.toContain('kartoffel_pass');
      last = h;
    }
    expect(d.snap().bang).toBe(0);
    expect(gives).toBe(3);
    expect(feats(d).p0).toContain('kartoffel_pass');
    expect(feats(d).p1 ?? []).not.toContain('kartoffel_pass');
  });
  it('three shoves landed give schubser', () => {
    const d = driver(['p0', 'p1'], { rand: () => 0 });
    for (let i = 0; i < 3; i++) {
      expect(feats(d).p1 ?? []).not.toContain('schubser');
      d.approach('p1', 'p0', 10);
      while (d.snap().players.p1.shoveCdMs > 0 || d.snap().players.p0.stun) d.tick();
      d.tick(Math.ceil(CONFIG.shove.immuneMs / TICK_MS));
      d.approach('p1', 'p0', 10);
      d.shove('p1');
      d.tick();
      expect(d.snap().players.p0.stun).toBe(true);
    }
    expect(feats(d).p1).toContain('schubser');
  });
});

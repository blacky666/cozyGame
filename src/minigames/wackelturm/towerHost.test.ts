import { readFileSync } from 'node:fs';
import Matter from 'matter-js';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../config';
import { mulberry32 } from '../../flow/rng';
import type { AssetFile } from '../../gfx/assetTypes';
import { INPUT_COUNTERS, neutralInput, type InputState } from '../../net/protocol';
import { defaultProfile } from '../../save/profile';
import { playerKey, type GamePlayer, type PlayerKey } from '../types';
import { readLayout } from './towerLayout';
import { craneBounds, createTowerHost, finaleAt, stepCrane, type TowerFx, type TowerState } from './towerHost';
import { KINDS, NORMAL_KINDS, shapeSize, spawnBlock, type Kind, type Rot } from './towerPhysics';

const file = JSON.parse(readFileSync('public/assets/arena-wackelturm.json', 'utf8')) as AssetFile;
const layout = readLayout(file);
const C = CONFIG.wackelturm;
const DT = 1 / 30;
const P0 = layout.plots[0];
/** Ticks covering ms. */
const ticksFor = (ms: number) => Math.ceil(ms / (DT * 1000) - 1e-9);

const gp = (keys: string[]): GamePlayer[] =>
  keys.map((k) => {
    const slot = Number(k.slice(1)) as 0 | 1 | 2 | 3;
    return { key: playerKey(slot), slot, name: k, look: defaultProfile(k).look, remote: true };
  });

/** A rand that always draws `kind` from the normal sequence. */
const always = (kind: Kind) => () => (NORMAL_KINDS.indexOf(kind) + 0.5) / NORMAL_KINDS.length;

type Counter = (typeof INPUT_COUNTERS)[number];

/** Test driver: per-player input incl. growing counters. `absent` players get no input until `join`. */
function driver(keys: string[], opts: { rand?: () => number; absent?: string[]; durationMs?: number } = {}) {
  const g = createTowerHost(gp(keys), opts.rand ?? mulberry32(7), layout, opts.durationMs);
  const inputs: Record<PlayerKey, InputState> = {};
  for (const k of keys) if (!opts.absent?.includes(k)) inputs[k] = neutralInput();
  const tick = (n = 1) => { for (let i = 0; i < n; i++) g.tick(DT, inputs); };
  tick(); // baseline tick for the edge counters
  /** Buttons as given; counters kept. */
  const set = (k: string, p: Partial<InputState>) => {
    const keep: Partial<InputState> = {};
    for (const c of INPUT_COUNTERS) keep[c] = inputs[k][c];
    inputs[k] = { ...neutralInput(), ...keep, ...p };
  };
  const press = (k: string, counter: Counter, n = 1) => { inputs[k] = { ...inputs[k], [counter]: inputs[k][counter] + n }; };
  const join = (k: string, p: Partial<InputState> = {}) => { inputs[k] = { ...neutralInput(), ...p }; };
  const snap = (): TowerState => g.snapshot();
  const world = (k: string) => g.__world(k);
  return { g, inputs, tick, set, press, join, snap, world };
}
type Driver = ReturnType<typeof driver>;

type Block = { id: number; kind: Kind; x: number; y: number; a: number };
const blocks = (s: TowerState, k: string): Block[] => {
  const f = s.players[k].blocks;
  const out: Block[] = [];
  for (let i = 0; i < f.length; i += 5) out.push({ id: f[i], kind: KINDS[f[i + 1]], x: f[i + 2] / 10, y: f[i + 3] / 10, a: f[i + 4] / 100 });
  return out;
};

/** Collects fx by id while ticking. */
function fxLog(d: Driver) {
  const seen = new Map<number, TowerFx>();
  const grab = () => { for (const f of d.snap().fx) seen.set(f.id, f); };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { d.tick(); grab(); } };
  return { tick, all: () => [...seen.values()], of: (kind: TowerFx['kind']) => [...seen.values()].filter((f) => f.kind === kind) };
}

/** Presses drop until the hanging block is gone; returns its kind. */
function dropReady(d: Driver, k: string): Kind {
  for (let i = 0; i < 300; i++) {
    const h = d.snap().players[k].hang;
    if (h) {
      d.press(k, 'drops');
      d.tick();
      if (d.snap().players[k].hang === null) return h.kind;
    } else d.tick();
  }
  throw new Error('drop never happened');
}

/** Spawns a straight stack of `n` blocks of `kind` at `rot` on plot `plot`'s foundation, centred. */
function stack(d: Driver, k: string, plot: number, kind: Kind, n: number, rot: Rot = 0) {
  const h = shapeSize(kind, rot).h;
  for (let i = 0; i < n; i++) spawnBlock(d.world(k), kind, layout.plots[plot].centre, layout.surfaceY - h / 2 - h * i, rot);
}

describe('Wackel-Turm host', () => {
  it('pure helpers: craneBounds, stepCrane, finaleAt', () => {
    expect(craneBounds(P0, 'lang', 0)).toEqual({ min: P0.minX + 32, max: P0.maxX - 32 });
    expect(craneBounds(P0, 'lang', 1)).toEqual({ min: P0.minX + 8, max: P0.maxX - 8 });
    expect(craneBounds(P0, 'l', 1)).toEqual({ min: P0.minX + 24, max: P0.maxX - 24 });
    const b = { min: 10, max: 100 };
    expect(stepCrane(50, { ...neutralInput(), right: true }, 0.5, b)).toBeCloseTo(50 + C.craneSpeed / 2, 9);
    expect(stepCrane(50, { ...neutralInput(), left: true }, 1, b)).toBe(10);
    expect(stepCrane(50, { ...neutralInput(), left: true, right: true }, 1, b)).toBe(50);
    expect(stepCrane(5, neutralInput(), 0.1, b)).toBe(10);
    expect(finaleAt(C.durationMs)).toBe(C.finaleMs);
    expect(finaleAt(18000)).toBeCloseTo((C.finaleMs * 18000) / C.durationMs, 9);
  });

  it('start: crane parked at the hook offset, a block hangs, goalPx from CONFIG', () => {
    const d = driver(['p0', 'p1'], { rand: always('kurz') });
    const s = d.snap();
    expect(s.goalPx).toBe(C.goalPx);
    expect(s.durationMs).toBe(C.durationMs);
    expect(s.winner).toBeNull();
    for (const [i, k] of ['p0', 'p1'].entries()) {
      const p = s.players[k];
      expect(p.plot).toBe(i);
      expect(p.craneX).toBe(layout.plots[i].left + layout.hookOffsetX);
      expect(p.hangTop).toBe(layout.hangTopStart);
      expect(p.hang).toEqual({ kind: 'kurz', rot: 0 });
      expect([p.heightPx, p.bestPx, p.placed, p.charges, p.blocks.length]).toEqual([0, 0, 0, 0, 0]);
      expect(p.armed).toBeNull();
    }
  });

  it('every player gets the same block sequence', () => {
    const d = driver(['p0', 'p1'], { rand: mulberry32(3) });
    const a: Kind[] = [];
    const b: Kind[] = [];
    d.tick(7);
    for (let i = 0; i < 5; i++) { a.push(dropReady(d, 'p0')); d.tick(11); }
    d.tick(13);
    for (let i = 0; i < 5; i++) { b.push(dropReady(d, 'p1')); d.tick(29); }
    expect(b).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(1);
  });

  it('A/D moves the crane at 64 px/s and clamps to the column (lang rot 0 stops at plot.minX + 32)', () => {
    const d = driver(['p0'], { rand: always('lang') });
    const x0 = d.snap().players.p0.craneX;
    d.set('p0', { left: true });
    d.tick(3);
    expect(d.snap().players.p0.craneX).toBeCloseTo(x0 - C.craneSpeed * 3 * DT, 6);
    d.tick(30);
    expect(d.snap().players.p0.craneX).toBe(P0.minX + 32);
    d.set('p0', { right: true });
    d.tick(60);
    expect(d.snap().players.p0.craneX).toBe(P0.maxX - 32);
  });

  it('Q/E and the wheel rotate in 90° steps; rotating near the edge re-clamps x', () => {
    const d = driver(['p0'], { rand: always('lang') });
    const rot = () => d.snap().players.p0.hang?.rot;
    d.press('p0', 'turnsCw');
    d.tick();
    expect(rot()).toBe(1);
    d.set('p0', { left: true });
    d.tick(60);
    expect(d.snap().players.p0.craneX).toBe(P0.minX + 8);
    d.set('p0', {});
    d.press('p0', 'turnsCcw');
    d.tick();
    expect(rot()).toBe(0);
    expect(d.snap().players.p0.craneX).toBe(P0.minX + 32);
    d.press('p0', 'turnsCcw', 2);
    d.tick();
    expect(rot()).toBe(2);
    d.press('p0', 'turnsCw', 5); // wheel bursts count like key presses
    d.tick();
    expect(rot()).toBe(3);
    // The body spawns at angle rot × π/2.
    d.press('p0', 'drops');
    d.tick();
    // The snapshot sends the angle in (−π, π]: rot 3 (3π/2) goes out as −π/2.
    expect(blocks(d.snap(), 'p0')[0].a).toBeCloseTo(-Math.PI / 2, 1);
  });

  it('S drops; left click drops; a second drop during the 600 ms cooldown does nothing; the next block hangs after it', () => {
    const d = driver(['p0'], { rand: always('kurz') });
    const log = fxLog(d);
    const p = () => d.snap().players.p0;
    d.press('p0', 'drops');
    log.tick();
    expect(p().hang).toBeNull();
    expect(p().cdMs).toBe(C.dropCooldownMs);
    const [b] = blocks(d.snap(), 'p0');
    expect(b.kind).toBe('kurz');
    expect(b.x).toBeCloseTo(p().craneX, 0);
    expect(log.of('drop')).toHaveLength(1);
    expect(log.of('drop')[0].who).toBe('p0');
    d.press('p0', 'drops');
    d.press('p0', 'primaryTaps');
    log.tick();
    expect(blocks(d.snap(), 'p0')).toHaveLength(1);
    const cdTicks = ticksFor(C.dropCooldownMs);
    log.tick(cdTicks - 2);
    expect(p().hang).toBeNull();
    log.tick();
    expect(p().hang).toEqual({ kind: 'kurz', rot: 0 });
    d.press('p0', 'primaryTaps');
    log.tick();
    expect(blocks(d.snap(), 'p0')).toHaveLength(2);
    expect(log.of('drop')).toHaveLength(2);
  });

  it('a block dropped while the previous one is still falling lands on it without overlap explosions', () => {
    const d = driver(['p0'], { rand: always('quader') });
    const log = fxLog(d);
    d.press('p0', 'drops');
    log.tick(1 + ticksFor(C.dropCooldownMs));
    expect(d.snap().players.p0.hang).not.toBeNull();
    d.press('p0', 'drops');
    let maxSpeed = 0;
    for (let i = 0; i < 90; i++) {
      log.tick();
      for (const body of d.world('p0').engine.world.bodies) maxSpeed = Math.max(maxSpeed, body.speed);
    }
    expect(maxSpeed).toBeLessThan(20);
    const [lo, hi] = blocks(d.snap(), 'p0');
    expect(hi.y).toBeLessThan(lo.y);
    expect(Math.abs(lo.y - hi.y - 16)).toBeLessThan(1);
    expect(log.of('land').length).toBeGreaterThanOrEqual(2);
    expect(log.of('land').every((f) => !f.stone)).toBe(true);
    expect(log.of('weg')).toHaveLength(0);
  });

  it('height counts only blocks at rest for 2 s; the hanging block never counts', () => {
    const d = driver(['p0'], { rand: always('kurz') });
    const p = () => d.snap().players.p0;
    d.tick(30);
    expect(p().hang).not.toBeNull();
    expect(p().heightPx).toBe(0);
    d.press('p0', 'drops');
    d.tick(ticksFor(C.restHoldMs));
    expect(p().heightPx).toBe(0);
    expect(p().placed).toBe(0);
    let at = -1;
    for (let i = 0; i < 60 && at < 0; i++) {
      d.tick();
      if (p().heightPx > 0) at = i;
    }
    expect(at).toBeGreaterThanOrEqual(0);
    expect(p().heightPx).toBe(16);
    expect(p().bestPx).toBe(16);
    expect(p().placed).toBe(1);
  });

  it('a block falling off the side is removed with fx weg and never counts', () => {
    const d = driver(['p0'], { rand: always('kurz') });
    const log = fxLog(d);
    spawnBlock(d.world('p0'), 'kurz', P0.left - 2, layout.surfaceY - 30, 0);
    log.tick(1);
    expect(blocks(d.snap(), 'p0')).toHaveLength(1);
    log.tick(150);
    expect(blocks(d.snap(), 'p0')).toHaveLength(0);
    expect(d.world('p0').engine.world.bodies.filter((b) => !b.isStatic)).toHaveLength(0);
    expect(log.of('weg')).toHaveLength(1);
    expect(log.of('weg')[0].who).toBe('p0');
    const p = d.snap().players.p0;
    expect([p.heightPx, p.bestPx, p.placed]).toEqual([0, 0, 0]);
  });

  it('charges: one per 3 placed blocks, capped at 2; drops that fall off do not count', () => {
    const d = driver(['p0'], { rand: always('kurz') });
    const p = () => d.snap().players.p0;
    const row = (dxs: number[], y = layout.surfaceY - 8) => {
      for (const dx of dxs) spawnBlock(d.world('p0'), 'kurz', P0.centre + dx, y, 0);
    };
    const settle = () => d.tick(ticksFor(C.restHoldMs + 1000));
    row([-40, -24, -8]);
    settle();
    expect([p().placed, p().charges]).toEqual([3, 1]);
    spawnBlock(d.world('p0'), 'kurz', P0.left - 2, layout.surfaceY - 30, 0); // falls off
    row([8, 24]);
    settle();
    expect([p().placed, p().charges]).toEqual([5, 1]);
    row([40]);
    settle();
    expect([p().placed, p().charges]).toEqual([6, 2]);
    row([-40, -24, -8], layout.surfaceY - 24);
    settle();
    expect([p().placed, p().charges]).toEqual([9, 2]);
  });

  it('the crane rises to the landed top − 64 and drops are refused while it is still rising', () => {
    const d = driver(['p0'], { rand: always('kurz') });
    const p = () => d.snap().players.p0;
    stack(d, 'p0', 0, 'quader', 6);
    const top = () => Math.min(...d.world('p0').engine.world.bodies.filter((b) => !b.isStatic).map((b) => b.bounds.min.y));
    d.tick(5);
    const h5 = p().hangTop;
    expect(h5).toBeLessThan(layout.hangTopStart);
    d.tick(5);
    expect(h5 - p().hangTop).toBeCloseTo(C.craneRiseSpeed * 5 * DT, 6);
    d.press('p0', 'drops');
    d.tick();
    expect(blocks(d.snap(), 'p0')).toHaveLength(6);
    expect(p().hang).not.toBeNull();
    d.tick(60);
    expect(top()).toBeLessThan(layout.surfaceY - 5 * 16);
    expect(Math.abs(p().hangTop - (top() - C.craneClearPx))).toBeLessThan(0.1);
    d.press('p0', 'drops');
    d.tick();
    expect(blocks(d.snap(), 'p0')).toHaveLength(7);
    // Without landed blocks the crane parks at hangTopStart.
    const e = driver(['p0'], { rand: always('kurz') });
    e.tick(30);
    expect(e.snap().players.p0.hangTop).toBe(layout.hangTopStart);
  });

  it('goal: a tower whose rested top reaches goalPx ends the round at once with the reacher first, others ranked by height, ties shared', () => {
    const d = driver(['p0', 'p1', 'p2', 'p3'], { rand: always('kurz') });
    const log = fxLog(d);
    stack(d, 'p0', 0, 'lang', 12);
    stack(d, 'p1', 1, 'kurz', 2);
    stack(d, 'p2', 2, 'kurz', 2);
    stack(d, 'p3', 3, 'kurz', 1);
    let ticks = 0;
    let reachedAt = -1;
    while (d.g.result() === null && ticks < 300) {
      log.tick();
      ticks++;
      if (reachedAt < 0 && d.snap().players.p0.heightPx >= C.goalPx) reachedAt = ticks;
    }
    const s = d.snap();
    // The round ends only after the top has held goalPx for goalHoldMs.
    expect(reachedAt).toBeGreaterThan(0);
    expect(ticks - reachedAt).toBeGreaterThanOrEqual(ticksFor(C.goalHoldMs) - 1);
    expect(s.winner).toBe('p0');
    expect(s.players.p0.heightPx).toBeGreaterThanOrEqual(C.goalPx);
    expect(s.players.p1.heightPx).toBe(s.players.p2.heightPx);
    expect(d.g.result()).toEqual([['p0'], ['p1', 'p2'], ['p3']]);
    expect(s.timeLeftMs).toBeGreaterThan(0);
    expect(log.of('ziel').map((f) => f.who)).toEqual(['p0']);
    // Nothing moves after the end.
    log.tick(5);
    expect(d.snap().timeLeftMs).toBe(s.timeLeftMs);
    expect(d.snap().players.p0.blocks).toEqual(s.players.p0.blocks);
  });

  it('two players reach the goal in the same tick: both share the first place, winner is the lower slot', () => {
    const d = driver(['p0', 'p1', 'p2'], { rand: always('kurz') });
    // Identical goal-high towers put to sleep at once: they never move, so both rest, are placed and hold
    // the goal in the same ticks, independent of how two worlds would settle.
    const n = C.goalPx / 16;
    for (const k of ['p1', 'p2']) {
      stack(d, k, Number(k.slice(1)), 'lang', n);
      for (const b of d.world(k).engine.world.bodies) if (!b.isStatic) Matter.Sleeping.set(b, true);
    }
    stack(d, 'p0', 0, 'kurz', 1);
    let ticks = 0;
    while (d.g.result() === null && ticks < 300) { d.tick(); ticks++; }
    // Placed in the tick that completes restHoldMs; that tick already counts toward goalHoldMs.
    expect(ticks).toBe(ticksFor(C.restHoldMs) + ticksFor(C.goalHoldMs) - 1);
    expect(d.snap().winner).toBe('p1');
    expect(d.snap().players.p2.heightPx).toBe(C.goalPx);
    expect(d.g.result()).toEqual([['p1', 'p2'], ['p0']]);
  });

  it('seesaw: a block rocking over the goal line after an impact does not win while it rocks', () => {
    const d = driver(['p0'], { rand: always('kurz') });
    const cx = P0.centre;
    // 9 flat lang plus a 10th 12 px off-centre (the seesaw): its rested top stays just under goalPx.
    stack(d, 'p0', 0, 'lang', 9);
    const seesaw = spawnBlock(d.world('p0'), 'lang', cx + 12, layout.surfaceY - 8 - 16 * 9, 0);
    d.tick(150);
    expect(d.snap().players.p0.placed).toBe(10);
    expect(d.snap().players.p0.heightPx).toBeLessThan(C.goalPx);
    // A lang dropped onto the overhanging end makes it rock; its corner swings above the goal line.
    spawnBlock(d.world('p0'), 'lang', cx + 38, layout.surfaceY - 16 * 10 - 40, 0);
    let rockedOverGoal = 0;
    let heightOverGoal = 0;
    for (let i = 0; i < 150; i++) {
      d.tick();
      const s = d.snap();
      if (s.players.p0.heightPx >= C.goalPx) heightOverGoal++;
      if (seesaw.angularSpeed > C.restAngSpeed && layout.surfaceY - seesaw.bounds.min.y >= C.goalPx) {
        rockedOverGoal++;
        expect(s.winner).toBeNull();
      }
    }
    expect(rockedOverGoal).toBeGreaterThan(0);
    expect(heightOverGoal).toBeGreaterThan(0);
    expect(d.snap().winner).toBeNull();
  });

  it('result is null until 120 s, non-null at exactly 120000 ms; fast mode ends at 540 ticks', () => {
    const d = driver(['p0', 'p1']); // the baseline tick is tick 1
    d.tick(3598);
    expect(d.g.result()).toBeNull();
    expect(d.snap().timeLeftMs).toBeGreaterThan(0);
    d.tick();
    expect(d.snap().timeLeftMs).toBe(0);
    expect(d.g.result()).toEqual([['p0', 'p1']]);
    const f = driver(['p0', 'p1'], { durationMs: 18000 });
    f.tick(538);
    expect(f.g.result()).toBeNull();
    f.tick();
    expect(f.g.result()).not.toBeNull();
    expect(f.snap().durationMs).toBe(18000);
  });

  it('absent player: crane idles and drops nothing, but its tower keeps falling/settling; on return old counters do not fire', () => {
    const d = driver(['p0', 'p1'], { rand: always('kurz'), absent: ['p1'] });
    const p = () => d.snap().players.p1;
    const x0 = p().craneX;
    spawnBlock(d.world('p1'), 'kurz', layout.plots[1].centre, layout.surfaceY - 60, 0);
    d.tick(ticksFor(C.restHoldMs + 1500));
    expect(p().heightPx).toBe(16);
    expect(p().craneX).toBe(x0);
    expect(blocks(d.snap(), 'p1')).toHaveLength(1);
    // Returns with counters pressed while away: they do not fire.
    d.join('p1', { drops: 4, primaryTaps: 2, turnsCw: 3 });
    d.tick();
    expect(blocks(d.snap(), 'p1')).toHaveLength(1);
    expect(p().hang).toEqual({ kind: 'kurz', rot: 0 });
    d.press('p1', 'turnsCw');
    d.tick();
    expect(p().hang?.rot).toBe(1);
    // Leaves again, presses while away, returns: still nothing stale.
    const away = { ...d.inputs.p1, drops: d.inputs.p1.drops + 3 };
    delete d.inputs.p1;
    d.tick(3);
    d.join('p1', away);
    d.tick();
    expect(blocks(d.snap(), 'p1')).toHaveLength(1);
    d.press('p1', 'drops');
    d.tick();
    expect(blocks(d.snap(), 'p1')).toHaveLength(2);
  });

  it('snapshot size: 4 players × 40 resting blocks stay below 4500 chars; every block entry is 5 integers', () => {
    const d = driver(['p0', 'p1', 'p2', 'p3'], { rand: always('kurz') });
    fill40(d);
    d.tick(ticksFor(C.restHoldMs + 1000));
    const s = d.snap();
    const len = JSON.stringify(s).length;
    console.log(`[wackelturm] snapshot 4 × 40 blocks: ${len} chars`);
    expect(len).toBeLessThan(4500);
    for (const k of ['p0', 'p1', 'p2', 'p3']) {
      expect(s.players[k].blocks).toHaveLength(40 * 5);
      expect(s.players[k].blocks.every((v) => Number.isInteger(v))).toBe(true);
      expect(s.players[k].placed).toBe(40);
    }
    expect(s.winner).toBeNull();
  });

  it('performance: 4 × 40 bodies, 60 host ticks average < 8 ms per tick', () => {
    const d = driver(['p0', 'p1', 'p2', 'p3'], { rand: always('kurz') });
    fill40(d);
    d.tick(30);
    const t0 = performance.now();
    d.tick(60);
    const avg = (performance.now() - t0) / 60;
    console.log(`[wackelturm] tick cost 4 × 40 bodies: ${avg.toFixed(2)} ms`);
    expect(avg).toBeLessThan(8);
  });
});

/** 40 kurz per player: 6 per row, 7 rows (top at 112 px, below the goal). */
function fill40(d: Driver) {
  for (const [i, k] of ['p0', 'p1', 'p2', 'p3'].entries()) {
    const plot = layout.plots[i];
    for (let n = 0; n < 40; n++) {
      const col = n % 6;
      const row = Math.floor(n / 6);
      spawnBlock(d.world(k), 'kurz', plot.centre + (col - 2.5) * 16, layout.surfaceY - 8 - 16 * row, 0 as Rot);
    }
  }
}

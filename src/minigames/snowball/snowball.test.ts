import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../config';
import { mulberry32 } from '../../flow/rng';
import type { AssetFile } from '../../gfx/assetTypes';
import { neutralInput, type InputState } from '../../net/protocol';
import { defaultProfile } from '../../save/profile';
import { buildArena, tileAt } from '../common/arena';
import { playerKey, type GamePlayer, type PlayerKey } from '../types';
import { createSnowballHost, SPAWNS, type SnowState } from './snowballHost';
import { stepMover, type Mover } from './snowballMove';

const file = JSON.parse(readFileSync('public/assets/arena-schneeball.json', 'utf8')) as AssetFile;
const arena = buildArena(file, 'schneeball.map');
const C = CONFIG.snowball;
const DT = 1 / 30;

const gp = (keys: string[], remote = true): GamePlayer[] =>
  keys.map((k) => {
    const slot = Number(k.slice(1)) as 0 | 1 | 2 | 3;
    return { key: playerKey(slot), slot, name: k, look: defaultProfile(k).look, remote };
  });

/** Test driver: keeps per-player input incl. growing tap/shove counters. */
function driver(keys: string[], opts: { remote?: Record<string, boolean>; durationMs?: number } = {}) {
  const players = gp(keys).map((p) => ({ ...p, remote: opts.remote?.[p.key] ?? true }));
  const g = createSnowballHost(players, mulberry32(7), arena, opts.durationMs);
  const inputs: Record<PlayerKey, InputState> = {};
  for (const k of keys) inputs[k] = neutralInput();
  const tick = (n = 1) => { for (let i = 0; i < n; i++) g.tick(DT, inputs); };
  tick(); // baseline tick for the edge counters
  const set = (k: string, p: Partial<InputState>) => { inputs[k] = { ...neutralInput(), primaryTaps: inputs[k].primaryTaps, shoves: inputs[k].shoves, ...p }; };
  const tap = (k: string, aimX: number, aimY: number, charge = 0) => {
    inputs[k] = { ...inputs[k], aimX, aimY, primaryCharge: charge, primaryTaps: inputs[k].primaryTaps + 1 };
  };
  const snap = (): SnowState => g.snapshot();
  return { g, inputs, tick, set, tap, snap };
}

/** Walk p2 from its spawn straight up to (90, 110), next to p0 at (60, 110). */
function p2ToMiddle(d: ReturnType<typeof driver>) {
  d.set('p2', { up: true });
  while (d.snap().players.p2.y > 110 + 1) d.tick();
  d.set('p2', {});
  d.tick();
}

describe('schneeball spawns', () => {
  it('each spawn circle is free of solids and not on the pond', () => {
    for (const [x, y] of SPAWNS) {
      expect(tileAt(arena, x, y)).not.toBe('j');
      for (const s of arena.solids) {
        const cx = Math.max(s.x, Math.min(x, s.x + s.w));
        const cy = Math.max(s.y, Math.min(y, s.y + s.h));
        expect(Math.hypot(x - cx, y - cy)).toBeGreaterThanOrEqual(C.bodyRadius);
      }
    }
  });
});

describe('schneeball host', () => {
  it('walks at 60 px/s on snow and keeps sliding on the pond after releasing the keys', () => {
    const d = driver(['p0', 'p2']);
    const y0 = d.snap().players.p2.y;
    d.set('p2', { up: true });
    d.tick(30);
    expect(y0 - d.snap().players.p2.y).toBeCloseTo(60, 5);

    let m: Mover = { x: 280, y: 110, vx: 0, vy: 0, dir: 'down' };
    expect(tileAt(arena, m.x, m.y)).toBe('j');
    const left = { ...neutralInput(), left: true };
    for (let i = 0; i < 15; i++) m = stepMover(m, left, DT, arena);
    const xRelease = m.x;
    for (let i = 0; i < 15; i++) m = stepMover(m, neutralInput(), DT, arena);
    expect(xRelease - m.x).toBeGreaterThan(5);
    expect(Math.abs(m.vx)).toBeGreaterThan(1);
    expect(Math.hypot(m.vx, m.vy)).toBeLessThanOrEqual(C.walkSpeed * 1.5 + 1e-9);
  });

  it('throws along facing when aim is on the thrower', () => {
    const d = driver(['p0', 'p1']);
    const p = d.snap().players.p0; // facing down
    d.tap('p0', p.x, p.y);
    d.tick();
    const b0 = d.snap().balls[0];
    expect(b0).toBeDefined();
    expect(Number.isFinite(b0.x) && Number.isFinite(b0.y)).toBe(true);
    expect(b0.vx).toBe(0);
    expect(b0.vy).toBeGreaterThan(0);
    d.tick(2);
    expect(d.snap().balls[0].y).toBeGreaterThan(b0.y);
  });

  it('a charged throw flies farther than a tap', () => {
    const dist = (charge: number) => {
      const d = driver(['p0', 'p2']);
      const p = d.snap().players.p2;
      d.tap('p2', p.x, p.y - 100, charge); // straight up
      let max = 0;
      for (let i = 0; i < 60; i++) {
        d.tick();
        for (const b of d.snap().balls) max = Math.max(max, Math.hypot(b.x - p.x, b.y - (p.y - 8)));
      }
      return max;
    };
    const tap = dist(0);
    const full = dist(1);
    expect(tap).toBeGreaterThan(C.ballRange[0] - 10);
    expect(tap).toBeLessThanOrEqual(C.ballRange[0]);
    expect(full).toBeGreaterThan(tap + 10);
  });

  it('ignores throws without ammo and does not queue them', () => {
    const d = driver(['p0', 'p1']);
    const ids = new Set<number>();
    const look = () => { for (const b of d.snap().balls) ids.add(b.id); };
    // Gaps of 300 ms: more than throwGapMs, less than reloadMs (a throw restarts the reload).
    for (let i = 0; i < 5; i++) {
      d.tap('p0', 200, 110);
      d.tick();
      look();
      d.tick(9);
    }
    d.tap('p0', 200, 110); // 6th press without ammo
    d.tick();
    look();
    expect(ids.size).toBe(5);
    expect(d.snap().players.p0.balls).toBe(0);
    // Wait for exactly one reload, then press twice: one throw only.
    for (let i = 0; i < 30 && d.snap().players.p0.balls === 0; i++) d.tick();
    expect(d.snap().players.p0.balls).toBe(1);
    d.tap('p0', 200, 110);
    d.tap('p0', 200, 110); // second press in the same tick
    d.tick();
    look();
    d.tick(9);
    d.tap('p0', 200, 110);
    d.tick();
    look();
    expect(ids.size).toBe(6);
  });

  it('reloads one ball per 0.6 s only while standing still on snow', () => {
    const d = driver(['p0', 'p1']);
    d.tap('p0', 200, 110);
    d.set('p1', { left: true }); // p1 walks from the start
    d.tap('p1', 200, 110);
    d.tick();
    expect(d.snap().players.p0.balls).toBe(C.maxBalls - 1);
    d.tick(15); // 0.5 s
    expect(d.snap().players.p0.balls).toBe(C.maxBalls - 1);
    expect(d.snap().players.p0.reloading).toBe(true);
    d.tick(4); // > 0.6 s
    expect(d.snap().players.p0.balls).toBe(C.maxBalls);
    expect(d.snap().players.p0.reloading).toBe(false);

    // p1 keeps walking: no reload.
    while (tileAt(arena, d.snap().players.p1.x, d.snap().players.p1.y) !== 'j') {
      d.tick();
      expect(d.snap().players.p1.balls).toBe(C.maxBalls - 1);
    }
    // On the pond: slides to a stop, still no reload.
    d.set('p1', {});
    d.tick(240);
    const p1 = d.snap().players.p1;
    expect(tileAt(arena, p1.x, p1.y)).toBe('j');
    expect(Math.hypot(p1.vx, p1.vy)).toBeLessThan(1);
    d.tick(30);
    expect(d.snap().players.p1.balls).toBe(C.maxBalls - 1);
    // Charging blocks reload too.
    d.tap('p0', 200, 110);
    d.tick();
    d.set('p0', { primary: true });
    d.tick(30);
    expect(d.snap().players.p0.charging).toBe(true);
    expect(d.snap().players.p0.balls).toBe(C.maxBalls - 1);
  });

  it('a hit gives +2 to the thrower and -1 to the victim, never below 0', () => {
    const d = driver(['p0', 'p1', 'p2']);
    p2ToMiddle(d);
    d.tap('p2', 60, 110);
    d.tick(15);
    let s = d.snap();
    expect(s.players.p2.score).toBe(C.hitPoints);
    expect(s.players.p0.score).toBe(0);
    expect(s.players.p0.invulnMs).toBeGreaterThan(0);
    expect(s.fx.some((f) => f.kind === 'treffer')).toBe(true);
    expect(s.balls.length).toBe(0);
    d.tick(Math.ceil(C.invulnMs / 1000 / DT));
    d.tap('p0', 90, 110);
    d.tick(15);
    s = d.snap();
    expect(s.players.p0.score).toBe(C.hitPoints);
    expect(s.players.p2.score).toBe(C.hitPoints - C.hitPenalty);
    expect(s.players.p1.score).toBe(0);
  });

  it('a victim is invulnerable for 1.5 s after a hit', () => {
    const d = driver(['p0', 'p2']);
    p2ToMiddle(d);
    d.tap('p2', 60, 110);
    d.tick(9);
    expect(d.snap().players.p2.score).toBe(2);
    d.tap('p2', 60, 110);
    d.tick(15); // second ball within 1.5 s: dies on the victim, no points
    expect(d.snap().players.p2.score).toBe(2);
    expect(d.snap().balls.length).toBe(0);
    d.tick(Math.ceil(C.invulnMs / 1000 / DT));
    expect(d.snap().players.p0.invulnMs).toBe(0);
    d.tap('p2', 60, 110);
    d.tick(15);
    expect(d.snap().players.p2.score).toBe(4);
  });

  it('a snowman breaks after 3 hits, lets balls through and rebuilds after 15 s', () => {
    const d = driver(['p0', 'p1']);
    const sm = () => d.snap().snowmen.find((s) => s.id === 'obj60')!;
    expect(d.snap().snowmen.map((s) => s.state)).toEqual(['heil', 'heil', 'heil']);
    d.set('p0', { down: true });
    while (d.snap().players.p0.y < 124) d.tick();
    d.set('p0', {});
    d.tick();
    const y = d.snap().players.p0.y;
    const states: string[] = [];
    let since = 0;
    for (let i = 0; i < 3; i++) {
      d.tap('p0', 200, y);
      for (let t = 0; t < 20; t++) {
        d.tick();
        since = sm().state === 'kaputt' ? since + 1 : 0;
      }
      expect(d.snap().balls.length).toBe(0);
      states.push(sm().state);
    }
    expect(states).toEqual(['schaden1', 'schaden2', 'kaputt']);
    expect(d.snap().fx.some((f) => f.kind === 'zerfall')).toBe(true);
    // Broken: the next ball flies through.
    d.tap('p0', 200, y);
    let maxX = 0;
    for (let i = 0; i < 30; i++) { d.tick(); since++; for (const b of d.snap().balls) maxX = Math.max(maxX, b.x); }
    expect(maxX).toBeGreaterThan(140);
    while (sm().state === 'kaputt' && since < 1000) { d.tick(); since++; }
    expect(sm().state).toBe('aufbau');
    expect(Math.abs(since - C.snowmanRebuildMs / 1000 / DT)).toBeLessThanOrEqual(1);
    let aufbau = 0;
    while (sm().state === 'aufbau' && aufbau < 100) { d.tick(); aufbau++; }
    expect(Math.abs(aufbau - C.snowmanAufbauMs / 1000 / DT)).toBeLessThanOrEqual(1);
    expect(sm()).toMatchObject({ state: 'heil', hits: 0 });
  });

  it('shove slide stops at a wall', () => {
    const d = driver(['p0', 'p2']);
    p2ToMiddle(d);
    d.set('p2', { left: true });
    while (d.snap().players.p2.x > 72) d.tick();
    d.set('p2', {});
    d.tick();
    d.inputs.p2 = { ...d.inputs.p2, shoves: d.inputs.p2.shoves + 1 };
    d.tick();
    expect(d.snap().players.p0.stun).toBe(true);
    d.tick(20);
    const wall = arena.solids.find((s) => s.id === 'wall2,6')!;
    const p0 = d.snap().players.p0;
    expect(p0.x).toBeLessThan(55);
    expect(p0.x - C.bodyRadius).toBeGreaterThanOrEqual(wall.x + wall.w - 0.01);
  });

  it('hits test remote throwers against rewound positions', () => {
    const run = (remote: boolean) => {
      const d = driver(['p0', 'p2'], { remote: { p2: remote } });
      p2ToMiddle(d);
      // The victim steps down out of the line just as the ball is thrown.
      d.tap('p2', 60, 110);
      d.set('p0', { down: true });
      d.tick(15);
      return d.snap().players.p2.score;
    };
    expect(run(true)).toBe(C.hitPoints);
    expect(run(false)).toBe(0);
  });

  it('ends after 120 s with tie groups by score', () => {
    const d = driver(['p0', 'p1', 'p2', 'p3']);
    p2ToMiddle(d);
    d.tap('p2', 60, 110);
    d.tick(15);
    expect(d.g.result()).toBeNull();
    d.set('p2', {});
    d.tick(Math.ceil(C.durationMs / 1000 / DT));
    expect(d.snap().timeLeftMs).toBe(0);
    expect(d.g.result()).toEqual([['p2'], ['p0', 'p1', 'p3']]);
  });
});

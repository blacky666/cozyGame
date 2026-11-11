import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../../config';
import { mulberry32 } from '../../flow/rng';
import type { AssetFile } from '../../gfx/assetTypes';
import { neutralInput, type InputState } from '../../net/protocol';
import { defaultProfile } from '../../save/profile';
import { buildArena, tileAt } from '../common/arena';
import { playerKey, type GamePlayer, type PlayerKey } from '../types';
import { BALL_LIFT } from './snowballBalls';
import { createSnowballHost, SPAWNS, type SnowState } from './snowballHost';
import { stepMover, type Mover } from './snowballMove';
import { MINIGAMES } from '../registry';
import { lerpSnow, snowball } from './snowball';
import { toMap } from './snowballView';

// The views import Phaser, which needs a browser; the definition tests only need its module to load.
vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {} } } }));

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
function driver(keys: string[], opts: { remote?: Record<string, boolean>; durationMs?: number; rand?: () => number } = {}) {
  const players = gp(keys).map((p) => ({ ...p, remote: opts.remote?.[p.key] ?? true }));
  const g = createSnowballHost(players, opts.rand ?? mulberry32(7), arena, opts.durationMs);
  const inputs: Record<PlayerKey, InputState> = {};
  for (const k of keys) inputs[k] = neutralInput();
  const tick = (n = 1) => { for (let i = 0; i < n; i++) g.tick(DT, inputs); };
  tick(); // baseline tick for the edge counters
  const set = (k: string, p: Partial<InputState>) => {
    const { primaryTaps, secondaryTaps, shoves } = inputs[k];
    inputs[k] = { ...neutralInput(), primaryTaps, secondaryTaps, shoves, ...p };
  };
  /** Left click (normal throw) at the aim point. */
  const tap = (k: string, aimX: number, aimY: number) => {
    inputs[k] = { ...inputs[k], aimX, aimY, primaryTaps: inputs[k].primaryTaps + 1 };
  };
  /** Right click (strong throw) at the aim point. */
  const strong = (k: string, aimX: number, aimY: number) => {
    inputs[k] = { ...inputs[k], aimX, aimY, secondaryTaps: inputs[k].secondaryTaps + 1 };
  };
  const snap = (): SnowState => g.snapshot();
  return { g, inputs, tick, set, tap, strong, snap };
}

/** Where a figure's body is hit: the ball path point above its feet. */
const body = (p: { x: number; y: number }) => [p.x, p.y - BALL_LIFT] as const;
/** All fx of one kind seen while ticking n times (by id), with their positions. */
function collectFx(d: ReturnType<typeof driver>, kind: string, n: number) {
  const seen = new Map<number, { x: number; y: number }>();
  for (let i = 0; i < n; i++) {
    d.tick();
    for (const f of d.snap().fx) if (f.kind === kind) seen.set(f.id, { x: f.x, y: f.y });
  }
  return [...seen.values()];
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
  it('a disconnected player (no input) cannot be hit', () => {
    const d = driver(['p0', 'p2']);
    p2ToMiddle(d);
    const before = d.snap().players.p2.score;
    const p0 = d.snap().players.p0;
    const p2 = d.snap().players.p2;
    // p2 drops out: its key is no longer part of the inputs record.
    delete d.inputs.p2;
    d.tap('p0', ...body(p2));
    d.tick(10);
    expect(d.snap().players.p2.score).toBe(before);
    expect(d.snap().players.p0.score).toBe(p0.score);
    expect(d.snap().players.p2.invulnMs).toBe(0);
  });

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

  it('throws along facing when aim is on the spawn point', () => {
    const d = driver(['p0', 'p1']);
    const p = d.snap().players.p0; // facing down
    d.tap('p0', p.x, p.y - BALL_LIFT);
    d.tick();
    const b0 = d.snap().balls[0];
    expect(b0).toBeDefined();
    expect(Number.isFinite(b0.x) && Number.isFinite(b0.y)).toBe(true);
    expect(b0.vx).toBe(0);
    expect(b0.vy).toBeGreaterThan(0);
    d.tick(2);
    expect(d.snap().balls[0].y).toBeGreaterThan(b0.y);
  });

  it('a normal throw lands exactly on the aim point inside range', () => {
    const d = driver(['p0', 'p2']);
    const p = d.snap().players.p2; // (90, 180), open snow to the upper right
    const aim = { x: p.x + 60, y: p.y - 40 };
    d.tap('p2', aim.x, aim.y);
    d.tick();
    expect(d.snap().balls.length).toBe(1);
    const fx = collectFx(d, 'zerfall', 60);
    expect(d.snap().balls.length).toBe(0);
    expect(fx.length).toBe(1);
    expect(Math.hypot(fx[0].x - aim.x, fx[0].y - aim.y)).toBeLessThanOrEqual(1);
  });

  /** From p1's spawn (350, 110) up-left along (-5, -1) the arena is free for more than strongRange. */
  const FREE = { x: -5 / Math.hypot(5, 1), y: -1 / Math.hypot(5, 1) };

  it('a throw at a point beyond range lands at the end of the range', () => {
    const d = driver(['p0', 'p1']);
    const p = d.snap().players.p1;
    const sx = p.x;
    const sy = p.y - BALL_LIFT;
    d.tap('p1', sx + FREE.x * 500, sy + FREE.y * 500);
    d.tick();
    const fx = collectFx(d, 'zerfall', 60);
    expect(d.snap().balls.length).toBe(0);
    expect(fx.length).toBe(1);
    const end = { x: sx + FREE.x * C.normalRange, y: sy + FREE.y * C.normalRange };
    expect(Math.hypot(fx[0].x - end.x, fx[0].y - end.y)).toBeLessThanOrEqual(1);
  });

  it('the ball flies from the spawn point toward the aim point', () => {
    const d = driver(['p0', 'p2']);
    const p = d.snap().players.p2;
    d.tap('p2', p.x + 100, p.y - BALL_LIFT); // straight right at hand height
    d.tick();
    const b = d.snap().balls[0];
    expect(b.vy).toBe(0);
    expect(b.vx).toBeCloseTo(C.normalSpeed, 5);
    expect(b.total).toBeCloseTo(100, 5);
  });

  it('a right click throws a strong ball that is faster and goes farther', () => {
    const run = (strong: boolean) => {
      const d = driver(['p0', 'p1']);
      const p = d.snap().players.p1;
      const sx = p.x;
      const sy = p.y - BALL_LIFT;
      // Far away along the free line: both throws end at their range.
      const [ax, ay] = [sx + FREE.x * 500, sy + FREE.y * 500];
      if (strong) d.strong('p1', ax, ay); else d.tap('p1', ax, ay);
      d.tick();
      const b = d.snap().balls[0];
      const fx = collectFx(d, 'zerfall', 90);
      return { speed: Math.hypot(b.vx, b.vy), dist: Math.hypot(fx[0].x - sx, fx[0].y - sy) };
    };
    const normal = run(false);
    const strong = run(true);
    expect(normal.speed).toBeCloseTo(C.normalSpeed, 5);
    expect(strong.speed).toBeCloseTo(C.strongSpeed, 5);
    expect(Math.abs(normal.dist - C.normalRange)).toBeLessThanOrEqual(1);
    expect(Math.abs(strong.dist - C.strongRange)).toBeLessThanOrEqual(1);
  });

  it('after a strong throw no throw is possible for 0.8 s', () => {
    const d = driver(['p0', 'p2']);
    const ids = new Set<number>();
    const look = () => { for (const b of d.snap().balls) ids.add(b.id); };
    d.strong('p2', 300, 60);
    d.tick();
    look();
    expect(ids.size).toBe(1);
    expect(d.snap().players.p2.strongCdMs).toBeGreaterThan(0);
    // Left and right presses during the cooldown are consumed.
    d.tick(9); // 0.33 s
    d.tap('p2', 300, 60);
    d.tick();
    look();
    d.tick(5);
    d.strong('p2', 300, 60);
    d.tick();
    look();
    expect(ids.size).toBe(1);
    // ... and not queued: nothing comes after the cooldown ends.
    d.tick(Math.ceil(C.strongCooldownMs / 1000 / DT));
    look();
    expect(ids.size).toBe(1);
    expect(d.snap().players.p2.strongCdMs).toBe(0);
    d.tap('p2', 300, 60);
    d.tick();
    look();
    expect(ids.size).toBe(2);
  });

  it('left and right in the same tick throw one strong ball', () => {
    const d = driver(['p0', 'p2']);
    const ids = new Set<number>();
    const look = () => { for (const b of d.snap().balls) ids.add(b.id); };
    d.tap('p2', 300, 60);
    d.strong('p2', 300, 60);
    d.tick();
    look();
    const s = d.snap();
    expect(s.balls.length).toBe(1);
    expect(Math.hypot(s.balls[0].vx, s.balls[0].vy)).toBeCloseTo(C.strongSpeed, 5);
    expect(s.players.p2.balls).toBe(C.maxBalls - 1);
    // The dropped left press does not fire later.
    for (let i = 0; i < Math.ceil(C.strongCooldownMs / 1000 / DT) + 5; i++) { d.tick(); look(); }
    expect(ids.size).toBe(1);
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
  });

  it('a hit gives +2 to the thrower and -1 to the victim, never below 0', () => {
    const d = driver(['p0', 'p1', 'p2']);
    p2ToMiddle(d);
    d.tap('p2', 60, 110 - BALL_LIFT);
    d.tick(15);
    let s = d.snap();
    expect(s.players.p2.score).toBe(C.hitPoints);
    expect(s.players.p0.score).toBe(0);
    expect(s.players.p0.invulnMs).toBeGreaterThan(0);
    expect(s.fx.some((f) => f.kind === 'treffer')).toBe(true);
    expect(s.balls.length).toBe(0);
    d.tick(Math.ceil(C.invulnMs / 1000 / DT));
    d.tap('p0', 90, 110 - BALL_LIFT);
    d.tick(15);
    s = d.snap();
    expect(s.players.p0.score).toBe(C.hitPoints);
    expect(s.players.p2.score).toBe(C.hitPoints - C.hitPenalty);
    expect(s.players.p1.score).toBe(0);
  });

  it('a hit knocks the victim down for 0.9 s: no move, no throw, no reload, not shovable', () => {
    const d = driver(['p0', 'p2']);
    p2ToMiddle(d);
    // p0 throws once so it has room to reload.
    d.tap('p0', 60, 200);
    d.tick(10);
    d.tap('p2', 60, 110 - BALL_LIFT);
    let ticks = 0;
    while (!d.snap().players.p0.down && ticks < 15) { d.tick(); ticks++; }
    expect(d.snap().players.p0.down).toBe(true);
    const at = { x: d.snap().players.p0.x, y: d.snap().players.p0.y };
    const balls = d.snap().players.p0.balls;
    expect(balls).toBeLessThan(C.maxBalls);
    // While down: try to walk, throw (left and right) and get shoved by p2.
    d.set('p0', { right: true });
    d.tap('p0', 200, 110);
    d.strong('p0', 200, 110);
    d.inputs.p2 = { ...d.inputs.p2, shoves: d.inputs.p2.shoves + 1 };
    let downTicks = 0;
    for (; downTicks < 60; downTicks++) {
      d.tick();
      const p0 = d.snap().players.p0;
      if (!p0.down) break;
      expect(p0).toMatchObject({ x: at.x, y: at.y, vx: 0, vy: 0, stun: false, balls, reloading: false });
      expect(d.snap().balls.length).toBe(0);
    }
    // Down from the hit tick on for downMs (the hit tick counted already).
    expect(Math.abs(downTicks + 1 - C.downMs / 1000 / DT)).toBeLessThanOrEqual(1);
    // Up again: walks, and the presses made while down were consumed.
    d.tick(3);
    expect(d.snap().players.p0.x).toBeGreaterThan(at.x);
    expect(d.snap().balls.length).toBe(0);
  });

  it('the victim stays invulnerable for 2.5 s in total', () => {
    const d = driver(['p0', 'p2']);
    p2ToMiddle(d);
    d.tap('p2', 60, 110 - BALL_LIFT);
    d.tick(9);
    expect(d.snap().players.p2.score).toBe(2);
    expect(d.snap().players.p0.invulnMs).toBeGreaterThan(C.invulnMs - 300);
    // After the knockdown, still protected: the second ball dies on the victim, no points.
    d.tick(Math.ceil(C.downMs / 1000 / DT) + 3);
    expect(d.snap().players.p0.down).toBe(false);
    d.tap('p2', 60, 110 - BALL_LIFT);
    d.tick(15);
    expect(d.snap().players.p2.score).toBe(2);
    expect(d.snap().players.p0.down).toBe(false);
    expect(d.snap().balls.length).toBe(0);
    d.tick(Math.ceil(C.invulnMs / 1000 / DT));
    expect(d.snap().players.p0.invulnMs).toBe(0);
    d.tap('p2', 60, 110 - BALL_LIFT);
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
      d.tap('p0', 200, y - BALL_LIFT);
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
    d.tap('p0', 200, y - BALL_LIFT);
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
      d.tap('p2', 60, 110 - BALL_LIFT);
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
    d.tap('p2', 60, 110 - BALL_LIFT);
    d.tick(15);
    expect(d.g.result()).toBeNull();
    d.set('p2', {});
    d.tick(Math.ceil(C.durationMs / 1000 / DT));
    expect(d.snap().timeLeftMs).toBe(0);
    expect(d.g.result()).toEqual([['p2'], ['p0', 'p1', 'p3']]);
  });

  /** Walk p0 to (129, 128): directly below snowman obj60, so a ball spawned at feet - 8 overlaps it. */
  function p0BelowSnowman(d: ReturnType<typeof driver>) {
    d.set('p0', { down: true });
    while (d.snap().players.p0.y < 128) d.tick();
    d.set('p0', { right: true });
    while (d.snap().players.p0.x < 129) d.tick();
    d.set('p0', {});
    d.tick();
    const p = d.snap().players.p0;
    const sm = arena.solids.find((s) => s.id === 'obj60')!;
    // Precondition: the spawn point overlaps the snowman's hitbox.
    expect(p.x).toBeGreaterThan(sm.x);
    expect(p.x).toBeLessThan(sm.x + sm.w);
    expect(p.y - 8 - C.ballRadius).toBeLessThan(sm.y + sm.h);
    return p;
  }

  it('a throw away from a wall the thrower stands directly below still flies', () => {
    const d = driver(['p0', 'p1']);
    const p = p0BelowSnowman(d);
    d.tap('p0', p.x, p.y + 100);
    d.tick();
    const b = d.snap().balls[0];
    expect(b).toBeDefined();
    expect(b.y - (p.y - 8)).toBeGreaterThanOrEqual(3);
    d.tick(10);
    expect(d.snap().snowmen.find((s) => s.id === 'obj60')!).toMatchObject({ state: 'heil', hits: 0 });
    expect(d.snap().balls.length).toBe(1);
  });

  it('a throw toward the solid the thrower stands below still breaks against it', () => {
    const d = driver(['p0', 'p1']);
    const p = p0BelowSnowman(d);
    d.tap('p0', p.x, p.y - 100);
    d.tick(9); // 0.3 s
    expect(d.snap().balls.length).toBe(0);
    expect(d.snap().snowmen.find((s) => s.id === 'obj60')!).toMatchObject({ state: 'schaden1', hits: 1 });
  });

  it('a shoved player cannot throw while stumbling', () => {
    const d = driver(['p0', 'p2']);
    p2ToMiddle(d);
    d.set('p2', { left: true });
    while (d.snap().players.p2.x > 72) d.tick();
    d.set('p2', {});
    d.tick();
    d.inputs.p2 = { ...d.inputs.p2, shoves: d.inputs.p2.shoves + 1 };
    d.tick();
    expect(d.snap().players.p0.stun).toBe(true);
    d.tap('p0', 200, 110);
    d.strong('p0', 200, 110);
    d.tick();
    expect(d.snap().players.p0.stun).toBe(true);
    expect(d.snap().balls.length).toBe(0);
    expect(d.snap().players.p0.balls).toBe(C.maxBalls);
    // The press during the stun is consumed, not queued for later.
    d.set('p0', {});
    while (d.snap().players.p0.stun) d.tick();
    d.tick(10);
    expect(d.snap().balls.length).toBe(0);
    d.tap('p0', 200, 110);
    d.tick();
    expect(d.snap().balls.length).toBe(1);
  });
});

/** First pickup: kind index (0 abpraller, 1 riesenball, 2 hat) on tile col 3 / row 8 (centre 56, 136). */
const scripted = (kind: 0 | 1 | 2) => {
  const queue = [(kind + 0.5) / 3, 3.5 / 26, (8 - 3 + 0.5) / 9];
  const fallback = mulberry32(3);
  return () => queue.shift() ?? fallback();
};
const SPAWN_TICKS = Math.ceil(C.spawnMs / 1000 / DT) + 1;

/** Run until the first pickup exists, then walk p0 down onto it. */
function collectWithP0(d: ReturnType<typeof driver>) {
  d.tick(SPAWN_TICKS);
  const pk = d.snap().pickups[0];
  expect(pk).toMatchObject({ x: 56, y: 136 });
  d.set('p0', { down: true });
  for (let i = 0; i < 100 && d.snap().pickups.length > 0; i++) d.tick();
  d.set('p0', {});
  d.tick();
  return pk;
}

describe('schneeball extras', () => {
  it('spawns at most 2 pickups, never on walls, the pond or near players', () => {
    const d = driver(['p0', 'p1', 'p2']);
    d.tick(SPAWN_TICKS - 5);
    expect(d.snap().pickups.length).toBe(0);
    let seen = 0;
    for (let i = 0; i < 60 * 30; i++) {
      d.tick();
      const s = d.snap();
      seen = Math.max(seen, s.pickups.length);
      expect(s.pickups.length).toBeLessThanOrEqual(C.maxPickups);
      for (const pk of s.pickups) {
        expect(['w', 'j']).not.toContain(tileAt(arena, pk.x, pk.y));
        for (const so of arena.solids) {
          const cx = Math.max(so.x, Math.min(pk.x, so.x + so.w));
          const cy = Math.max(so.y, Math.min(pk.y, so.y + so.h));
          expect(Math.hypot(pk.x - cx, pk.y - cy)).toBeGreaterThanOrEqual(6);
        }
        for (const p of Object.values(s.players)) expect(Math.hypot(p.x - pk.x, p.y - pk.y)).toBeGreaterThanOrEqual(24);
      }
    }
    expect(seen).toBe(C.maxPickups);
  });

  it('collecting an abpraller makes the next 3 throws abpraller balls', () => {
    const d = driver(['p0', 'p2'], { rand: scripted(0) });
    collectWithP0(d);
    expect(d.snap().players.p0).toMatchObject({ extra: 'abpraller', extraLeft: C.extraThrows });
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      d.tap('p0', 300, d.snap().players.p0.y);
      d.tick();
      const bs = d.snap().balls;
      kinds.push(bs[bs.length - 1].kind);
      d.tick(8);
    }
    expect(kinds).toEqual(['abpraller', 'abpraller', 'abpraller', 'normal']);
    expect(d.snap().players.p0).toMatchObject({ extra: null, extraLeft: 0 });
  });

  it('an abpraller ball bounces twice off walls, then breaks', () => {
    const d = driver(['p0', 'p2'], { rand: scripted(0) });
    collectWithP0(d);
    const p = d.snap().players.p0;
    d.strong('p0', p.x - 300, p.y + 300); // down-left into the fence corner, full strong range
    const bounceIds = new Set<number>();
    const zerfallIds = new Set<number>();
    let ticks = 0;
    do {
      d.tick();
      for (const f of d.snap().fx) (f.kind === 'abprall' ? bounceIds : f.kind === 'zerfall' ? zerfallIds : new Set<number>()).add(f.id);
      ticks++;
    } while (d.snap().balls.length > 0 && ticks < 300);
    expect(bounceIds.size).toBe(C.bounces);
    expect(zerfallIds.size).toBe(1);
    expect(d.snap().balls.length).toBe(0);
  });

  it('a riesenschneeball is slower and hits from farther away', () => {
    const run = (kind: 0 | 1) => {
      const d = driver(['p0', 'p2'], { rand: scripted(kind) });
      collectWithP0(d);
      const [sx, sy] = body(d.snap().players.p0);
      const [tx, ty] = body(d.snap().players.p2);
      // The ball line passes 9.5 px beside p2's chest: misses the normal 7 px circle, inside the giant's 11 px.
      const dist = Math.hypot(tx - sx, ty - sy);
      const ux = (tx - sx) / dist;
      const uy = (ty - sy) / dist;
      const side = (9.5 * dist) / Math.sqrt(dist * dist - 9.5 * 9.5);
      d.tap('p0', tx - uy * side, ty + ux * side);
      d.tick();
      const b = d.snap().balls[0];
      const speed = Math.hypot(b.vx, b.vy);
      d.tick(40);
      return { speed, kind: b.kind, score: d.snap().players.p0.score };
    };
    const abp = run(0);
    const giant = run(1);
    expect(abp.kind).toBe('abpraller');
    expect(abp.score).toBe(0);
    expect(giant.kind).toBe('riesenball');
    expect(giant.speed).toBeCloseTo(C.normalSpeed * C.giantSpeedFactor, 5);
    expect(abp.speed).toBeCloseTo(C.normalSpeed, 5);
    expect(giant.score).toBe(C.hitPoints);
  });

  it('the ice hat blocks exactly one hit', () => {
    const d = driver(['p0', 'p2'], { rand: scripted(2) });
    collectWithP0(d);
    expect(d.snap().players.p0.hat).toBe(true);
    const aimAtP0 = () => d.tap('p2', ...body(d.snap().players.p0));
    aimAtP0();
    d.tick(20);
    let s = d.snap();
    expect(s.players.p0).toMatchObject({ hat: false, score: 0 });
    expect(s.players.p0.invulnMs).toBeGreaterThan(0);
    expect(s.players.p0.down).toBe(false);
    expect(s.players.p2.score).toBe(0);
    expect(s.fx.some((f) => f.kind === 'schild_bruch')).toBe(true);
    d.tick(Math.ceil(C.invulnMs / 1000 / DT) + 1);
    aimAtP0();
    d.tick(20);
    s = d.snap();
    expect(s.players.p2.score).toBe(C.hitPoints);
  });
});

describe('schneeball definition', () => {
  const player = (x: number, y: number) => ({
    x, y, vx: 0, vy: 0, dir: 'down' as const, score: 0, balls: 5, reloading: false, invulnMs: 0, down: false,
    strongCdMs: 0, stun: false, swing: false, shoveCdMs: 0, extra: null, extraLeft: 0, hat: false, throwAnimMs: 0,
  });
  const ball = (id: number, x: number, y: number) => ({ id, x, y, vx: 10, vy: 0, left: 100, total: 100, owner: 'p0', kind: 'normal' as const, bounces: 0 });

  it('lerps players and balls by id and takes the rest from the newer state', () => {
    const a: SnowState = {
      timeLeftMs: 1000, players: { p0: { ...player(0, 0), score: 1 } }, balls: [ball(1, 0, 0), ball(2, 50, 50)],
      snowmen: [], pickups: [], fx: [],
    };
    const b: SnowState = {
      timeLeftMs: 900, players: { p0: { ...player(10, 20), score: 3 }, p1: player(5, 5) }, balls: [ball(1, 10, 10), ball(3, 70, 70)],
      snowmen: [{ id: 'obj0', hits: 1, state: 'schaden1', rebuildMs: 0 }], pickups: [{ id: 1, x: 1, y: 2, kind: 'riesenball' }],
      fx: [{ id: 4, kind: 'treffer', x: 3, y: 4 }],
    };
    const s = lerpSnow(a, b, 0.5);
    expect(s.timeLeftMs).toBe(900);
    expect(s.players.p0).toMatchObject({ x: 5, y: 10, score: 3 });
    expect(s.players.p1).toMatchObject({ x: 5, y: 5 });
    expect(s.balls).toEqual([{ ...ball(1, 5, 5) }, ball(3, 70, 70)]);
    expect(s.snowmen).toEqual(b.snowmen);
    expect(s.pickups).toEqual(b.pickups);
    expect(s.fx).toEqual(b.fx);
  });

  it('converts pointer world coordinates to map coordinates', () => {
    expect(toMap(105, 126)).toEqual({ x: 100, y: 100 });
  });

  it('registry offers schneeball and muenzjagd', () => {
    expect(MINIGAMES.map((g) => g.id)).toEqual(['schneeball', 'muenzjagd']);
  });

  it('describes the game and builds its host from the asset map', () => {
    expect(snowball).toMatchObject({
      id: 'schneeball',
      title: 'Schneeball-Schlacht',
      rule: 'Triff die anderen! Treffer +2, getroffen −1.',
      controls: 'WASD laufen · Maus zielen · Linksklick werfen · Rechtsklick fest werfen · Leertaste schubsen',
      durationMs: C.durationMs,
      aimOffset: { x: 5, y: 26 },
    });
    expect(() => snowball.createHost(gp(['p0', 'p1']), mulberry32(1))).toThrow(/assets/);
    const host = snowball.createHost(gp(['p0', 'p1']), mulberry32(1), { assets: { 'arena-schneeball': file } });
    const s = host.snapshot();
    expect(s.players.p0).toMatchObject({ x: SPAWNS[0][0], y: SPAWNS[0][1] });
    expect(s.snowmen.length).toBeGreaterThan(0);
  });
});

describe('snowball botView', () => {
  it('idles without balls and otherwise keeps 60 px from the nearest opponent', () => {
    const g = createSnowballHost(gp(['p0', 'p1']), mulberry32(1), arena);
    const st = g.snapshot();
    expect(snowball.botView?.(st, 'p0')).toMatchObject({ aim: { x: st.players.p1.x, y: st.players.p1.y - BALL_LIFT } });
    st.players.p0.balls = 0;
    expect(snowball.botView?.(st, 'p0')).toEqual({ self: { x: st.players.p0.x, y: st.players.p0.y }, targets: [], idle: true });
    st.players.p0.balls = 3;
    const v = snowball.botView?.(st, 'p0');
    const t = v?.targets[0] ?? { x: 0, y: 0 };
    expect(Math.hypot(t.x - st.players.p1.x, t.y - st.players.p1.y)).toBeCloseTo(60, 5);
  });
});

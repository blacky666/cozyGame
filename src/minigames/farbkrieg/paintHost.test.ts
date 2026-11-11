import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../config';
import { mulberry32 } from '../../flow/rng';
import type { AssetFile } from '../../gfx/assetTypes';
import { neutralInput, type InputState } from '../../net/protocol';
import { defaultProfile } from '../../save/profile';
import { buildArena } from '../common/arena';
import { playerKey, type GamePlayer, type PlayerKey } from '../types';
import { advanceBlob } from './paintBlobs';
import { createGrid, PAINT_SPAWNS } from './paintGrid';
import { createPaintHost, finaleAt, speedOf, type Blob, type PaintPlayer, type PaintState } from './paintHost';

const file = JSON.parse(readFileSync('public/assets/arena-farbkrieg.json', 'utf8')) as AssetFile;
const arena = buildArena(file, 'farbkrieg.map');
const F = CONFIG.farbkrieg;
const DT = 1 / 20;
const grid = createGrid(arena);
const COLS = grid.cols;
const T = grid.tile;

const gp = (keys: string[]): GamePlayer[] =>
  keys.map((k) => {
    const slot = Number(k.slice(1)) as 0 | 1 | 2 | 3;
    return { key: playerKey(slot), slot, name: k, look: defaultProfile(k).look, remote: true };
  });

/** Test driver: per-player input incl. growing tap/shove counters. `absent` players never get an input. */
function driver(keys: string[], opts: { rand?: () => number; absent?: string[]; durationMs?: number } = {}) {
  const g = createPaintHost(gp(keys), opts.rand ?? mulberry32(7), arena, opts.durationMs);
  const inputs: Record<PlayerKey, InputState> = {};
  for (const k of keys) if (!opts.absent?.includes(k)) inputs[k] = neutralInput();
  const tick = (n = 1) => { for (let i = 0; i < n; i++) g.tick(DT, inputs); };
  tick(); // baseline tick for the edge counters
  const set = (k: string, p: Partial<InputState>) => {
    const { primaryTaps, secondaryTaps, shoves } = inputs[k];
    inputs[k] = { ...neutralInput(), primaryTaps, secondaryTaps, shoves, ...p };
  };
  /** Left click at (aimX, aimY). */
  const tap = (k: string, aimX: number, aimY: number) => {
    inputs[k] = { ...inputs[k], aimX, aimY, primaryTaps: inputs[k].primaryTaps + 1 };
  };
  const snap = (): PaintState => g.snapshot();
  return { g, inputs, tick, set, tap, snap };
}

const ownerAt = (s: PaintState, x: number, y: number) => s.grid[Math.floor(y / T) * COLS + Math.floor(x / T)];
/** Grid indices of the paintable tiles whose centre is within r of (x, y). */
const discTiles = (x: number, y: number, r: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < grid.owner.length; i++) {
    if (!grid.paintable[i]) continue;
    const cx = (i % COLS) * T + T / 2;
    const cy = Math.floor(i / COLS) * T + T / 2;
    if (Math.hypot(cx - x, cy - y) <= r) out.push(i);
  }
  return out;
};
const count = (s: string, ch: string) => [...s].filter((c) => c === ch).length;

describe('Farbkrieg host', () => {
  it('starts at the slot spawns with a neutral floor except the spawn tiles', () => {
    const d = driver(['p0', 'p1', 'p2', 'p3']);
    const s = d.snap();
    for (const k of ['p0', 'p1', 'p2', 'p3']) {
      const slot = Number(k.slice(1));
      const [x, y] = PAINT_SPAWNS[slot];
      expect([s.players[k].x, s.players[k].y]).toEqual([x, y]);
      expect(ownerAt(s, x, y)).toBe(String(slot + 1));
      expect(s.players[k].tiles).toBe(1);
    }
    expect(s.finale.phase).toBe('wait');
    expect(s.timeLeftMs).toBe(F.durationMs - DT * 1000);
    expect(s.durationMs).toBe(F.durationMs);
  });

  it('walking paints the tile under the feet', () => {
    const d = driver(['p0', 'p1']);
    d.set('p0', { right: true });
    d.tick(20); // 64 px at 64 px/s
    const s = d.snap();
    expect(s.players.p0.x).toBeCloseTo(PAINT_SPAWNS[0][0] + 64, 5);
    for (let x = PAINT_SPAWNS[0][0]; x <= PAINT_SPAWNS[0][0] + 64; x += 1) expect(ownerAt(s, x, 72)).toBe('1');
    expect(s.players.p0.tiles).toBe(count(s.grid, '1'));
    expect(s.players.p0.tiles).toBe(5);
  });

  it('two players on one neutral tile in the same tick: the lower slot gets it; an owned tile stays with its owner', () => {
    // p0 walks 16 px first, so both enter tile column 13 (x 208..224) in the same tick from both sides.
    const d = driver(['p0', 'p1']);
    d.set('p0', { right: true });
    d.tick(5);
    expect(d.snap().players.p0.x).toBeCloseTo(56, 5);
    d.set('p1', { left: true });
    d.tick(47);
    expect(ownerAt(d.snap(), 216, 72)).toBe('0');
    d.tick();
    const s = d.snap();
    expect(Math.floor(s.players.p0.x / T)).toBe(13);
    expect(Math.floor(s.players.p1.x / T)).toBe(13);
    expect(ownerAt(s, 216, 72)).toBe('1');

    // p1 stands on its own tile; p0 walks onto it and stays: the tile stays p1's.
    const e = driver(['p0', 'p1']);
    e.set('p1', { left: true });
    e.tick(50); // 376 -> 216
    e.set('p1', {});
    e.tick();
    expect(ownerAt(e.snap(), 216, 72)).toBe('2');
    e.set('p0', { right: true });
    e.tick(55); // 40 -> 216
    e.set('p0', {});
    e.tick(5);
    const t = e.snap();
    expect(Math.floor(t.players.p0.x / T)).toBe(13);
    expect(Math.floor(t.players.p1.x / T)).toBe(13);
    expect(ownerAt(t, 216, 72)).toBe('2');
  });

  it('Klecks: left click throws toward the mouse and paints a disc of 24 px where it lands', () => {
    const d = driver(['p0', 'p1']);
    const [x, y] = PAINT_SPAWNS[0];
    d.tap('p0', x + 60, y);
    const kinds: string[] = [];
    const seen = new Set<number>();
    let platsch: { x: number; y: number; r: number } | null = null;
    for (let i = 0; i < 20; i++) {
      d.tick();
      for (const f of d.snap().fx) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        kinds.push(f.kind);
        if (f.kind === 'platsch') platsch = f;
      }
    }
    expect(kinds).toEqual(['wurf', 'platsch']);
    expect(platsch).toEqual(expect.objectContaining({ x: x + 60, y, r: F.klecksPaintR, who: 'p0' }));
    const s = d.snap();
    const disc = discTiles(x + 60, y, F.klecksPaintR);
    expect(disc.length).toBeGreaterThan(4);
    for (const i of disc) expect(s.grid[i]).toBe('1');
    expect(s.blobs).toEqual([]);
    expect(s.players.p0.tiles).toBe(count(s.grid, '1'));
  });

  it('a flying blob is in the snapshot with growing id, starting at the feet', () => {
    const d = driver(['p0', 'p1']);
    const [x, y] = PAINT_SPAWNS[0];
    d.tap('p0', x + 100, y);
    d.tick();
    const b = d.snap().blobs;
    expect(b.length).toBe(1);
    expect(b[0].owner).toBe('p0');
    expect(b[0].kind).toBe('klecks');
    expect(b[0].x).toBeCloseTo(x + F.blobSpeed * DT, 5);
    expect(b[0].left).toBeCloseTo(100 - F.blobSpeed * DT, 5);
    expect(d.snap().players.p0.klecksCdMs).toBeGreaterThan(0);
    expect(d.snap().players.p0.throwAnimMs).toBeGreaterThan(0);
  });

  it('Klecks range is 140 px', () => {
    const d = driver(['p0', 'p1']);
    const [x, y] = PAINT_SPAWNS[0];
    d.tap('p0', x + 300, y);
    let land: { x: number; y: number } | null = null;
    for (let i = 0; i < 30 && !land; i++) {
      d.tick();
      land = d.snap().fx.find((f) => f.kind === 'platsch') ?? null;
    }
    expect(land).not.toBeNull();
    expect(land!.x).toBe(x + F.blobRange);
    expect(land!.y).toBe(y);
    expect(ownerAt(d.snap(), x + F.blobRange, y)).toBe('1');
  });

  it('cooldown 1.5 s', () => {
    const d = driver(['p0', 'p1']);
    const [x, y] = PAINT_SPAWNS[0];
    const throws = new Set<number>();
    const run = (n: number) => {
      for (let i = 0; i < n; i++) {
        d.tick();
        for (const f of d.snap().fx) if (f.kind === 'wurf') throws.add(f.id);
      }
    };
    d.tap('p0', x + 50, y);
    run(20); // 1.0 s
    expect(throws.size).toBe(1);
    d.tap('p0', x + 50, y);
    run(12); // 1.6 s
    expect(throws.size).toBe(1);
    d.tap('p0', x + 50, y);
    run(1);
    expect(throws.size).toBe(2);
  });

  it('Klecks stops at a solid and still paints there', () => {
    const d = driver(['p0', 'p1']);
    d.set('p0', { up: true });
    d.tick(20);
    d.set('p0', {});
    const p = d.snap().players.p0;
    expect(p.y).toBeCloseTo(37, 2);
    d.tap('p0', p.x, p.y - 100);
    let land: { x: number; y: number } | null = null;
    for (let i = 0; i < 20 && !land; i++) {
      d.tick();
      land = d.snap().fx.find((f) => f.kind === 'platsch') ?? null;
    }
    expect(land).not.toBeNull();
    expect(land!.y).toBeGreaterThanOrEqual(32);
    expect(land!.y).toBeLessThan(37);
    const s = d.snap();
    for (let i = 0; i < grid.owner.length; i++) if (!grid.paintable[i]) expect(s.grid[i]).toBe('0');
    for (const i of discTiles(land!.x, land!.y, F.klecksPaintR - 0.5)) expect(s.grid[i]).toBe('1');
    expect(discTiles(land!.x, land!.y, F.klecksPaintR).length).toBeGreaterThan(0);
  });

  it('a Klecks hitting a player: getüncht for 0.5 s at half speed, and it paints at the impact point', () => {
    const d = driver(['p0', 'p1']);
    d.set('p1', { left: true });
    d.tick(80); // 376 -> 120
    d.set('p1', {});
    const v = d.snap().players.p1;
    expect(v.x).toBeCloseTo(120, 5);
    d.tap('p0', v.x, v.y);
    let hit: { x: number; y: number; who: PlayerKey | null } | null = null;
    for (let i = 0; i < 20 && !hit; i++) {
      d.tick();
      hit = d.snap().fx.find((f) => f.kind === 'getuencht') ?? null;
    }
    expect(hit).not.toBeNull();
    expect(hit!.who).toBe('p1');
    const s = d.snap();
    expect(s.players.p1.slowMs).toBe(F.slowMs);
    expect(speedOf(s.players.p1)).toBe(F.walkSpeed * F.slowFactor);
    // Contact once the path comes within blobHitPx of the feet.
    expect(hit!.x).toBeGreaterThanOrEqual(120 - F.blobHitPx - 1);
    expect(hit!.x).toBeLessThanOrEqual(120 - F.blobHitPx + 1);
    // fx coordinates are rounded: leave out tiles right on the rim.
    for (const i of discTiles(hit!.x, hit!.y, F.klecksPaintR - 0.5)) expect(s.grid[i]).toBe('1');
    expect(ownerAt(s, v.x, v.y)).toBe('1');
    expect(s.fx.some((f) => f.kind === 'platsch')).toBe(false);
    expect(s.blobs).toEqual([]);
    // The slow wears off after 0.5 s.
    d.tick(10);
    expect(d.snap().players.p1.slowMs).toBe(0);
  });

  it('own blobs never hit the thrower; absent players are not hit', () => {
    // Own feet as the aim point: the blob lands at the feet without hitting the thrower.
    const d = driver(['p0', 'p1']);
    const [x, y] = PAINT_SPAWNS[0];
    d.tap('p0', x, y);
    d.tick(10);
    let s = d.snap();
    expect(s.fx.some((f) => f.kind === 'getuencht')).toBe(false);
    expect(s.players.p0.slowMs).toBe(0);
    expect(ownerAt(s, x + T, y)).toBe('1');

    // Absent p1: the blob flies through it and lands at the aim point.
    const e = driver(['p0', 'p1'], { absent: ['p1'] });
    e.set('p0', { right: true });
    e.tick(80); // 40 -> 296
    e.set('p0', {});
    const [vx, vy] = PAINT_SPAWNS[1];
    e.tap('p0', vx, vy);
    let land: { x: number; y: number } | null = null;
    let wasHit = false;
    for (let i = 0; i < 20 && !land; i++) {
      e.tick();
      s = e.snap();
      wasHit ||= s.fx.some((f) => f.kind === 'getuencht');
      land = s.fx.find((f) => f.kind === 'platsch') ?? null;
    }
    expect(wasHit).toBe(false);
    expect(land).toEqual(expect.objectContaining({ x: vx, y: vy }));
    expect(e.snap().players.p1.slowMs).toBe(0);
  });

  it('absent players do not paint, move or throw', () => {
    const d = driver(['p0', 'p1', 'p2'], { absent: ['p1', 'p2'] });
    d.tick(40);
    const s = d.snap();
    expect(count(s.grid, '2')).toBe(0);
    expect(count(s.grid, '3')).toBe(0);
    expect(s.players.p1.tiles).toBe(0);
    expect([s.players.p1.x, s.players.p1.y]).toEqual(PAINT_SPAWNS[1]);
    expect(s.players.p0.tiles).toBe(1);
  });

  it('snapshot grid string length equals cols×rows (338)', () => {
    const d = driver(['p0']);
    const s = d.snap();
    expect(s.grid.length).toBe(338);
    expect(s.grid.length).toBe(grid.cols * grid.rows);
    expect(/^[0-4]+$/.test(s.grid)).toBe(true);
  });

  it('result is null until 90 s, non-null at exactly 90000 ms, ranked by tiles with ties sharing a place', () => {
    const d = driver(['p0', 'p1', 'p2'], { absent: ['p2'] });
    // The baseline tick was tick 1 of 1800.
    d.set('p0', { right: true });
    d.tick(20);
    d.set('p0', {});
    d.tick(1800 - 1 - 20 - 1);
    expect(d.g.result()).toBeNull();
    expect(d.snap().timeLeftMs).toBe(50);
    d.tick();
    expect(d.snap().timeLeftMs).toBe(0);
    expect(d.g.result()).toEqual([['p0'], ['p1'], ['p2']]);
    // Ties share a place; nothing moves any more.
    const e = driver(['p0', 'p1', 'p2'], { absent: ['p2'] });
    e.tick(1799);
    expect(e.g.result()).toEqual([['p0', 'p1'], ['p2']]);
    const before = e.snap();
    e.set('p0', { right: true });
    e.tick(5);
    expect(e.snap()).toEqual(before);
  });

  it('finaleAt scales with the duration', () => {
    expect(finaleAt(F.durationMs)).toBe(F.finaleMs);
    expect(finaleAt(18000)).toBe(3000);
  });

  it('speedOf: rollers and getüncht stack', () => {
    const base = { slowMs: 0, rollMs: 0 } as PaintPlayer;
    expect(speedOf(base)).toBe(F.walkSpeed);
    expect(speedOf({ ...base, rollMs: 1 })).toBe(F.walkSpeed * F.rollFactor);
    expect(speedOf({ ...base, rollMs: 1, slowMs: 1 })).toBe(F.walkSpeed * F.rollFactor * F.slowFactor);
  });
});

describe('advanceBlob', () => {
  const blob = (p: Partial<Blob>): Blob => ({ id: 1, x: 100, y: 100, vx: F.blobSpeed, vy: 0, left: 100, owner: 'p0', kind: 'klecks', ...p });

  it('hits a target whose feet come within blobHitPx of the path (floor plane, not a capsule)', () => {
    const b = blob({});
    const ev = advanceBlob(b, 1, arena, [{ key: 'p1', x: 150, y: 100 + F.blobHitPx - 0.5 }]);
    expect(ev?.kind).toBe('player');
    // Feet 12 px below the path: out of reach on the floor (the Schneeball capsule above the feet would reach it).
    const c = blob({});
    const miss = advanceBlob(c, 1 / 10, arena, [{ key: 'p1', x: 110, y: 112 }]);
    expect(miss).toBeNull();
    expect(c.x).toBeCloseTo(100 + F.blobSpeed / 10, 5);
  });

  it('never hits its owner and lands at the end of its flight', () => {
    const b = blob({ left: 10 });
    const ev = advanceBlob(b, 1, arena, [{ key: 'p0', x: 105, y: 100 }]);
    expect(ev).toEqual({ kind: 'land', x: 110, y: 100 });
  });

  it('lands on a wall', () => {
    const b = blob({ x: 100, y: 40, vx: 0, vy: -F.blobSpeed, left: 100 });
    const ev = advanceBlob(b, 1, arena, []);
    expect(ev?.kind).toBe('land');
    expect(ev!.y).toBeGreaterThanOrEqual(32 + F.blobRadius - 0.5);
  });
});

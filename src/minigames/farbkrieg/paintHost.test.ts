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

  it('two players on one neutral tile in the same tick: rand picks the winner, independent of player order; an owned tile stays with its owner', () => {
    // p0 walks 16 px first, so both enter tile column 13 (x 208..224) in the same tick from both sides.
    const contest = (keys: string[], seed: number) => {
      const d = driver(keys, { rand: mulberry32(seed) });
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
      return ownerAt(s, 216, 72);
    };
    const winners = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const w = contest(['p0', 'p1'], seed);
      expect(['1', '2']).toContain(w);
      expect(contest(['p1', 'p0'], seed)).toBe(w);
      winners.add(w);
    }
    expect([...winners].sort()).toEqual(['1', '2']);

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

  it('a throw from feet touching the wall, aimed away, flies normally', () => {
    const d = driver(['p0', 'p1']);
    d.set('p0', { up: true });
    d.tick(20);
    d.set('p0', {});
    const p = d.snap().players.p0;
    expect(p.y).toBeCloseTo(37, 2); // the body touches the wall above
    d.tap('p0', p.x, p.y + 60);
    d.tick();
    const b = d.snap().blobs;
    expect(b.length).toBe(1);
    expect(b[0].y).toBeCloseTo(p.y + F.blobSpeed * DT, 5);
    let land: { x: number; y: number } | null = null;
    for (let i = 0; i < 20 && !land; i++) {
      d.tick();
      land = d.snap().fx.find((f) => f.kind === 'platsch') ?? null;
    }
    expect(land).toEqual(expect.objectContaining({ x: Math.round(p.x), y: Math.round(p.y + 60) }));
    expect(ownerAt(d.snap(), p.x, p.y + 60)).toBe('1');
  });

  it('a Klecks hitting a player: getüncht for 0.5 s at half speed, and it paints at the impact point', () => {
    const d = driver(['p0', 'p1']);
    d.set('p1', { left: true });
    d.tick(80); // 376 -> 120
    d.set('p1', {});
    const v = d.snap().players.p1;
    expect(v.x).toBeCloseTo(120, 5);
    d.tap('p0', v.x, v.y);
    let hit: { x: number; y: number; who: PlayerKey | null; owner: PlayerKey | null } | null = null;
    for (let i = 0; i < 20 && !hit; i++) {
      d.tick();
      hit = d.snap().fx.find((f) => f.kind === 'getuencht') ?? null;
    }
    expect(hit).not.toBeNull();
    expect(hit!.who).toBe('p1');
    expect(hit!.owner).toBe('p0'); // the thrower colours the overlay
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
    // The finale bomb lands in the colour of the present player with the fewest tiles when it starts to
    // fall (p1): its r 48 disc (26 tiles) outweighs p0's 5 tiles, so p1 wins only through the bomb.
    expect(d.g.result()).toEqual([['p1'], ['p0'], ['p2']]);
    // Ties share a place; nothing moves any more.
    const e = driver(['p0', 'p1', 'p2'], { absent: ['p1', 'p2'] });
    e.tick(1799);
    expect(e.g.result()).toEqual([['p0'], ['p1', 'p2']]);
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

/** Row-major indices of the paintable tiles: the order the host picks pickup spots from. */
const paintableList: number[] = [];
for (let i = 0; i < grid.owner.length; i++) if (grid.paintable[i]) paintableList.push(i);
const KINDS = ['farbbombe', 'wischmopp', 'rollschuhe'] as const;
type Kind = (typeof KINDS)[number];
/** Fraction for a scripted rand that makes the host pick tile (col, row). */
const spotFrac = (col: number, row: number) => (paintableList.indexOf(row * COLS + col) + 0.5) / paintableList.length;
const kindFrac = (kind: Kind) => (KINDS.indexOf(kind) + 0.5) / KINDS.length;
const scripted = (...q: number[]) => () => (q.length > 0 ? q.shift()! : 0.5);
type Driver = ReturnType<typeof driver>;
/** Right click at (aimX, aimY). */
const rclick = (d: Driver, k: string, aimX: number, aimY: number) => {
  d.inputs[k] = { ...d.inputs[k], aimX, aimY, secondaryTaps: d.inputs[k].secondaryTaps + 1 };
};
/** p0 walks onto a pickup (tile 5,4: centre 88,72) once it exists and takes it. */
function takeWithP0(d: Driver, kind: Kind) {
  expect(d.snap().pickups).toEqual([expect.objectContaining({ x: 88, y: 72, kind })]);
  d.set('p0', { right: true });
  for (let i = 0; i < 40 && d.snap().pickups.length > 0; i++) d.tick();
  d.set('p0', {});
  expect(d.snap().players.p0.extra).toBe(kind);
}
/** Driver whose p0 holds `kind` (pickup spawned at 8 s, taken at once). */
function armed(kind: Kind) {
  const d = driver(['p0', 'p1'], { rand: scripted(spotFrac(5, 4), kindFrac(kind)) });
  d.tick(159); // 8000 ms in total with the baseline tick
  takeWithP0(d, kind);
  return d;
}

describe('Farbkrieg extras', () => {
  it('pickups spawn every 8 s on paintable tiles, at most 2', () => {
    const d = driver(['p0', 'p1']);
    d.tick(158);
    expect(d.snap().pickups.length).toBe(0);
    d.tick();
    expect(d.snap().pickups.length).toBe(1);
    d.tick(160);
    expect(d.snap().pickups.length).toBe(2);
    d.tick(160);
    const s = d.snap();
    expect(s.pickups.length).toBe(2);
    expect(new Set(s.pickups.map((p) => p.id)).size).toBe(2);
    for (const pk of s.pickups) {
      expect(grid.paintable[Math.floor(pk.y / T) * COLS + Math.floor(pk.x / T)]).toBe(1);
      expect((pk.x - T / 2) % T).toBe(0);
      expect(KINDS).toContain(pk.kind);
    }
  });

  it('a pickup spawns at least 24 px from every present player; absent players are ignored', () => {
    const a = driver(['p0', 'p1'], { rand: () => spotFrac(2, 4) }); // on top of present p0
    a.tick(159);
    expect(a.snap().pickups).toEqual([]);
    const b = driver(['p0', 'p1'], { rand: () => spotFrac(23, 4), absent: ['p1'] }); // on top of absent p1
    b.tick(159);
    expect(b.snap().pickups.length).toBe(1);
    b.tick(20);
    expect(b.snap().pickups.length).toBe(1); // the absent player cannot take it
    expect(b.snap().players.p1.extra).toBeNull();
  });

  it('a player already holding an extra does not take a second one; it stays on the map', () => {
    const d = driver(['p0', 'p1'], {
      rand: scripted(spotFrac(5, 4), kindFrac('farbbombe'), spotFrac(9, 4), kindFrac('wischmopp')),
    });
    d.tick(159);
    takeWithP0(d, 'farbbombe');
    d.tick(160); // second pickup at 16 s, ahead of p0
    expect(d.snap().pickups).toEqual([expect.objectContaining({ x: 152, y: 72, kind: 'wischmopp' })]);
    d.set('p0', { right: true });
    d.tick(60); // p0 walks over it
    const s = d.snap();
    expect(s.players.p0.x).toBeGreaterThan(152 + F.pickupTouchPx);
    expect(s.players.p0.extra).toBe('farbbombe');
    expect(s.pickups.length).toBe(1);
  });

  it('Farbbombe: right click throws it to the mouse and paints r 48; the slot empties', () => {
    const d = armed('farbbombe');
    const p = d.snap().players.p0;
    rclick(d, 'p0', p.x + 60, p.y);
    const seen = new Set<number>();
    const kinds: string[] = [];
    let hit: { x: number; y: number; r: number } | null = null;
    for (let i = 0; i < 20; i++) {
      d.tick();
      for (const f of d.snap().fx) {
        if (seen.has(f.id) || !['bombe_wurf', 'bombe', 'wurf', 'platsch'].includes(f.kind)) continue;
        seen.add(f.id);
        kinds.push(f.kind);
        if (f.kind === 'bombe') hit = f;
      }
    }
    expect(kinds).toEqual(['bombe_wurf', 'bombe']);
    expect(hit).toEqual(expect.objectContaining({ r: F.bombPaintR }));
    expect(hit!.x).toBe(Math.round(p.x + 60));
    const s = d.snap();
    expect(s.players.p0.extra).toBeNull();
    expect(s.players.p0.klecksCdMs).toBe(0);
    const disc = discTiles(hit!.x, hit!.y, F.bombPaintR - 0.5);
    expect(disc.length).toBeGreaterThan(20);
    for (const i of disc) expect(s.grid[i]).toBe('1');
  });

  it('Farbbombe hitting a player getüncht them too', () => {
    const d = armed('farbbombe');
    d.set('p1', { left: true });
    d.tick(80); // 376 -> 120
    d.set('p1', {});
    const v = d.snap().players.p1;
    rclick(d, 'p0', v.x, v.y);
    let hit: { who: PlayerKey | null; r: number } | null = null;
    for (let i = 0; i < 20 && !hit; i++) {
      d.tick();
      hit = d.snap().fx.find((f) => f.kind === 'getuencht') ?? null;
    }
    expect(hit).toEqual(expect.objectContaining({ who: 'p1', owner: 'p0', r: F.bombPaintR }));
    expect(d.snap().players.p1.slowMs).toBe(F.slowMs);
  });

  /** p1 painted its trail from 376 to 120; the pickup spawned and p0 holds a Wischmopp. */
  function moppSetup() {
    const d = driver(['p0', 'p1'], { rand: scripted(spotFrac(5, 4), kindFrac('wischmopp')) });
    d.set('p1', { left: true });
    d.tick(80);
    d.set('p1', {});
    d.tick(79); // 8000 ms in total: the pickup spawns
    takeWithP0(d, 'wischmopp');
    return d;
  }

  it('Wischmopp: for 4 s the feet paint as usual and foreign tiles in the 3×3 around them become neutral', () => {
    const d = moppSetup();
    expect(ownerAt(d.snap(), 200, 72)).toBe('2');
    expect(ownerAt(d.snap(), 72, 72)).toBe('1');
    rclick(d, 'p0', 0, 0);
    d.tick();
    expect(d.snap().players.p0.moppMs).toBe(F.moppMs);
    expect(d.snap().players.p0.extra).toBeNull();
    // One row down (row 5), then along p1's trail on row 4.
    d.set('p0', { down: true });
    d.tick(5);
    expect(d.snap().players.p0.y).toBeCloseTo(88, 5);
    d.set('p0', { right: true });
    d.tick(45);
    const s = d.snap();
    expect(s.players.p0.moppMs).toBeGreaterThan(0);
    expect(Math.floor(s.players.p0.x / T)).toBe(13);
    expect(ownerAt(s, 168, 72)).toBe('0'); // foreign in the 3x3 -> neutral
    expect(ownerAt(s, 200, 72)).toBe('0');
    expect(ownerAt(s, 264, 72)).toBe('2'); // outside the 3x3: untouched
    expect(ownerAt(s, 72, 72)).toBe('1'); // own stays
    expect(ownerAt(s, 168, 104)).toBe('0'); // neutral stays neutral
    expect(ownerAt(s, 104, 88)).toBe('1'); // the feet still paint
    expect(ownerAt(s, 168, 88)).toBe('1');
    expect(ownerAt(s, s.players.p0.x, s.players.p0.y)).toBe('1');
    // After 4 s the mopp is gone: foreign paint next to the feet stays.
    d.set('p0', { up: true });
    d.tick(5);
    d.set('p0', {});
    d.tick(40);
    expect(d.snap().players.p0.moppMs).toBe(0);
    d.set('p0', { right: true });
    d.tick(10);
    const e = d.snap();
    expect(Math.floor(e.players.p0.y / T)).toBe(4);
    expect(ownerAt(e, e.players.p0.x, e.players.p0.y)).toBe('1');
    expect(ownerAt(e, e.players.p0.x + T, e.players.p0.y)).toBe('2');
  });

  it('a painter next to the mopp: painted, then neutralised; the mopp feet tile is never neutralised', () => {
    const d = moppSetup();
    const p1 = d.snap().players.p1;
    const col1 = Math.floor(p1.x / T);
    expect(ownerAt(d.snap(), p1.x, p1.y)).toBe('2');
    rclick(d, 'p0', 0, 0);
    d.set('p0', { right: true });
    for (let i = 0; i < 40 && Math.floor(d.snap().players.p0.x / T) < col1 - 1; i++) d.tick();
    d.set('p0', {});
    d.tick(5);
    const s = d.snap();
    expect(Math.floor(s.players.p0.x / T)).toBe(col1 - 1);
    expect(s.players.p0.moppMs).toBeGreaterThan(0);
    // p1 claims its tile every tick (painters first), then p0's mopp turns it neutral.
    expect(ownerAt(s, p1.x, p1.y)).toBe('0');
    expect(ownerAt(s, s.players.p0.x, s.players.p0.y)).toBe('1');

    // Both on p1's tile: it is p0's feet tile, so p0's mopp never wipes it.
    d.set('p0', { right: true });
    for (let i = 0; i < 40 && Math.floor(d.snap().players.p0.x / T) < col1; i++) d.tick();
    d.set('p0', {});
    d.tick(5);
    const t = d.snap();
    expect(Math.floor(t.players.p0.x / T)).toBe(col1);
    expect(t.players.p0.moppMs).toBeGreaterThan(0);
    // The mopp had wiped it, so both contested a neutral tile once (rand); since then it stays with its claimant owner.
    const kept = ownerAt(t, p1.x, p1.y);
    expect(['1', '2']).toContain(kept);
    d.tick(5);
    expect(ownerAt(d.snap(), p1.x, p1.y)).toBe(kept);
  });

  it('Wischmopp on Rollschuhe: the 3×3 around the feet is painted in the own colour', () => {
    const d = driver(['p0', 'p1'], {
      rand: scripted(spotFrac(5, 4), kindFrac('rollschuhe'), spotFrac(9, 4), kindFrac('wischmopp')),
    });
    d.set('p1', { left: true });
    d.tick(80); // p1's trail on row 4 from 376 to 120
    d.set('p1', {});
    d.tick(79);
    takeWithP0(d, 'rollschuhe');
    d.tick(160); // second pickup at 16 s on p1's trail
    expect(d.snap().pickups).toEqual([expect.objectContaining({ x: 152, y: 72, kind: 'wischmopp' })]);
    const p = d.snap().players.p0;
    rclick(d, 'p0', p.x, p.y); // rollers on
    d.set('p0', { right: true });
    for (let i = 0; i < 40 && d.snap().pickups.length > 0; i++) d.tick();
    expect(d.snap().players.p0.extra).toBe('wischmopp');
    const q = d.snap().players.p0;
    rclick(d, 'p0', q.x, q.y); // mopp on, still walking right
    d.tick(10);
    const s = d.snap();
    expect(s.players.p0.rollMs).toBeGreaterThan(0);
    expect(s.players.p0.moppMs).toBeGreaterThan(0);
    const c0 = Math.floor(s.players.p0.x / T);
    const r0 = Math.floor(s.players.p0.y / T);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const i = (r0 + dr) * COLS + c0 + dc;
        if (grid.paintable[i]) expect(s.grid[i]).toBe('1');
      }
    }
    // p1's trail just behind the feet was painted over, not wiped.
    expect(s.grid[r0 * COLS + c0 - 2]).toBe('1');
  });

  it('Rollschuhe: 4 s at ×1.5 speed, painting the 3×3 tiles around the feet', () => {
    const d = armed('rollschuhe');
    rclick(d, 'p0', 0, 0);
    d.tick();
    expect(d.snap().players.p0.rollMs).toBe(F.rollMs);
    expect(d.snap().players.p0.extra).toBeNull();
    const x0 = d.snap().players.p0.x;
    d.set('p0', { right: true });
    d.tick(20); // 1 s at 96 px/s
    const s = d.snap();
    expect(s.players.p0.x - x0).toBeCloseTo(F.walkSpeed * F.rollFactor, 3);
    const c0 = Math.floor(s.players.p0.x / T);
    const r0 = Math.floor(s.players.p0.y / T);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const i = (r0 + dr) * COLS + c0 + dc;
        if (grid.paintable[i]) expect(s.grid[i]).toBe('1');
      }
    }
    expect(ownerAt(s, s.players.p0.x, s.players.p0.y - T)).toBe('1');
    // The rollers wear off after 4 s; after that only the feet tile is painted.
    d.set('p0', {});
    d.tick(60);
    expect(d.snap().players.p0.rollMs).toBe(0);
    d.set('p0', { right: true });
    d.tick(20);
    const e = d.snap();
    expect(e.players.p0.x - s.players.p0.x).toBeCloseTo(F.walkSpeed, 3);
    expect(ownerAt(e, e.players.p0.x, e.players.p0.y)).toBe('1');
    expect(ownerAt(e, e.players.p0.x, e.players.p0.y - T)).toBe('0');
  });

  it('right click with an empty slot does nothing', () => {
    const d = driver(['p0', 'p1']);
    rclick(d, 'p0', 100, 72);
    d.tick(5);
    const s = d.snap();
    expect(s.players.p0.extra).toBeNull();
    expect(s.players.p0.moppMs).toBe(0);
    expect(s.players.p0.rollMs).toBe(0);
    expect(s.blobs).toEqual([]);
    expect(s.fx).toEqual([]);
  });

  it('no extra use after the end', () => {
    const d = armed('farbbombe');
    while (d.snap().timeLeftMs > 0) d.tick();
    expect(d.g.result()).not.toBeNull();
    const before = d.snap();
    expect(before.players.p0.extra).toBe('farbbombe');
    rclick(d, 'p0', 150, 72);
    d.tick(5);
    expect(d.snap()).toEqual(before);
  });
});

describe('Farbkrieg finale', () => {
  /** Ticks until timeLeftMs first is at most `ms`. */
  const toTimeLeft = (d: Driver, ms = F.finaleMs) => {
    while (d.snap().timeLeftMs > ms) d.tick();
  };

  it('last 15 s: Klecks paints r 48', () => {
    const d = driver(['p0', 'p1']);
    toTimeLeft(d);
    expect(d.snap().timeLeftMs).toBe(F.finaleMs);
    const [x, y] = PAINT_SPAWNS[0];
    d.tap('p0', x + 60, y);
    let land: { x: number; y: number; r: number } | null = null;
    for (let i = 0; i < 20 && !land; i++) {
      d.tick();
      land = d.snap().fx.find((f) => f.kind === 'platsch') ?? null;
    }
    expect(land).toEqual(expect.objectContaining({ r: F.klecksPaintR * F.finaleKlecksFactor }));
    const s = d.snap();
    const disc = discTiles(land!.x, land!.y, F.klecksPaintR * F.finaleKlecksFactor - 0.5);
    expect(disc.length).toBeGreaterThan(20);
    for (const i of disc) expect(s.grid[i]).toBe('1');
  });

  it('the Klecks is still r 24 shortly before the last 15 s', () => {
    const d = driver(['p0', 'p1']);
    toTimeLeft(d, F.finaleMs + 500);
    const [x, y] = PAINT_SPAWNS[0];
    d.tap('p0', x + 20, y);
    d.tick(4);
    expect(d.snap().fx.find((f) => f.kind === 'platsch')).toEqual(expect.objectContaining({ r: F.klecksPaintR }));
  });

  it('finale bomb falls at T−15 s and explodes 2 s later at the centre in the colour of the player with the fewest tiles', () => {
    const d = driver(['p0', 'p1']);
    d.set('p0', { right: true });
    d.tick(20); // p0 has more tiles than p1
    d.set('p0', {});
    toTimeLeft(d);
    expect(d.snap().finale.phase).toBe('wait');
    const kinds: string[] = [];
    const seen = new Set<number>();
    const watch = () => {
      for (const f of d.snap().fx) {
        if (seen.has(f.id) || (f.kind !== 'finale_fall' && f.kind !== 'finale')) continue;
        seen.add(f.id);
        kinds.push(f.kind);
        if (f.kind === 'finale_fall') expect(f).toEqual(expect.objectContaining({ x: 208, y: 104, who: 'p1' }));
        if (f.kind === 'finale') expect(f).toEqual(expect.objectContaining({ x: 208, y: 104, who: 'p1', r: F.finalePaintR }));
      }
    };
    d.tick();
    watch();
    expect(d.snap().finale).toEqual({ phase: 'fall', fallLeftMs: F.finaleFallMs, x: 208, y: 104, who: 'p1' });
    for (let i = 0; i < 39; i++) { d.tick(); watch(); }
    expect(d.snap().finale.phase).toBe('fall');
    for (let i = 0; i < 4; i++) { d.tick(); watch(); }
    const s = d.snap();
    expect(s.finale.phase).toBe('done');
    expect(kinds).toEqual(['finale_fall', 'finale']);
    const disc = discTiles(208, 104, F.finalePaintR);
    expect(disc.length).toBeGreaterThan(20);
    for (const i of disc) expect(s.grid[i]).toBe('2');
  });

  /** p0 walked 20 ticks (5 tiles), p1 stands on 1 tile; ticks up to the first tick of the fall. */
  const toFall = (d: Driver) => {
    d.set('p0', { right: true });
    d.tick(20);
    d.set('p0', {});
    toTimeLeft(d);
    d.tick();
    expect(d.snap().finale.phase).toBe('fall');
  };
  const centreAfterFall = (d: Driver) => {
    for (let i = 0; i < 45 && d.snap().finale.phase !== 'done'; i++) d.tick();
    const s = d.snap();
    expect(s.finale.phase).toBe('done');
    return ownerAt(s, 208, 104);
  };

  it('the finale colour is picked when the fall starts, not at the explosion', () => {
    const d = driver(['p0', 'p1']);
    toFall(d);
    expect(d.snap().finale.who).toBe('p1');
    // During the fall p1 walks 125 px and overtakes p0; the bomb still lands in p1's colour.
    d.set('p1', { left: true });
    d.tick(39);
    expect(d.snap().finale.phase).toBe('fall');
    expect(d.snap().players.p1.tiles).toBeGreaterThan(d.snap().players.p0.tiles);
    expect(centreAfterFall(d)).toBe('2');
    const boom = d.snap().fx.find((f) => f.kind === 'finale');
    expect(boom).toEqual(expect.objectContaining({ who: 'p1', r: F.finalePaintR }));
  });

  it('the picked player left during the fall: re-pick among the present ones, or paint nothing', () => {
    const d = driver(['p0', 'p1']);
    toFall(d);
    expect(d.snap().finale.who).toBe('p1');
    delete d.inputs.p1;
    expect(centreAfterFall(d)).toBe('1');
    expect(d.snap().fx.find((f) => f.kind === 'finale')).toEqual(expect.objectContaining({ who: 'p0' }));

    const e = driver(['p0', 'p1']);
    toFall(e);
    delete e.inputs.p0;
    delete e.inputs.p1;
    expect(centreAfterFall(e)).toBe('0');
    expect(e.snap().fx.find((f) => f.kind === 'finale')).toEqual(expect.objectContaining({ who: null }));
  });

  it('finale: all tied → one of them by rand; an absent last player is skipped', () => {
    const run = (r: number, keys: string[], absent: string[] = []) => {
      const d = driver(keys, { rand: () => r, absent });
      toTimeLeft(d);
      d.tick(45);
      return d.snap();
    };
    const centre = (s: PaintState) => ownerAt(s, 208, 104);
    expect(centre(run(0, ['p0', 'p1']))).toBe('1');
    expect(centre(run(0.99, ['p0', 'p1']))).toBe('2');
    // p2 is absent with 0 tiles (the fewest) but is skipped; p0 and p1 tie with 1 tile.
    const s = run(0.99, ['p0', 'p1', 'p2'], ['p2']);
    expect(centre(s)).toBe('2');
    expect(count(s.grid, '3')).toBe(0);
    // Nobody present: nothing is painted.
    const n = run(0.5, ['p0', 'p1'], ['p0', 'p1']);
    expect(n.finale.phase).toBe('done');
    expect([...n.grid].every((ch) => ch === '0')).toBe(true);
  });

  it('fast mode: with durationMs 18000 the finale starts at 3 s left', () => {
    const d = driver(['p0', 'p1'], { durationMs: 18000 });
    expect(d.snap().durationMs).toBe(18000);
    toTimeLeft(d, 3000);
    expect(d.snap().finale.phase).toBe('wait');
    d.tick();
    expect(d.snap().finale.phase).toBe('fall');
    d.tick(41);
    expect(d.snap().finale.phase).toBe('done');
  });

  it('the finale fires once even if the round ends during the fall', () => {
    const d = driver(['p0', 'p1'], { durationMs: 2500 });
    const kinds: string[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < 80; i++) {
      d.tick();
      for (const f of d.snap().fx) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        kinds.push(f.kind);
      }
    }
    expect(d.g.result()).not.toBeNull();
    // The fall (2 s) outlasts the 0.5 s finale of this short round: the bomb never lands.
    expect(kinds.filter((k) => k === 'finale').length).toBe(0);
    expect(kinds.filter((k) => k === 'finale_fall').length).toBe(1);
  });

  it('with the normal duration the finale fx appears exactly once', () => {
    const d = driver(['p0', 'p1']);
    const kinds: string[] = [];
    const seen = new Set<number>();
    while (d.g.result() === null) {
      d.tick();
      for (const f of d.snap().fx) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        kinds.push(f.kind);
      }
    }
    expect(kinds.filter((k) => k === 'finale').length).toBe(1);
    expect(kinds.filter((k) => k === 'finale_fall').length).toBe(1);
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

describe('Farbkrieg feats', () => {
  const feats = (d: ReturnType<typeof driver>) => d.g.feats?.() ?? {};
  const COOLDOWN_TICKS = Math.ceil(F.klecksCooldownMs / 1000 / DT) + 1;

  it('three getüncht hits give farb_tuencher', () => {
    const d = driver(['p0', 'p1']);
    d.set('p1', { left: true });
    d.tick(80);
    d.set('p1', {});
    const seen = new Set<number>();
    for (let n = 0; n < 3; n++) {
      expect(feats(d).p0 ?? []).not.toContain('farb_tuencher');
      const v = d.snap().players.p1;
      d.tap('p0', v.x, v.y);
      for (let i = 0; i < COOLDOWN_TICKS; i++) {
        d.tick();
        for (const fx of d.snap().fx) if (fx.kind === 'getuencht') seen.add(fx.id);
      }
      expect(seen.size).toBe(n + 1);
    }
    expect(feats(d).p0).toContain('farb_tuencher');
    expect(feats(d).p1).toBeUndefined();
  });

  it('owning at least a third of the paintable tiles at the end gives farb_flaeche', () => {
    // Normal length: in the last 15 s every Klecks paints r 48, so p0 throws around itself from its spawn.
    const d = driver(['p0', 'p1'], { absent: ['p1'] });
    const aims: [number, number][] = [[90, 60], [140, 100], [70, 140], [160, 50], [180, 150], [110, 170], [40, 120], [130, 40]];
    const ticks = Math.round(F.durationMs / 1000 / DT);
    for (let i = 1, a = 0; i < ticks; i++) {
      const finale = d.snap().timeLeftMs <= finaleAt(F.durationMs);
      if (finale && i % COOLDOWN_TICKS === 0) {
        const [x, y] = aims[a++ % aims.length];
        d.tap('p0', x, y);
      }
      d.tick();
      if (d.g.result() === null) expect(feats(d).p0 ?? []).not.toContain('farb_flaeche');
    }
    expect(d.g.result()).not.toBeNull();
    expect(d.snap().players.p0.tiles).toBeGreaterThanOrEqual(Math.ceil(grid.count / 3));
    expect(feats(d).p0).toContain('farb_flaeche');
    expect(feats(d).p1).toBeUndefined();
  });

  it('fewer tiles than a third at the end give no farb_flaeche', () => {
    const d = driver(['p0', 'p1'], { durationMs: 18000, absent: ['p1'] });
    d.tick(Math.round(18 / DT));
    expect(d.g.result()).not.toBeNull();
    expect(d.snap().players.p0.tiles).toBeLessThan(grid.count / 3);
    expect(feats(d).p0 ?? []).not.toContain('farb_flaeche');
  });

  it('three shoves landed give schubser', () => {
    const d = driver(['p0', 'p1']);
    for (let i = 0; i < 3; i++) {
      expect(feats(d).p1 ?? []).not.toContain('schubser');
      d.set('p1', { left: true });
      while (d.snap().players.p1.x - d.snap().players.p0.x > 12) d.tick();
      d.set('p1', {});
      while (d.snap().players.p1.shoveCdMs > 0 || d.snap().players.p0.stun) d.tick();
      d.tick(Math.ceil(CONFIG.shove.immuneMs / 1000 / DT));
      d.inputs.p1 = { ...d.inputs.p1, shoves: d.inputs.p1.shoves + 1 };
      d.tick();
      expect(d.snap().players.p0.stun).toBe(true);
    }
    expect(feats(d).p1).toContain('schubser');
  });
});

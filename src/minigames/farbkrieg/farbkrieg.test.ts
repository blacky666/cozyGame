import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../../config';
import { createBotInputs } from '../../dev/bots';
import { mulberry32 } from '../../flow/rng';
import type { AssetFile } from '../../gfx/assetTypes';
import { neutralInput, type InputState } from '../../net/protocol';
import { defaultProfile } from '../../save/profile';
import { playerKey, type GamePlayer } from '../types';
import { farbkrieg, lerpPaint, paintBotView } from './farbkrieg';
import { PAINT_SPAWNS } from './paintGrid';
import type { Blob, PaintPlayer, PaintState } from './paintHost';
import { ARENA_OFFSET } from './paintView';

// The view imports Phaser, which needs a browser; the definition tests only need its module to load.
vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {} } } }));

const file = JSON.parse(readFileSync('public/assets/arena-farbkrieg.json', 'utf8')) as AssetFile;
const F = CONFIG.farbkrieg;
const COLS = 26;
const ROWS = 13;

const gp = (keys: string[]): GamePlayer[] =>
  keys.map((k) => {
    const slot = Number(k.slice(1)) as 0 | 1 | 2 | 3;
    return { key: playerKey(slot), slot, name: k, look: defaultProfile(k).look, remote: true };
  });

const player = (x: number, y: number, extra: Partial<PaintPlayer> = {}): PaintPlayer => ({
  x, y, vx: 0, vy: 0, dir: 'down', klecksCdMs: 0, slowMs: 0, extra: null, moppMs: 0, rollMs: 0,
  stun: false, swing: false, shoveCdMs: 0, tiles: 0, throwAnimMs: 0, ...extra,
});
const blob = (id: number, x: number, y: number, extra: Partial<Blob> = {}): Blob => ({
  id, x, y, vx: 180, vy: 0, left: 100, owner: 'p0', kind: 'klecks', ...extra,
});
const neutral = () => '0'.repeat(COLS * ROWS);
const state = (players: Record<string, PaintPlayer>, extra: Partial<PaintState> = {}): PaintState => ({
  timeLeftMs: 60000, durationMs: F.durationMs, players, grid: neutral(), blobs: [], pickups: [], fx: [],
  finale: { phase: 'wait', fallLeftMs: 0, x: 208, y: 104 }, ...extra,
});

/** Grid string with the given tiles ([col, row, owner]) set. */
const paint = (tiles: [number, number, number][], base = neutral()): string => {
  const a = [...base];
  for (const [c, r, o] of tiles) a[r * COLS + c] = String(o);
  return a.join('');
};
/** A size x size block of `owner` around (col, row). */
const block = (col: number, row: number, size: number, owner: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  const h = Math.floor(size / 2);
  for (let r = row - h; r <= row + h; r++) for (let c = col - h; c <= col + h; c++) out.push([c, r, owner]);
  return out;
};
const centre = (c: number, r: number) => ({ x: c * 16 + 8, y: r * 16 + 8 });
const allPaintable = () => new Uint8Array(COLS * ROWS).fill(1);

describe('farbkrieg definition', () => {
  it('describes the game', () => {
    expect(farbkrieg).toMatchObject({
      id: 'farbkrieg',
      title: 'Farbkrieg',
      rule: 'Färbe den Boden in deiner Farbe – am Ende zählt die Fläche!',
      controls: 'WASD laufen · Maus zielen · Linksklick Klecks · Rechtsklick Extra · Leertaste schubsen',
      durationMs: F.durationMs,
      sounds: 'farbkrieg',
    });
    expect(farbkrieg.aimOffset).toEqual(ARENA_OFFSET);
    expect(() => farbkrieg.createHost(gp(['p0', 'p1']), mulberry32(1))).toThrow(/assets/);
    const host = farbkrieg.createHost(gp(['p0', 'p1']), mulberry32(1), { assets: { 'arena-farbkrieg': file } });
    const s = host.snapshot();
    expect(s.players.p0).toMatchObject({ x: PAINT_SPAWNS[0][0], y: PAINT_SPAWNS[0][1] });
    expect(s.durationMs).toBe(F.durationMs);
    expect(s.grid).toHaveLength(COLS * ROWS);
    const fast = farbkrieg.createHost(gp(['p0', 'p1']), mulberry32(1), { assets: { 'arena-farbkrieg': file }, durationMs: 18000 });
    expect(fast.snapshot()).toMatchObject({ durationMs: 18000, timeLeftMs: 18000 });
  });

  it('lerpPaint moves players and blobs, takes the grid from b', () => {
    const a = state({ p0: player(0, 0), p1: player(100, 100) }, {
      timeLeftMs: 5000, blobs: [blob(1, 10, 10, { left: 100 }), blob(2, 50, 50)],
    });
    const b = state(
      { p0: player(10, 20, { rollMs: 300, extra: 'wischmopp' }), p1: player(100, 100, { slowMs: 200 }), p2: player(50, 50) },
      {
        timeLeftMs: 4950,
        grid: paint([[5, 5, 1]]),
        blobs: [blob(1, 20, 30, { left: 80 }), blob(3, 70, 70, { kind: 'bombe', owner: 'p1' })],
        pickups: [{ id: 4, x: 8, y: 8, kind: 'rollschuhe' }],
        fx: [{ id: 9, kind: 'platsch', x: 1, y: 2, who: 'p0', r: 24 }],
        finale: { phase: 'fall', fallLeftMs: 1500, x: 208, y: 104 },
      },
    );
    const s = lerpPaint(a, b, 0.5);
    expect(s.players.p0).toMatchObject({ x: 5, y: 10, rollMs: 300, extra: 'wischmopp' });
    expect(s.players.p1).toMatchObject({ x: 100, y: 100, slowMs: 200 });
    expect(s.players.p2).toMatchObject({ x: 50, y: 50 });
    // Blob 1 interpolates (position and remaining flight), blob 3 is new, blob 2 is gone.
    expect(s.blobs).toEqual([blob(1, 15, 20, { left: 90 }), blob(3, 70, 70, { kind: 'bombe', owner: 'p1' })]);
    expect(s.grid).toBe(b.grid);
    expect(s.pickups).toEqual(b.pickups);
    expect(s.fx).toEqual(b.fx);
    expect(s.finale).toEqual(b.finale);
    expect(s.timeLeftMs).toBe(4950);
  });
});

describe('farbkrieg botView', () => {
  it('bot walks to foreign tiles first, throws when ready at a foreign cluster, uses extras at once, idles at the end', () => {
    const me = centre(6, 6);
    const mask = allPaintable();
    // A foreign tile on a non-paintable spot does not count.
    mask[6 * COLS + 5] = 0;

    // Walking: the nearest foreign tile, never the own one; a foreign tile in the edge margin is skipped.
    const far = paint([[6, 6, 1], [5, 6, 2], [0, 6, 3], [20, 9, 2]]);
    const walk = state({ p0: player(me.x, me.y, { klecksCdMs: 1000 }), p1: player(300, 150) }, { grid: far });
    expect(paintBotView(walk, 'p0', mask)).toEqual({ self: me, targets: [centre(20, 9)] });
    // A foreign tile under another player's feet is repainted at once: not a walking target.
    const underFeet = paint([[6, 6, 1], [8, 6, 2], [20, 9, 2]]);
    const blocked = state({ p0: player(me.x, me.y, { klecksCdMs: 1000 }), p1: player(centre(8, 6).x, centre(8, 6).y) }, { grid: underFeet });
    expect(paintBotView(blocked, 'p0', mask)?.targets).toEqual([centre(20, 9)]);

    // No foreign tile left: the nearest neutral tile (first in grid order on a tie).
    const own = paint([[6, 6, 1], [6, 5, 1], [6, 7, 1], [7, 6, 1]]);
    expect(paintBotView({ ...walk, grid: own }, 'p0', mask)?.targets).toEqual([centre(5, 5)]);

    // Ready: aims at the foreign tile in range with the most foreign tiles inside klecksPaintR
    // (the 3x3 centre), not at the nearer lone tile; a bigger cluster out of range does not count.
    const fight = paint([[6, 6, 1], [9, 6, 2], ...block(12, 8, 3, 3), ...block(22, 9, 5, 4)]);
    const ready = state({ p0: player(me.x, me.y), p1: player(300, 150) }, { grid: fight });
    expect(Math.hypot(centre(12, 8).x - me.x, centre(12, 8).y - me.y)).toBeLessThanOrEqual(F.blobRange);
    expect(Math.hypot(centre(22, 9).x - me.x, centre(22, 9).y - me.y) - 32).toBeGreaterThan(F.blobRange);
    expect(paintBotView(ready, 'p0', mask)).toEqual({
      self: me, targets: [centre(9, 6)], aim: centre(12, 8), fire: 'primary',
    });
    // Cooling down: walks on, no aim, no throw.
    ready.players.p0.klecksCdMs = 300;
    expect(paintBotView(ready, 'p0', mask)).toEqual({ self: me, targets: [centre(9, 6)] });
    // Ready, but nothing foreign within blobRange: no throw.
    const outOfRange = state({ p0: player(me.x, me.y) }, { grid: paint([[6, 6, 1], ...block(22, 9, 5, 4)]) });
    expect(paintBotView(outOfRange, 'p0', mask)).toEqual({ self: me, targets: [centre(20, 7)] });

    // An extra is used at once (right click), with the same aim, even while the Klecks cools down.
    ready.players.p0.extra = 'wischmopp';
    expect(paintBotView(ready, 'p0', mask)).toEqual({
      self: me, targets: [centre(9, 6)], aim: centre(12, 8), fire: 'secondary',
    });
    // Without a foreign tile in range it aims at its walking target.
    outOfRange.players.p0.extra = 'farbbombe';
    expect(paintBotView(outOfRange, 'p0', mask)).toEqual({
      self: me, targets: [centre(20, 7)], aim: centre(20, 7), fire: 'secondary',
    });

    // Time is up: idle.
    expect(paintBotView({ ...ready, timeLeftMs: 0 }, 'p0', mask)).toEqual({ self: me, targets: [], idle: true });
    expect(paintBotView(ready, 'p9', mask)).toBeNull();
  });

  it('a 4-bot round paints, throws, ends with a ranking and no NaN', () => {
    const players = gp(['p0', 'p1', 'p2', 'p3']);
    const host = farbkrieg.createHost(players, mulberry32(5), { assets: { 'arena-farbkrieg': file } });
    const brains = players.map((p) => createBotInputs(3 + p.slot * 7919));
    const inputs: Record<string, InputState> = {};
    for (const p of players) inputs[p.key] = neutralInput();
    let throws = 0;
    const seen = new Set<number>();
    for (let t = 0; t < (F.durationMs / 1000) * 30 + 2; t++) {
      const s = host.snapshot();
      for (const f of s.fx) if (!seen.has(f.id) && (f.kind === 'wurf' || f.kind === 'bombe_wurf')) { seen.add(f.id); throws++; }
      players.forEach((p, i) => {
        const view = farbkrieg.botView?.(s, p.key);
        if (view) inputs[p.key] = brains[i](view);
      });
      host.tick(1 / 30, inputs);
    }
    const end = host.snapshot();
    expect(host.result()).not.toBeNull();
    expect(throws).toBeGreaterThan(20);
    for (const p of Object.values(end.players)) {
      expect(p.tiles).toBeGreaterThan(5);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    // Every number anywhere in the state is finite (NaN would serialize to null).
    const bad: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'number') { if (!Number.isFinite(v)) bad.push(path); }
      else if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) walk(c, path + '.' + k);
    };
    walk(end, 'state');
    expect(bad).toEqual([]);
  });

  it('the registered botView uses the paintable tiles of the arena', () => {
    farbkrieg.createHost(gp(['p0', 'p1']), mulberry32(1), { assets: { 'arena-farbkrieg': file } });
    // Row 1 is wall (not paintable): the foreign tile there is ignored, the one on the floor is the target.
    const s = state({ p0: player(208, 56, { klecksCdMs: 1000 }), p1: player(300, 150) }, {
      grid: paint([[13, 3, 1], [13, 1, 2], [13, 8, 2]]),
    });
    expect(farbkrieg.botView?.(s, 'p0')?.targets).toEqual([centre(13, 8)]);
  });
});

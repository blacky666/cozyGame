import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../flow/rng';
import type { AssetFile } from '../../gfx/assetTypes';
import { defaultProfile } from '../../save/profile';
import { playerKey, type GamePlayer } from '../types';
import { kartoffel, lerpSpud, spudBotView } from './kartoffel';
import { SPUD_SPAWNS, type Potato, type SpudPlayer, type SpudState } from './spudHost';

// The view imports Phaser, which needs a browser; the definition tests only need its module to load.
vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {} } } }));

const file = JSON.parse(readFileSync('public/assets/arena-kartoffel.json', 'utf8')) as AssetFile;

const gp = (keys: string[]): GamePlayer[] =>
  keys.map((k) => {
    const slot = Number(k.slice(1)) as 0 | 1 | 2 | 3;
    return { key: playerKey(slot), slot, name: k, look: defaultProfile(k).look, remote: true };
  });

const player = (x: number, y: number, extra: Partial<SpudPlayer> = {}): SpudPlayer => ({
  x, y, vx: 0, vy: 0, dir: 'down', ghost: false, sprintMs: 0, sprintCdMs: 0, slowMs: 0, leader: false,
  stun: false, swing: false, shoveCdMs: 0, losses: 0, ...extra,
});
const potato = (id: number, holder: string, extra: Partial<Potato> = {}): Potato => ({
  id, holder, heat: 0, noBackFrom: null, noBackMs: 0, ...extra,
});
const state = (players: Record<string, SpudPlayer>, potatoes: Potato[], extra: Partial<SpudState> = {}): SpudState => ({
  phase: 'play', players, potatoes, pickups: [], fx: [], out: [], bang: 0, elapsedMs: 0, ...extra,
});

describe('kartoffel definition', () => {
  it('describes the game', () => {
    expect(kartoffel).toMatchObject({
      id: 'kartoffel',
      title: 'Heiße Kartoffel',
      rule: 'Gib die Kartoffel durch Berühren weiter – wer sie beim Knall hält, fliegt raus!',
      controls: 'WASD laufen · Linksklick sprinten · Leertaste schubsen',
      durationMs: null,
      sounds: 'kartoffel',
    });
    expect(kartoffel.aimOffset).toBeUndefined();
    expect(() => kartoffel.createHost(gp(['p0', 'p1']), mulberry32(1))).toThrow(/assets/);
    const host = kartoffel.createHost(gp(['p0', 'p1']), mulberry32(1), { assets: { 'arena-kartoffel': file }, leaders: ['p1'] });
    const s = host.snapshot();
    expect(s.players.p0).toMatchObject({ x: SPUD_SPAWNS[0][0], y: SPUD_SPAWNS[0][1] });
    expect(s.players.p1.leader).toBe(true);
  });

  it('lerpSpud moves players, keeps potatoes from b', () => {
    const a = state({ p0: player(0, 0), p1: player(100, 100) }, [potato(5, 'p0')], { elapsedMs: 100 });
    const b = state(
      { p0: player(10, 20, { sprintMs: 300 }), p1: player(100, 100, { ghost: true }), p2: player(50, 50) },
      [potato(7, 'p1', { heat: 2 })],
      { elapsedMs: 150, phase: 'pause', out: ['p1'], bang: 1, pickups: [{ id: 1, x: 8, y: 8, kind: 'fake' }],
        fx: [{ id: 3, kind: 'knall', x: 1, y: 2, who: 'p1' }] },
    );
    const s = lerpSpud(a, b, 0.5);
    expect(s.players.p0).toMatchObject({ x: 5, y: 10, sprintMs: 300 });
    expect(s.players.p1).toMatchObject({ x: 100, y: 100, ghost: true });
    expect(s.players.p2).toMatchObject({ x: 50, y: 50 });
    expect(s.potatoes).toEqual(b.potatoes);
    expect(s.pickups).toEqual(b.pickups);
    expect(s.fx).toEqual(b.fx);
    expect(s).toMatchObject({ phase: 'pause', out: ['p1'], bang: 1, elapsedMs: 150 });
  });
});

describe('kartoffel botView', () => {
  it('bot holding the potato chases, others flee, ghosts idle', () => {
    const s = state(
      { p0: player(100, 100), p1: player(140, 100), p2: player(300, 150), p3: player(110, 100, { ghost: true }) },
      [potato(9, 'p0')],
    );
    // Holder: towards the nearest living non-holder (the ghost p3 is closer but does not count).
    expect(spudBotView(s, 'p0')).toEqual({ self: { x: 100, y: 100 }, targets: [{ x: 140, y: 100 }] });
    // Non-holder: a point 60 px from the holder, on its own side.
    expect(spudBotView(s, 'p1')).toEqual({ self: { x: 140, y: 100 }, targets: [{ x: 160, y: 100 }] });
    const far = spudBotView(s, 'p2')?.targets[0] ?? { x: 0, y: 0 };
    expect(Math.hypot(far.x - 100, far.y - 100)).toBeCloseTo(60, 5);
    // Clamped into the garden.
    s.players.p1 = player(30, 30);
    s.players.p0 = player(60, 60);
    expect(spudBotView(s, 'p1')?.targets[0]).toEqual({ x: 24, y: 24 });
    // Ghosts idle.
    expect(spudBotView(s, 'p3')).toEqual({ self: { x: 110, y: 100 }, targets: [], idle: true });
    // Pause and done: everybody idles.
    for (const phase of ['pause', 'done'] as const) {
      expect(spudBotView({ ...s, phase }, 'p0')).toMatchObject({ targets: [], idle: true });
    }
    expect(spudBotView(s, 'p9')).toBeNull();
  });
});

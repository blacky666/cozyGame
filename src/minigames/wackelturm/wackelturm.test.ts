import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../../config';
import { createBotInputs } from '../../dev/bots';
import { mulberry32 } from '../../flow/rng';
import type { AssetFile } from '../../gfx/assetTypes';
import { neutralInput, type InputState } from '../../net/protocol';
import { defaultProfile } from '../../save/profile';
import { playerKey, type GamePlayer } from '../types';
import type { TowerPlayer, TowerState } from './towerHost';
import { readLayout } from './towerLayout';
import { ARENA_OFFSET } from './towerView';
import { flatRot, lerpTower, towerBotView, wackelturm } from './wackelturm';

// The view imports Phaser, which needs a browser; the definition tests only need its module to load.
vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {} } } }));

const file = JSON.parse(readFileSync('public/assets/arena-wackelturm.json', 'utf8')) as AssetFile;
const layout = readLayout(file);
const C = CONFIG.wackelturm;
const ASSETS = { 'arena-wackelturm': file };

const gp = (keys: string[]): GamePlayer[] =>
  keys.map((k) => {
    const slot = Number(k.slice(1)) as 0 | 1 | 2 | 3;
    return { key: playerKey(slot), slot, name: k, look: defaultProfile(k).look, remote: true };
  });

const player = (plot: number, extra: Partial<TowerPlayer> = {}): TowerPlayer => ({
  plot, craneX: layout.plots[plot].centre, hangTop: layout.hangTopStart, hang: { kind: 'kurz', rot: 0 }, cdMs: 0,
  heightPx: 0, bestPx: 0, placed: 0, charges: 0, armed: null, windMs: 0, windDir: 1, windImmuneMs: 0, present: true, blocks: [], ...extra,
});
const state = (players: Record<string, TowerPlayer>, extra: Partial<TowerState> = {}): TowerState => ({
  timeLeftMs: 60000, durationMs: C.durationMs, goalPx: C.goalPx, players, fx: [], winner: null, ...extra,
});

describe('wackelturm definition', () => {
  it('describes the game', () => {
    expect(wackelturm).toMatchObject({
      id: 'wackelturm',
      title: 'Wackel-Turm',
      rule: 'Stapelt die Klötze zum höchsten Turm – wer zuerst die Fahne erreicht, gewinnt sofort!',
      controls: 'A/D Kran schieben · W/S oder Mausrad drehen · Leertaste oder Linksklick fallen lassen · Rechtsklick Ärger-Aktion, dann fremden Bauplatz anklicken',
      durationMs: C.durationMs,
      sounds: 'wackelturm',
    });
    expect(wackelturm.aimOffset).toEqual(ARENA_OFFSET);
    expect(() => wackelturm.createHost(gp(['p0', 'p1']), mulberry32(1))).toThrow(/assets/);
    const host = wackelturm.createHost(gp(['p0', 'p1']), mulberry32(1), { assets: ASSETS });
    expect(host.snapshot()).toMatchObject({ durationMs: C.durationMs, goalPx: C.goalPx });
    const fast = wackelturm.createHost(gp(['p0', 'p1']), mulberry32(1), { assets: ASSETS, durationMs: 18000 });
    expect(fast.snapshot()).toMatchObject({ durationMs: 18000, timeLeftMs: 18000 });
  });

  it('lerpTower interpolates block poses by id, takes the angle the short way round (3.1 → −3.1), and adds new blocks from b', () => {
    const a = state({
      p0: player(0, { craneX: 40, hangTop: 66, blocks: [1, 0, 500, 1000, 310, 2, 1, 600, 1000, 0] }),
    });
    const b = state({
      p0: player(0, {
        craneX: 50, hangTop: 56, heightPx: 32, charges: 1, hang: { kind: 'l', rot: 1 },
        blocks: [1, 0, 520, 980, -310, 3, 2, 700, 900, 50],
      }),
      p1: player(1, { craneX: 160 }),
    }, { timeLeftMs: 59950, winner: 'p0' });
    const s = lerpTower(a, b, 0.5);
    expect(s.players.p0).toMatchObject({ craneX: 45, hangTop: 61, heightPx: 32, charges: 1, hang: { kind: 'l', rot: 1 } });
    const bl = s.players.p0.blocks;
    // Block 1 interpolates; block 2 is gone; block 3 is new (as in b).
    expect(bl).toHaveLength(10);
    expect(bl.slice(0, 4)).toEqual([1, 0, 510, 990]);
    expect(Math.abs(bl[4])).toBeCloseTo(Math.PI * 100, 0);
    expect(bl.slice(5)).toEqual([3, 2, 700, 900, 50]);
    expect(s.players.p1).toEqual(b.players.p1);
    expect(s).toMatchObject({ timeLeftMs: 59950, winner: 'p0' });
  });
});

describe('wackelturm botView', () => {
  const P0 = layout.plots[0];

  it('bot turns an l to its long side (rot 3), moves to the target, then drops', () => {
    // placed 4 → offset index 1 → the plot centre.
    const far = state({ p0: player(0, { craneX: P0.centre - 20, placed: 4, hang: { kind: 'l', rot: 0 } }) });
    const self = { x: P0.centre - 20, y: 0 };
    expect(towerBotView(far, 'p0', layout)).toEqual({ self, targets: [{ x: P0.centre, y: 0 }], turn: 'cw' });
    far.players.p0.hang = { kind: 'l', rot: 3 };
    expect(towerBotView(far, 'p0', layout)).toEqual({ self, targets: [{ x: P0.centre, y: 0 }] });
    const near = state({ p0: player(0, { craneX: P0.centre + 2, placed: 4, hang: { kind: 'l', rot: 3 } }) });
    expect(towerBotView(near, 'p0', layout)).toEqual({
      self: { x: P0.centre + 2, y: 0 }, targets: [{ x: P0.centre, y: 0 }], fire: 'primary',
    });
    // The target steps through −16, 0, +16 with the placed count; a flat lang needs no turn.
    const lang = state({ p0: player(0, { craneX: P0.centre - 16, placed: 3, hang: { kind: 'lang', rot: 0 } }) });
    expect(towerBotView(lang, 'p0', layout)).toMatchObject({ targets: [{ x: P0.centre - 16, y: 0 }], fire: 'primary' });
    lang.players.p0.placed = 5;
    expect(towerBotView(lang, 'p0', layout)).toEqual({ self: { x: P0.centre - 16, y: 0 }, targets: [{ x: P0.centre + 16, y: 0 }] });
    // An upright lang turns; no block hanging (cooldown): just moves.
    lang.players.p0.hang = { kind: 'lang', rot: 1 };
    expect(towerBotView(lang, 'p0', layout)).toMatchObject({ turn: 'cw' });
    lang.players.p0.hang = null;
    expect(towerBotView(lang, 'p0', layout)).toEqual({ self: { x: P0.centre - 16, y: 0 }, targets: [{ x: P0.centre + 16, y: 0 }] });
    expect(towerBotView(lang, 'p9', layout)).toBeNull();
  });

  it('bot arms with a charge and then clicks the leader\'s plot', () => {
    const s = state({
      p0: player(0, { charges: 1, heightPx: 100 }),
      p1: player(1, { heightPx: 40 }),
      p2: player(2, { heightPx: 70 }),
    });
    expect(towerBotView(s, 'p1', layout)?.fire).not.toBe('secondary');
    s.players.p1.charges = 1;
    expect(towerBotView(s, 'p1', layout)).toMatchObject({ fire: 'secondary' });
    s.players.p1.armed = 'wind';
    expect(towerBotView(s, 'p1', layout)).toMatchObject({ aim: { x: layout.plots[0].centre }, fire: 'primary' });
    // The leader never is the bot itself: p0 (highest) aims at p2.
    s.players.p0.armed = 'wind';
    expect(towerBotView(s, 'p0', layout)).toMatchObject({ aim: { x: layout.plots[2].centre }, fire: 'primary' });
  });

  it('bot skips wind-immune towers and never arms in the last aergerLockMs', () => {
    const s = state({
      p0: player(0, { heightPx: 100, windImmuneMs: 5000 }),
      p1: player(1, { heightPx: 40, charges: 1, armed: 'wind' }),
      p2: player(2, { heightPx: 70 }),
    });
    // The leader p0 is immune: the bot blows the next highest.
    expect(towerBotView(s, 'p1', layout)).toMatchObject({ aim: { x: layout.plots[2].centre }, fire: 'primary' });
    // Everyone else immune: no target, cancel; unarmed it does not arm.
    s.players.p2.windImmuneMs = 1;
    expect(towerBotView(s, 'p1', layout)).toMatchObject({ fire: 'secondary' });
    expect(towerBotView(s, 'p1', layout)?.aim).toBeUndefined();
    s.players.p1.armed = null;
    expect(towerBotView(s, 'p1', layout)?.fire).not.toBe('secondary');
    // Lock: targets free again, but the round is in its last aergerLockMs.
    s.players.p0.windImmuneMs = 0;
    s.players.p2.windImmuneMs = 0;
    expect(towerBotView(s, 'p1', layout)).toMatchObject({ fire: 'secondary' });
    s.timeLeftMs = C.aergerLockMs;
    expect(towerBotView(s, 'p1', layout)?.fire).not.toBe('secondary');
  });

  it('bot never targets an absent player', () => {
    const s = state({
      p0: player(0, { heightPx: 100, present: false }),
      p1: player(1, { heightPx: 40, charges: 1, armed: 'wind' }),
      p2: player(2, { heightPx: 70 }),
    });
    expect(towerBotView(s, 'p1', layout)).toMatchObject({ aim: { x: layout.plots[2].centre }, fire: 'primary' });
    s.players.p2.present = false;
    expect(towerBotView(s, 'p1', layout)).toMatchObject({ fire: 'secondary' });
    s.players.p1.armed = null;
    expect(towerBotView(s, 'p1', layout)?.fire).not.toBe('secondary');
  });

  it('flatRot picks the widest base, ties to the lowest rotation', () => {
    expect(flatRot('l')).toBe(3);
    expect(flatRot('t')).toBe(2);
    expect(flatRot('lang')).toBe(0);
    expect(flatRot('quader')).toBe(0);
    expect(flatRot('kugel')).toBe(0);
  });

  it('an armed bot with no other player cancels; with charges it never arms', () => {
    const s = state({ p0: player(0, { charges: 1 }) });
    expect(towerBotView(s, 'p0', layout)?.fire).not.toBe('secondary');
    s.players.p0.armed = 'wind';
    expect(towerBotView(s, 'p0', layout)).toMatchObject({ fire: 'secondary' });
    expect(towerBotView(s, 'p0', layout)?.aim).toBeUndefined();
  });

  it('bot idles at the end', () => {
    const s = state({ p0: player(0, { craneX: 30 }) }, { timeLeftMs: 0 });
    expect(towerBotView(s, 'p0', layout)).toEqual({ self: { x: 30, y: 0 }, targets: [], idle: true });
  });

  it('a 4-bot round drops and places blocks, uses charges, and stays finite', () => {
    const players = gp(['p0', 'p1', 'p2', 'p3']);
    const host = wackelturm.createHost(players, mulberry32(5), { assets: ASSETS, durationMs: 40000 });
    const brains = players.map((p) => createBotInputs(3 + p.slot * 7919));
    const inputs: Record<string, InputState> = {};
    for (const p of players) inputs[p.key] = neutralInput();
    const kinds = new Set<string>();
    for (let t = 0; t < 40 * 30 + 2 && !host.result(); t++) {
      const s = host.snapshot();
      for (const f of s.fx) kinds.add(f.kind);
      players.forEach((p, i) => {
        const view = wackelturm.botView?.(s, p.key);
        if (view) inputs[p.key] = brains[i](view);
      });
      host.tick(1 / 30, inputs);
    }
    expect(host.result()).not.toBeNull();
    const end = host.snapshot();
    const placed = Object.values(end.players).reduce((n, p) => n + p.placed, 0);
    expect(placed).toBeGreaterThan(8);
    expect(kinds).toContain('drop');
    expect(kinds.has('wind') || kinds.has('fies')).toBe(true);
    for (const p of Object.values(end.players)) {
      expect(Number.isFinite(p.craneX) && Number.isFinite(p.hangTop)).toBe(true);
      expect(p.blocks.every(Number.isFinite)).toBe(true);
    }
  });
});

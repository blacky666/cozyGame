import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createHost } from '../net/session';
import { createLocalHub } from '../net/transport';
import { defaultProfile } from '../save/profile';
import { addDevBots, createBotInputs } from './bots';
import { mulberry32 } from '../flow/rng';
import type { AssetFile } from '../gfx/assetTypes';
import { neutralInput, type InputState } from '../net/protocol';
import { buildArena } from '../minigames/common/arena';
import { playerKey, type GamePlayer } from '../minigames/types';
import { createSnowballHost } from '../minigames/snowball/snowballHost';
import { snowball } from '../minigames/snowball/snowball';

// The snowball definition imports Phaser views, which need a browser.
vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {} } } }));

describe('addDevBots', () => {
  it('adds named, always-ready bot players', () => {
    const session = createHost(createLocalHub().join(), defaultProfile('Host'));
    const ids = addDevBots(session, 2);
    expect(ids).toHaveLength(2);
    expect(session.roster.list().map((p) => [p.name, p.isBot, p.ready, p.slot])).toEqual([
      ['Host', false, false, 0],
      ['Bot Krümel', true, true, 1],
      ['Bot Mo', true, true, 2],
    ]);
  });
});

describe('createBotInputs', () => {
  it('mostly walks toward the nearest target', () => {
    const bot = createBotInputs(7);
    let right = 0;
    let left = 0;
    for (let i = 0; i < 200; i++) {
      const s = bot({ self: { x: 100, y: 100 }, targets: [{ x: 300, y: 100 }, { x: 10, y: 100 }] });
      if (s.right) right++;
      if (s.left) left++;
    }
    // nearest target is at x=10 (90 px) vs x=300 (200 px)
    expect(left).toBeGreaterThan(140);
    expect(right).toBeLessThan(60);
  });

  it('is deterministic per seed and wanders without targets', () => {
    const run = (seed: number) => {
      const bot = createBotInputs(seed);
      return Array.from({ length: 50 }, () => JSON.stringify(bot({ self: { x: 50, y: 50 }, targets: [] })));
    };
    expect(run(1)).toEqual(run(1));
    const moves = run(1).filter((s) => /true/.test(s));
    expect(moves.length).toBeGreaterThan(0);
  });
});

describe('snowball bots', () => {
  it('a bot aims at the given target and throws now and then', () => {
    const bot = createBotInputs(3);
    let last = neutralInput();
    for (let i = 0; i < 200; i++) {
      last = bot({ self: { x: 100, y: 100 }, targets: [{ x: 160, y: 100 }], aim: { x: 220, y: 90 } });
    }
    expect(last.primaryTaps).toBeGreaterThan(0);
    expect(last.aimX).toBe(220);
    expect(last.aimY).toBe(90);
    expect(last.primaryCharge).toBeGreaterThanOrEqual(0);
    expect(last.primaryCharge).toBeLessThanOrEqual(1);
  });

  it('keeps the tap counter steady across aim -> idle -> aim', () => {
    const bot = createBotInputs(9);
    const aimView = { self: { x: 1, y: 1 }, targets: [], aim: { x: 5, y: 5 } };
    let prev = 0;
    for (let i = 0; i < 100; i++) prev = bot(aimView).primaryTaps;
    for (let i = 0; i < 50; i++) {
      const t = bot({ self: { x: 1, y: 1 }, targets: [], idle: true }).primaryTaps;
      expect(t).toBe(prev);
    }
    expect(prev).toBeGreaterThan(0);
    // First aim tick after idle must not jump by more than one regular throw.
    expect(bot(aimView).primaryTaps - prev).toBeLessThanOrEqual(1);
  });

  it('a bot without balls stands still', () => {
    const bot = createBotInputs(5);
    for (let i = 0; i < 100; i++) {
      const s = bot({ self: { x: 100, y: 100 }, targets: [], idle: true });
      expect(s.up || s.down || s.left || s.right).toBe(false);
      expect(s.primaryTaps).toBe(0);
    }
  });

  it('a 4-bot round of schneeball finishes with scores > 0 and no NaN anywhere in the state', () => {
    const file = JSON.parse(readFileSync('public/assets/arena-schneeball.json', 'utf8')) as AssetFile;
    const arena = buildArena(file, 'schneeball.map');
    const players: GamePlayer[] = ([0, 1, 2, 3] as const).map((slot) => ({
      key: playerKey(slot), slot, name: 'b' + slot, look: {} as GamePlayer['look'], remote: false,
    }));
    const host = createSnowballHost(players, mulberry32(11), arena, 120_000);
    const brains = players.map((p) => createBotInputs(1 + p.slot * 7919));
    const inputs: Record<string, InputState> = {};
    for (const p of players) inputs[p.key] = neutralInput();
    const bad: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'number') { if (!Number.isFinite(v)) bad.push(path); }
      else if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) walk(c, path + '.' + k);
    };
    for (let t = 0; t < 120 * 30 + 2; t++) {
      if (t % 300 === 0) walk(host.snapshot(), 't' + t);
      const state = host.snapshot();
      players.forEach((p, i) => {
        const view = snowball.botView?.(state, p.key);
        if (view) inputs[p.key] = brains[i](view);
      });
      host.tick(1 / 30, inputs);
    }
    const end = host.snapshot();
    expect(host.result()).not.toBeNull();
    expect(Object.values(end.players).some((p) => p.score > 0)).toBe(true);
    for (const p of Object.values(end.players)) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    for (const b of end.balls) expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
    // Every number anywhere in the state is finite (NaN would serialize to null).
    walk(end, 'state');
    expect(bad).toEqual([]);
  });
});

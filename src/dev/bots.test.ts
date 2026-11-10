import { describe, expect, it } from 'vitest';
import { createHost } from '../net/session';
import { createLocalHub } from '../net/transport';
import { defaultProfile } from '../save/profile';
import { addDevBots, createBotInputs } from './bots';

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

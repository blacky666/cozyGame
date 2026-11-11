import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../flow/rng';
import { neutralInput, type InputState } from '../../net/protocol';
import { defaultProfile } from '../../save/profile';
import { playerKey, type GamePlayer } from '../types';
import { createSandboxHost as createByPlayers, lerpSandbox, moveStep } from './sandboxHost';

/** Test helper: GamePlayers for the given keys ('p0'..'p3'). */
const gp = (keys: string[]): GamePlayer[] =>
  keys.map((k) => {
    const slot = Number(k.slice(1)) as 0 | 1 | 2 | 3;
    return { key: playerKey(slot), slot, name: k, look: defaultProfile(k).look, remote: true };
  });
const createSandboxHost = (keys: string[], rand: () => number, ms: number) => createByPlayers(gp(keys), rand, ms);

const DT = 1 / 30;
const idle = neutralInput();
const press = (p: Partial<InputState>): InputState => ({ ...neutralInput(), ...p });

/** Steer p0 toward the first coin until the score changes (max 20 s). */
function collectOne(g: ReturnType<typeof createSandboxHost>): void {
  for (let i = 0; i < 600; i++) {
    const s = g.snapshot();
    if (s.players.p0.score > 0) return;
    const me = s.players.p0;
    const c = s.coins[0];
    const inp = c
      ? press({ right: c.x > me.x + 1, left: c.x < me.x - 1, down: c.y > me.y + 1, up: c.y < me.y - 1 })
      : idle;
    g.tick(DT, { p0: inp, p1: idle });
  }
}

describe('sandbox host (muenzjagd)', () => {
  it('createHost places players by slot', () => {
    const g = createByPlayers(gp(['p0', 'p3']), mulberry32(1), 30000);
    expect(g.snapshot().players.p3).toMatchObject({ x: 306, y: 190 });
    expect(g.snapshot().players.p0).toMatchObject({ x: 120, y: 100 });
  });

  it('moves a player 60 px to the right in 1 s', () => {
    const g = createSandboxHost(['p0', 'p1'], mulberry32(1), 30000);
    const x0 = g.snapshot().players.p0.x;
    for (let i = 0; i < 30; i++) g.tick(DT, { p0: press({ right: true }), p1: idle });
    const p = g.snapshot().players.p0;
    expect(Math.abs(p.x - x0 - 60)).toBeLessThanOrEqual(1);
    expect(p.dir).toBe('side');
    expect(p.moving).toBe(true);
  });

  it('keeps players inside the view bounds and normalizes diagonals', () => {
    const g = createSandboxHost(['p0', 'p1'], mulberry32(2), 30000);
    for (let i = 0; i < 300; i++) g.tick(DT, { p0: press({ left: true, up: true }), p1: idle });
    const p = g.snapshot().players.p0;
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    const d = moveStep({ x: 100, y: 100 }, press({ right: true, down: true }), 1);
    expect(Math.hypot(d.x - 100, d.y - 100)).toBeCloseTo(60, 5);
  });

  it('spawns coins every 1.5 s and increments the score on pickup', () => {
    const g = createSandboxHost(['p0', 'p1'], mulberry32(3), 30000);
    g.tick(1.4, { p0: idle, p1: idle });
    expect(g.snapshot().coins).toHaveLength(0);
    g.tick(0.2, { p0: idle, p1: idle });
    expect(g.snapshot().coins).toHaveLength(1);
    collectOne(g);
    expect(g.snapshot().players.p0.score).toBe(1);
    expect(g.snapshot().players.p1.score).toBe(0);
  });

  it('result() is null before durationMs and returns tie groups after', () => {
    const g = createSandboxHost(['p0', 'p1', 'p2'], mulberry32(4), 30000);
    collectOne(g);
    while (g.snapshot().timeLeftMs > 100) {
      expect(g.result()).toBeNull();
      g.tick(DT, { p0: idle, p1: idle }); // p2 sends nothing: treated as neutral
    }
    expect(g.result()).toBeNull();
    for (let i = 0; i < 10; i++) g.tick(DT, {});
    expect(g.snapshot().timeLeftMs).toBe(0);
    // Idle players may get coins spawned onto them, so derive the expected groups from the scores.
    const sc = g.snapshot().players;
    const res = g.result()!;
    expect(res.flat().sort()).toEqual(['p0', 'p1', 'p2']);
    for (const grp of res) expect(new Set(grp.map((k) => sc[k].score)).size).toBe(1);
    for (let i = 1; i < res.length; i++) expect(sc[res[i - 1][0]].score).toBeGreaterThan(sc[res[i][0]].score);
    expect(sc.p0.score).toBeGreaterThan(0);
  });

  it('groups equal scores into one tie group', () => {
    const g = createSandboxHost(['p0', 'p1'], mulberry32(9), 1000); // too short for any coin
    g.tick(1, {});
    expect(g.result()).toEqual([['p0', 'p1']]);
  });

  it('interpolates positions and takes discrete fields from the newer state', () => {
    const g = createSandboxHost(['p0', 'p1'], mulberry32(5), 30000);
    const a = g.snapshot();
    g.tick(0.5, { p0: press({ right: true }), p1: idle });
    const b = g.snapshot();
    const m = lerpSandbox(a, b, 0.5);
    expect(m.players.p0.x).toBeCloseTo((a.players.p0.x + b.players.p0.x) / 2, 5);
    expect(m.players.p0.dir).toBe('side');
  });

  it('a shove pushes the victim, stuns them, and makes them drop a coin', () => {
    const g = createSandboxHost(['p0', 'p1'], mulberry32(3), 60000);
    // p1 collects a coin first.
    for (let i = 0; i < 900 && g.snapshot().players.p1.score === 0; i++) {
      const s = g.snapshot();
      const me = s.players.p1;
      const c = s.coins[0];
      const inp = c
        ? press({ right: c.x > me.x + 1, left: c.x < me.x - 1, down: c.y > me.y + 1, up: c.y < me.y - 1 })
        : idle;
      g.tick(DT, { p0: idle, p1: inp });
    }
    expect(g.snapshot().players.p1.score).toBe(1);
    // p0 walks up to p1 and ends up facing them from the left.
    for (let i = 0; i < 900; i++) {
      const s = g.snapshot();
      const a = s.players.p0;
      const b = s.players.p1;
      if (Math.abs(b.y - a.y) <= 1 && b.x - a.x <= 12 && b.x - a.x > 0) break;
      const tx = b.x - 10;
      g.tick(DT, { p0: press({ right: a.x < tx - 1, left: a.x > tx + 1, down: a.y < b.y - 1, up: a.y > b.y + 1 }), p1: idle });
    }
    g.tick(DT, { p0: press({ right: true }), p1: idle }); // face right
    const before = g.snapshot();
    const coinsBefore = before.coins.length;
    g.tick(DT, { p0: press({ shoves: 1 }), p1: idle });
    const hit = g.snapshot();
    expect(hit.players.p1.stun).toBe(true);
    expect(hit.players.p1.score).toBe(0);
    expect(hit.players.p0.swing).toBe(true);
    expect(hit.players.p0.shoveCdMs).toBeGreaterThan(0);
    expect(hit.coins.length).toBeGreaterThanOrEqual(coinsBefore + 1);
    // While stunned, input is ignored; afterwards p1 has slid about pushPx to the right.
    for (let i = 0; i < 15; i++) g.tick(DT, { p0: idle, p1: press({ left: true }) });
    const after = g.snapshot().players.p1;
    expect(after.stun).toBe(false);
    expect(after.x - before.players.p1.x).toBeGreaterThan(20);
  });
});

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../config';
import { neutralInput, type InputState } from '../../net/protocol';
import { newShoveSlot, resolveShoves, stepShove, type Facing, type ShoveSlot } from './shove';

const DT = 1 / 30;
const shoves = (n: number): InputState => ({ ...neutralInput(), shoves: n });
const body = (x: number, y: number, dir: Facing = 'side') => ({ x, y, dir });

function setup(b: Record<string, ReturnType<typeof body>>) {
  const keys = Object.keys(b);
  const slots: Record<string, ShoveSlot> = {};
  for (const k of keys) slots[k] = newShoveSlot();
  return { keys, slots, bodies: b };
}

/** Run timers until the stun is over; returns the total slide. */
function slideAll(s: ShoveSlot): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < 60; i++) {
    const d = stepShove(s, DT);
    x += d.dx;
    y += d.dy;
  }
  return { x, y };
}

describe('shove', () => {
  it('pushes the player in front pushPx away from the shover and stuns them', () => {
    const { keys, slots, bodies } = setup({ p0: body(100, 100, 'side'), p1: body(112, 100) });
    const hits = resolveShoves(keys, bodies, slots, { p0: shoves(1), p1: neutralInput() });
    expect(hits).toEqual([{ from: 'p0', to: 'p1' }]);
    expect(slots.p1.stunMs).toBe(CONFIG.shove.stunMs);
    const slide = slideAll(slots.p1);
    expect(slide.x).toBeCloseTo(CONFIG.shove.pushPx, 5);
    expect(slide.y).toBeCloseTo(0, 5);
    expect(slots.p1.stunMs).toBe(0);
  });

  it('misses players behind, out of reach, or immune, but still spends the cooldown', () => {
    const behind = setup({ p0: body(100, 100, 'side'), p1: body(88, 100) });
    expect(resolveShoves(behind.keys, behind.bodies, behind.slots, { p0: shoves(1) })).toEqual([]);
    expect(behind.slots.p0.cooldownMs).toBe(CONFIG.shove.cooldownMs);

    const far = setup({ p0: body(100, 100, 'side'), p1: body(100 + CONFIG.shove.reachPx + 1, 100) });
    expect(resolveShoves(far.keys, far.bodies, far.slots, { p0: shoves(1) })).toEqual([]);

    const imm = setup({ p0: body(100, 100, 'side'), p1: body(110, 100) });
    imm.slots.p1.immuneMs = 100;
    expect(resolveShoves(imm.keys, imm.bodies, imm.slots, { p0: shoves(1) })).toEqual([]);
  });

  it('allows one shove per cooldown and only counts new presses', () => {
    const { keys, slots, bodies } = setup({ p0: body(100, 100, 'down'), p1: body(100, 110) });
    expect(resolveShoves(keys, bodies, slots, { p0: shoves(1) })).toHaveLength(1);
    // Same counter again (heartbeat): nothing new.
    slots.p1.immuneMs = 0;
    expect(resolveShoves(keys, bodies, slots, { p0: shoves(1) })).toEqual([]);
    // New press during the cooldown: swallowed, not queued.
    expect(resolveShoves(keys, bodies, slots, { p0: shoves(2) })).toEqual([]);
    for (let t = 0; t < CONFIG.shove.cooldownMs; t += 1000 * DT) stepShove(slots.p0, DT);
    slots.p1.immuneMs = 0;
    expect(resolveShoves(keys, bodies, slots, { p0: shoves(2) })).toEqual([]);
    expect(resolveShoves(keys, bodies, slots, { p0: shoves(3) })).toHaveLength(1);
  });

  it('re-bases on a counter drop instead of shoving', () => {
    const { keys, slots, bodies } = setup({ p0: body(100, 100, 'side'), p1: body(110, 100) });
    resolveShoves(keys, bodies, slots, { p0: shoves(5) });
    // A counter drop (reconnect) re-bases without firing, then new presses count again.
    expect(resolveShoves(keys, bodies, slots, { p0: neutralInput() })).toEqual([]);
    expect(slots.p0.cooldownMs).toBe(CONFIG.shove.cooldownMs); // untouched by the drop
    slots.p0.cooldownMs = 0;
    // The new press fires again (the target is still immune, so it only spends the cooldown).
    resolveShoves(keys, bodies, slots, { p0: shoves(1) });
    expect(slots.p0.cooldownMs).toBe(CONFIG.shove.cooldownMs);
  });

  it('a stunned player cannot shove; of two mutual shoves the first key wins', () => {
    const { keys, slots, bodies } = setup({ p0: body(100, 100, 'side'), p1: body(110, 100, 'left') });
    const hits = resolveShoves(keys, bodies, slots, { p0: shoves(1), p1: shoves(1) });
    expect(hits).toEqual([{ from: 'p0', to: 'p1' }]);
  });

  it('picks the nearest of several targets and handles overlapping bodies', () => {
    const { keys, slots, bodies } = setup({ p0: body(100, 100, 'up'), p1: body(100, 85), p2: body(100, 92), p3: body(101, 100) });
    expect(resolveShoves(keys, bodies, slots, { p0: shoves(1) })).toEqual([{ from: 'p0', to: 'p3' }]);
    expect(slots.p3.dirX).toBeCloseTo(1);
  });
});

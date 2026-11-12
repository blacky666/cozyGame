import { describe, expect, it } from 'vitest';
import { INPUT_COUNTERS, keepCounters, MSG_TYPES, neutralInput, parseInputState, type InputState } from './protocol';

describe('MSG_TYPES', () => {
  it("contains 'profile' and every type name is <= 12 bytes", () => {
    expect(MSG_TYPES).toContain('profile');
    for (const t of MSG_TYPES) expect(new TextEncoder().encode(t).length).toBeLessThanOrEqual(12);
  });
});

describe('parseInputState', () => {
  it('keeps a valid shove counter', () => {
    expect(parseInputState({ ...neutralInput(), shoves: 7 })?.shoves).toBe(7);
  });

  it('rejects a missing, negative, fractional or huge shove counter', () => {
    const { shoves: _omit, ...noShoves } = neutralInput();
    expect(parseInputState(noShoves)).toBeNull();
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 2, NaN, '3']) {
      expect(parseInputState({ ...neutralInput(), shoves: bad })).toBeNull();
    }
  });
  it('keeps primaryTaps and ignores a legacy primaryCharge field', () => {
    const s = parseInputState({ ...neutralInput(), primaryTaps: 4, primaryCharge: 0.5 });
    expect(s).toMatchObject({ primaryTaps: 4 });
    expect(s).not.toHaveProperty('primaryCharge');
    expect(parseInputState({ ...neutralInput(), primaryTaps: -1 })).toBeNull();
  });

  it('secondaryTaps is validated like primaryTaps', () => {
    expect(parseInputState({ ...neutralInput(), secondaryTaps: 3 })?.secondaryTaps).toBe(3);
    const { secondaryTaps: _omit, ...none } = neutralInput();
    expect(parseInputState(none)).toBeNull();
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 2, NaN, '3']) {
      expect(parseInputState({ ...neutralInput(), secondaryTaps: bad })).toBeNull();
    }
  });
});

describe('rotation and drop counters', () => {
  it('parseInputState rejects a missing or negative turnsCw/turnsCcw/drops and keeps valid ones', () => {
    for (const k of ['turnsCw', 'turnsCcw', 'drops'] as const) {
      expect(parseInputState({ ...neutralInput(), [k]: 4 })?.[k]).toBe(4);
      const { [k]: _omit, ...none } = neutralInput();
      expect(parseInputState(none)).toBeNull();
      for (const bad of [-1, 1.5, NaN, '3']) expect(parseInputState({ ...neutralInput(), [k]: bad })).toBeNull();
    }
  });

  it('keepCounters releases buttons and keeps all seven counters (and the emote slot)', () => {
    const s: InputState = { ...neutralInput(), up: true, primary: true, aimX: 5, emote: 3 };
    INPUT_COUNTERS.forEach((k, i) => (s[k] = i + 1));
    const kept = keepCounters(s);
    expect(INPUT_COUNTERS).toHaveLength(7);
    expect(kept).toEqual({
      ...neutralInput(), shoves: 1, primaryTaps: 2, secondaryTaps: 3, turnsCw: 4, turnsCcw: 5, drops: 6, emotes: 7, emote: 3,
    });
  });

  it('parseInputState rejects a missing or negative emotes counter and keeps a valid one', () => {
    const { emotes: _drop, ...noEmotes } = neutralInput();
    expect(parseInputState(noEmotes)).toBeNull();
    expect(parseInputState({ ...neutralInput(), emotes: -1 })).toBeNull();
    expect(parseInputState({ ...neutralInput(), emotes: 2.5 })).toBeNull();
    expect(parseInputState({ ...neutralInput(), emotes: 4, emote: 2 })).toMatchObject({ emotes: 4, emote: 2 });
  });
});

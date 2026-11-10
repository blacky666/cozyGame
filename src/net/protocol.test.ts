import { describe, expect, it } from 'vitest';
import { neutralInput, parseInputState } from './protocol';

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
});

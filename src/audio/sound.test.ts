import { describe, expect, it } from 'vitest';
import { pickVariant } from './sound';

describe('pickVariant', () => {
  it('one file: always 0', () => {
    expect(pickVariant(1, 0, () => 0.9)).toBe(0);
  });

  it('never repeats the last variant and reaches every other one', () => {
    for (let last = 0; last < 3; last++) {
      const got = new Set([0, 0.4, 0.99].map((r) => pickVariant(3, last, () => r)));
      expect(got.has(last)).toBe(false);
      expect(got.size).toBe(2);
    }
  });

  it('first play (no last) stays in range', () => {
    for (const r of [0, 0.5, 0.999]) expect(pickVariant(3, -1, () => r)).toBeLessThan(3);
  });
});

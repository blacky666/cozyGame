import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng';

describe('mulberry32', () => {
  it('is deterministic and within [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { devFlags, FAST_SCALE } from './devFlags';

describe('devFlags', () => {
  it('is off without dev=1', () => {
    expect(devFlags('?bots=2&fast=1')).toEqual({ bots: 0, timeScale: 1 });
    expect(devFlags('?dev=chars&bots=2')).toEqual({ bots: 0, timeScale: 1 });
  });

  it('parses bots (clamped to 0..3) and fast mode', () => {
    expect(devFlags('?dev=1&bots=2')).toEqual({ bots: 2, timeScale: 1 });
    expect(devFlags('?dev=1&bots=9')).toEqual({ bots: 3, timeScale: 1 });
    expect(devFlags('?dev=1&bots=x')).toEqual({ bots: 0, timeScale: 1 });
    expect(devFlags('?dev=1&fast=1')).toEqual({ bots: 0, timeScale: FAST_SCALE });
  });
});

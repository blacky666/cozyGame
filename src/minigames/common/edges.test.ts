import { describe, expect, it } from 'vitest';
import { Edge } from './edges';

describe('Edge', () => {
  it('returns new presses once', () => {
    const e = new Edge();
    expect(e.take(0)).toBe(0);
    expect(e.take(2)).toBe(2);
    expect(e.take(2)).toBe(0);
    expect(e.take(3)).toBe(1);
  });
  it('first observation is a baseline, not a press', () => {
    const e = new Edge();
    expect(e.take(5)).toBe(0);
    expect(e.take(6)).toBe(1);
  });
  it('counter drop resets the edge without firing', () => {
    const e = new Edge();
    e.take(7);
    expect(e.take(0)).toBe(0);
    expect(e.take(1)).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { integerZoom } from './zoom';

describe('integerZoom', () => {
  it('uses the largest whole factor that fits the 426x240 view', () => {
    expect(integerZoom(1280, 720)).toBe(3);
    expect(integerZoom(1920, 1080)).toBe(4);
    expect(integerZoom(1277, 720)).toBe(2);
    expect(integerZoom(1280, 719)).toBe(2);
  });

  it('never goes below 1', () => {
    expect(integerZoom(300, 200)).toBe(1);
    expect(integerZoom(0, 0)).toBe(1);
  });
});

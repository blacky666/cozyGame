import { describe, expect, it } from 'vitest';
import { ChargeButton } from './pointer';

describe('ChargeButton', () => {
  it('counts a completed click and its charge', () => {
    const b = new ChargeButton();
    b.press(1000);
    expect(b.held).toBe(true);
    expect(b.chargeAt(1500)).toBeCloseTo(0.5);
    b.release(1600);
    expect(b.taps).toBe(1);
    expect(b.charge).toBeCloseTo(0.6);
    expect(b.held).toBe(false);
    b.press(2000);
    b.release(4000);
    expect(b.taps).toBe(2);
    expect(b.charge).toBe(1);
  });
  it('blur cancels a held charge without counting a tap', () => {
    const b = new ChargeButton();
    b.press(0);
    b.cancel();
    b.release(500);
    expect(b.taps).toBe(0);
    expect(b.held).toBe(false);
  });
  it('ignores a release without press (click started outside the canvas)', () => {
    const b = new ChargeButton();
    b.release(100);
    expect(b.taps).toBe(0);
  });
});

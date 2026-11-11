import { describe, expect, it } from 'vitest';
import { neutralInput } from '../net/protocol';
import { ChargeButton, PointerInput } from './pointer';

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

describe('PointerInput', () => {
  it('adds button and aim to the keyboard state', () => {
    const p = new PointerInput();
    p.button.press(0);
    p.button.release(500);
    p.button.press(600);
    p.aimX = 12;
    p.aimY = 34;
    const s = p.merge({ ...neutralInput(), up: true, shoves: 2 });
    expect(s).toMatchObject({ up: true, shoves: 2, primary: true, primaryTaps: 1, primaryCharge: 0.5, aimX: 12, aimY: 34 });
  });
});

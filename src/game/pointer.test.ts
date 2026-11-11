import { describe, expect, it } from 'vitest';
import { neutralInput } from '../net/protocol';
import { PointerInput } from './pointer';

describe('PointerInput', () => {
  it('left/right pointerdown increase primaryTaps/secondaryTaps only while counting is on', () => {
    const p = new PointerInput();
    p.press(0);
    p.press(2);
    expect(p.merge(neutralInput())).toMatchObject({ primaryTaps: 0, secondaryTaps: 0 });
    p.release(0);
    p.release(2);
    p.setCounting(true);
    p.press(0);
    p.release(0);
    p.press(0);
    p.press(2);
    expect(p.merge(neutralInput())).toMatchObject({ primaryTaps: 2, secondaryTaps: 1, primary: true, secondary: true });
    p.setCounting(false);
    p.release(0);
    p.release(2);
    p.press(2);
    expect(p.merge(neutralInput())).toMatchObject({ primaryTaps: 2, secondaryTaps: 1 });
  });

  it('every pointerdown counts (even after a missed pointerup); other buttons are ignored', () => {
    const p = new PointerInput();
    p.setCounting(true);
    p.press(0);
    p.press(0); // no release in between (pointerup happened outside the window)
    p.press(1); // middle button
    expect(p.merge(neutralInput())).toMatchObject({ primaryTaps: 2, secondaryTaps: 0 });
  });

  it('blur releases the held flags but keeps the counters', () => {
    const p = new PointerInput();
    p.setCounting(true);
    p.press(0);
    p.press(2);
    p.releaseAll();
    expect(p.merge(neutralInput())).toMatchObject({ primary: false, secondary: false, primaryTaps: 1, secondaryTaps: 1 });
  });

  it('adds buttons and aim to the keyboard state', () => {
    const p = new PointerInput();
    p.setCounting(true);
    p.press(0);
    p.aimX = 12;
    p.aimY = 34;
    const s = p.merge({ ...neutralInput(), up: true, shoves: 2 });
    expect(s).toMatchObject({ up: true, shoves: 2, primary: true, primaryTaps: 1, secondaryTaps: 0, aimX: 12, aimY: 34 });
  });
});

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
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

describe('PointerInput wheel', () => {
  it('wheel: one turn per gesture (a turn needs wheelGapMs of quiet before); merge adds the keyboard turns', () => {
    const gap = CONFIG.input.wheelGapMs;
    const p = new PointerInput();
    p.wheel(100, 0); // not counting: ignored
    expect(p.merge(neutralInput())).toMatchObject({ turnsCw: 0, turnsCcw: 0 });
    p.setCounting(true);
    p.wheel(100, 1000);
    p.wheel(100, 1000 + gap - 10); // same gesture
    expect(p.merge(neutralInput())).toMatchObject({ turnsCw: 1, turnsCcw: 0 });
    p.wheel(-100, 1000 + 2 * gap); // quiet long enough: a new turn
    expect(p.merge({ ...neutralInput(), turnsCw: 5, turnsCcw: 2 })).toMatchObject({ turnsCw: 6, turnsCcw: 3 });
  });

  it('wheel: a trackpad swipe (many small deltas, then momentum) is a single turn', () => {
    const p = new PointerInput();
    p.setCounting(true);
    for (let i = 0; i < 60; i++) p.wheel(i < 40 ? 4 : 1, 5000 + i * 12);
    expect(p.merge(neutralInput())).toMatchObject({ turnsCw: 1, turnsCcw: 0 });
  });

  it('wheel: a tiny jitter below the step does not turn', () => {
    const p = new PointerInput();
    p.setCounting(true);
    p.wheel(1, 0);
    expect(p.merge(neutralInput())).toMatchObject({ turnsCw: 0, turnsCcw: 0 });
  });
});

import { describe, expect, it } from 'vitest';
import { neutralInput, type InputState } from '../../net/protocol';
import { DIRS8, dirOf, InputMask, maskButtons } from './prankInput';

const inp = (o: Partial<InputState> = {}): InputState => ({ ...neutralInput(), ...o });

describe('dirOf', () => {
  it('maps the movement keys to one of eight directions', () => {
    expect(dirOf(inp({ right: true }))).toBe(0);
    expect(dirOf(inp({ down: true, right: true }))).toBe(1);
    expect(dirOf(inp({ up: true, left: true }))).toBe(5);
    expect(dirOf(inp({ left: true, right: true }))).toBeNull();
    expect(dirOf(inp())).toBeNull();
  });

  it('DIRS8 and dirOf agree for every direction', () => {
    DIRS8.forEach(([dx, dy], d) => {
      expect(dirOf(inp({ right: dx > 0, left: dx < 0, down: dy > 0, up: dy < 0 }))).toBe(d);
    });
  });
});

describe('maskButtons', () => {
  it('reverse swaps up/down and left/right', () => {
    expect(maskButtons(inp({ up: true }), [{ kind: 'reverse' }])).toMatchObject({ up: false, down: true });
    expect(maskButtons(inp({ left: true }), [{ kind: 'reverse' }])).toMatchObject({ left: false, right: true });
  });

  it('slip forces the movement of its direction and releases the action buttons', () => {
    const out = maskButtons(inp({ up: true, left: true, primary: true, special: true }), [{ kind: 'slip', dir: 1 }]);
    expect(out).toMatchObject({ up: false, left: false, right: true, down: true, primary: false, secondary: false, special: false });
  });

  it('frozen and stumble release every button; counters, aim and emote stay', () => {
    const live = inp({ up: true, primary: true, secondary: true, special: true, shoves: 4, emote: 2, emotes: 3, aimX: 7, aimY: 9 });
    for (const kind of ['frozen', 'stumble'] as const) {
      const out = maskButtons(live, [{ kind }]);
      expect(out).toEqual(inp({ shoves: 4, emote: 2, emotes: 3, aimX: 7, aimY: 9 }));
    }
    // Frozen wins over slip and reverse.
    expect(maskButtons(live, [{ kind: 'slip', dir: 0 }, { kind: 'frozen' }]).right).toBe(false);
  });

  it('ink and confetti change nothing and the input is not mutated', () => {
    const live = inp({ up: true, primary: true });
    expect(maskButtons(live, [{ kind: 'ink' }, { kind: 'confetti' }])).toEqual(live);
    maskButtons(live, [{ kind: 'reverse' }]);
    expect(live.up).toBe(true);
  });
});

describe('InputMask', () => {
  it('first call passes the live counters through (no presses)', () => {
    const m = new InputMask();
    const live = inp({ shoves: 5, primaryTaps: 2, drops: 9 });
    expect(m.apply('p0', live, [{ kind: 'frozen' }])).toMatchObject({ shoves: 5, primaryTaps: 2, drops: 9 });
  });

  it('drops game presses while blocked and routes only later ones', () => {
    const m = new InputMask();
    m.apply('p0', inp({ shoves: 5 }), []);
    expect(m.apply('p0', inp({ shoves: 7 }), [{ kind: 'frozen' }]).shoves).toBe(5);
    expect(m.apply('p0', inp({ shoves: 7, primaryTaps: 1 }), [{ kind: 'slip', dir: 0 }]).shoves).toBe(5);
    const after = m.apply('p0', inp({ shoves: 8 }), []);
    expect(after.shoves).toBe(6);
  });

  it('reverse moves turnsCw presses to turnsCcw and back', () => {
    const m = new InputMask();
    m.apply('p0', inp(), []);
    expect(m.apply('p0', inp({ turnsCw: 2 }), [{ kind: 'reverse' }])).toMatchObject({ turnsCw: 0, turnsCcw: 2 });
    expect(m.apply('p0', inp({ turnsCw: 2, turnsCcw: 1 }), [{ kind: 'reverse' }])).toMatchObject({ turnsCw: 1, turnsCcw: 2 });
  });

  it('a dropping live counter re-bases without output', () => {
    const m = new InputMask();
    m.apply('p0', inp({ drops: 8 }), []);
    expect(m.apply('p0', inp({ drops: 0 }), []).drops).toBe(8);
    expect(m.apply('p0', inp({ drops: 1 }), []).drops).toBe(9);
  });

  it('emotes, pranks, the emote slot and aim pass raw while frozen', () => {
    const m = new InputMask();
    m.apply('p0', inp({ emotes: 1, pranks: 1 }), []);
    const out = m.apply('p0', inp({ emotes: 3, pranks: 2, emote: 4, aimX: 11, aimY: 12, up: true }), [{ kind: 'frozen' }]);
    expect(out).toMatchObject({ emotes: 3, pranks: 2, emote: 4, aimX: 11, aimY: 12, up: false });
  });

  it('keeps the players apart', () => {
    const m = new InputMask();
    m.apply('p0', inp({ shoves: 1 }), []);
    m.apply('p1', inp({ shoves: 10 }), []);
    expect(m.apply('p0', inp({ shoves: 2 }), []).shoves).toBe(2);
    expect(m.apply('p1', inp({ shoves: 11 }), [{ kind: 'stumble' }]).shoves).toBe(10);
  });
});

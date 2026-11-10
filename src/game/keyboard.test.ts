import { describe, expect, it } from 'vitest';
import { inputFromKeys } from './keyboard';

describe('inputFromKeys', () => {
  it('maps WASD to directions', () => {
    const s = inputFromKeys(new Set(['KeyW', 'KeyD']));
    expect([s.up, s.down, s.left, s.right]).toEqual([true, false, false, true]);
    expect(inputFromKeys(new Set(['KeyA', 'KeyS']))).toMatchObject({ left: true, down: true, up: false, right: false });
    expect(inputFromKeys(new Set())).toMatchObject({ up: false, down: false, left: false, right: false });
  });
});

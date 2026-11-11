import { describe, expect, it, vi } from 'vitest';
import { immuneLabel, metres } from './towerHud';

vi.mock('phaser', () => ({ default: {} }));

describe('tower HUD labels', () => {
  it('metres: 16 px are one metre, German decimal comma', () => {
    expect(metres(0)).toBe('0,0 m');
    expect(metres(155)).toBe('9,7 m');
  });

  it('immuneLabel: whole seconds left, rounded up', () => {
    expect(immuneLabel(8000)).toBe('windfest 8 s');
    expect(immuneLabel(7001)).toBe('windfest 8 s');
    expect(immuneLabel(1)).toBe('windfest 1 s');
  });
});

import { describe, expect, it } from 'vitest';
import { neutralInput } from '../net/protocol';
import { sameInput, shouldSend } from './inputSend';

const idle = neutralInput();
const right = { ...idle, right: true };

describe('shouldSend', () => {
  it('re-sends a held direction every activeSendMs', () => {
    expect(shouldSend(right, right, 20, 0, 0)).toBe(false);
    expect(shouldSend(right, right, 33, 0, 0)).toBe(true);
  });
  it('holds back idle unchanged input until the heartbeat', () => {
    expect(shouldSend(idle, idle, 150, 0, 0)).toBe(false);
    expect(shouldSend(idle, idle, 200, 0, 0)).toBe(true);
  });
  it('throttles aim-only changes', () => {
    const aimed = { ...idle, aimX: 5 };
    expect(shouldSend(idle, aimed, 40, 0, 0)).toBe(false);
    expect(shouldSend(idle, aimed, 50, 0, 0)).toBe(true);
  });
  it('sends a button change at once', () => {
    expect(shouldSend(idle, { ...idle, primary: true }, 1, 0, 0)).toBe(true);
    expect(shouldSend(idle, { ...idle, primaryTaps: 1 }, 1, 0, 0)).toBe(true);
    expect(shouldSend(idle, { ...idle, secondaryTaps: 1 }, 1, 0, 0)).toBe(true);
  });
  it('sameInput differs on drops', () => {
    expect(sameInput(idle, { ...idle, drops: 1 })).toBe(false);
    expect(sameInput(idle, { ...idle, turnsCw: 1 })).toBe(false);
    expect(sameInput(idle, { ...idle })).toBe(true);
  });
});

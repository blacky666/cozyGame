import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../config';
import { guessSprint, NO_SPRINT_GUESS, type SprintGuess } from './spudMove';

const K = CONFIG.kartoffel;
const own = (o: Partial<{ sprintMs: number; sprintCdMs: number; stun: boolean; ghost: boolean }> = {}) => ({
  sprintMs: 0, sprintCdMs: 0, stun: false, ghost: false, ...o,
});

describe('guessSprint (client sprint prediction)', () => {
  it('starts on a rising tap counter when ready, then runs out after sprintMs', () => {
    let g: SprintGuess = guessSprint(NO_SPRINT_GUESS, 3, own(), 16);
    expect(g.leftMs).toBe(0); // the first call only sets the baseline
    g = guessSprint(g, 4, own(), 16);
    expect(g.leftMs).toBe(K.sprintMs);
    g = guessSprint(g, 4, own(), 100);
    expect(g.leftMs).toBe(K.sprintMs - 100);
    g = guessSprint(g, 4, own(), K.sprintMs);
    expect(g.leftMs).toBe(0);
  });

  it('does not start while on cooldown, stunned or a ghost', () => {
    for (const o of [own({ sprintCdMs: 500 }), own({ stun: true }), own({ ghost: true })]) {
      const g = guessSprint(guessSprint(NO_SPRINT_GUESS, 0, o, 16), 1, o, 16);
      expect(g.leftMs).toBe(0);
    }
  });

  it('a dropping counter (new connection) only re-bases', () => {
    const g = guessSprint(guessSprint(NO_SPRINT_GUESS, 5, own(), 16), 0, own(), 16);
    expect(g).toEqual({ taps: 0, leftMs: 0 });
  });

  it('ends once the server state confirms the sprint', () => {
    const g = guessSprint(guessSprint(NO_SPRINT_GUESS, 0, own(), 16), 1, own(), 16);
    expect(g.leftMs).toBe(K.sprintMs);
    expect(guessSprint(g, 1, own({ sprintMs: 350, sprintCdMs: 2950 }), 16).leftMs).toBe(0);
  });
});

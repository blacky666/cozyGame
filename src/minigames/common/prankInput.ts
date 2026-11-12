import type { InputState } from '../../net/protocol';
import type { PlayerKey } from '../types';

/** Timed prank effects on a player; the first four change his input, ink/confetti only his screen. */
export type FxKind = 'frozen' | 'stumble' | 'slip' | 'reverse' | 'ink' | 'confetti';
/** One of eight directions, index into DIRS8. */
export type Dir8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** DIRS8[d] = [dx, dy] in screen axes: 0 right, 1 down-right, 2 down, 3 down-left, 4 left, 5 up-left, 6 up, 7 up-right. */
export const DIRS8: readonly (readonly [-1 | 0 | 1, -1 | 0 | 1])[] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
/** An input-relevant effect: kind plus (for slip) the forced direction. */
export type InputFx = { kind: FxKind; dir?: Dir8 };

/** Direction of the held movement keys; null when nothing is held or opposite keys cancel out. */
export function dirOf(input: InputState): Dir8 | null {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx === 0 && dy === 0) return null;
  return DIRS8.findIndex(([x, y]) => x === dx && y === dy) as Dir8;
}

const has = (fx: readonly InputFx[], kind: FxKind) => fx.some((f) => f.kind === kind);
const blocked = (fx: readonly InputFx[]) => has(fx, 'frozen') || has(fx, 'stumble');

/**
 * The held buttons as a prank victim may use them (a copy; counters, aim and emote untouched).
 * Priority: frozen / stumble → nothing held; slip → only the slip direction; reverse → up↔down,
 * left↔right; ink / confetti change nothing.
 */
export function maskButtons(input: InputState, fx: readonly InputFx[]): InputState {
  const out = { ...input };
  if (fx.length === 0) return out;
  if (blocked(fx)) {
    out.up = out.down = out.left = out.right = false;
    out.primary = out.secondary = out.special = false;
    return out;
  }
  const slip = fx.find((f) => f.kind === 'slip');
  if (slip) {
    const [dx, dy] = DIRS8[slip.dir ?? 0];
    out.right = dx > 0;
    out.left = dx < 0;
    out.down = dy > 0;
    out.up = dy < 0;
    out.primary = out.secondary = out.special = false;
    return out;
  }
  if (has(fx, 'reverse')) {
    out.up = input.down;
    out.down = input.up;
    out.left = input.right;
    out.right = input.left;
  }
  return out;
}

/** Counters of the games' own presses; emotes and pranks are never masked. */
const GAME_COUNTERS = ['shoves', 'primaryTaps', 'secondaryTaps', 'turnsCw', 'turnsCcw', 'drops'] as const;
type GameCounter = (typeof GAME_COUNTERS)[number];
type Counts = Record<GameCounter, number>;

/**
 * Host-side input mask: buttons via maskButtons, and the game counters re-routed per press, so a
 * press made while frozen, stumbling or slipping is lost for good (it does not fire when the effect
 * ends) and reversed turns turn the other way. Output counters never decrease.
 */
export class InputMask {
  private readonly players = new Map<PlayerKey, { live: Counts; out: Counts }>();

  apply(key: PlayerKey, live: InputState, fx: readonly InputFx[]): InputState {
    const res = maskButtons(live, fx);
    let st = this.players.get(key);
    if (!st) {
      // First sight: output = live; the games' edges take it as their baseline.
      const now = {} as Counts;
      for (const k of GAME_COUNTERS) now[k] = live[k];
      st = { live: { ...now }, out: { ...now } };
      this.players.set(key, st);
      return res;
    }
    const drop = blocked(fx) || has(fx, 'slip');
    const reverse = !drop && has(fx, 'reverse');
    for (const k of GAME_COUNTERS) {
      const d = live[k] - st.live[k];
      st.live[k] = live[k];
      // d < 0: the client reconnected and counts from 0 again; re-based above without output.
      if (d <= 0 || drop) continue;
      const to: GameCounter = reverse && k === 'turnsCw' ? 'turnsCcw' : reverse && k === 'turnsCcw' ? 'turnsCw' : k;
      st.out[to] += d;
    }
    for (const k of GAME_COUNTERS) res[k] = st.out[k];
    return res;
  }
}

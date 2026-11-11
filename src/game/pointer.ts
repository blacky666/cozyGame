import { CONFIG } from '../config';
import type { InputState } from '../net/protocol';

/**
 * Pointer state shared by the minigame scene (writes it from Phaser pointer events) and whoever
 * builds the input: the client's send loop and the host's localInput. Presses are counted on
 * pointerdown (a counter, so a quick click between two host ticks is never lost), and only while
 * counting is on (a running minigame), like the keyboard's shove counter.
 */
export class PointerInput {
  /** Aim in the running game's simulation coordinates. */
  aimX = 0;
  aimY = 0;
  private primaryTaps = 0;
  private secondaryTaps = 0;
  private primaryHeld = false;
  private secondaryHeld = false;
  private wheelCw = 0;
  private wheelCcw = 0;
  private lastWheelAt = -Infinity;
  private counting = false;

  setCounting(on: boolean): void {
    this.counting = on;
  }

  /**
   * `button` as in PointerEvent.button: 0 = left (normal throw), 2 = right (strong throw).
   * Every pointerdown counts, even without a release before (pointerup outside the window).
   */
  press(button: number): void {
    if (button === 0) {
      this.primaryHeld = true;
      if (this.counting) this.primaryTaps++;
    } else if (button === 2) {
      this.secondaryHeld = true;
      if (this.counting) this.secondaryTaps++;
    }
  }

  /** Mouse wheel: down/forward (deltaY > 0) turns clockwise, up counter-clockwise; at most one turn per wheelGapMs. */
  wheel(deltaY: number, nowMs: number): void {
    if (!this.counting || deltaY === 0) return;
    if (nowMs - this.lastWheelAt < CONFIG.input.wheelGapMs) return;
    this.lastWheelAt = nowMs;
    if (deltaY > 0) this.wheelCw++;
    else this.wheelCcw++;
  }

  release(button: number): void {
    if (button === 0) this.primaryHeld = false;
    else if (button === 2) this.secondaryHeld = false;
  }

  /** Focus lost: buttons count as released; the counters stay. */
  releaseAll(): void {
    this.primaryHeld = false;
    this.secondaryHeld = false;
  }

  /** Keyboard state plus the pointer fields. */
  merge(s: InputState): InputState {
    return {
      ...s,
      primary: this.primaryHeld,
      secondary: this.secondaryHeld,
      primaryTaps: this.primaryTaps,
      secondaryTaps: this.secondaryTaps,
      turnsCw: s.turnsCw + this.wheelCw,
      turnsCcw: s.turnsCcw + this.wheelCcw,
      aimX: this.aimX,
      aimY: this.aimY,
    };
  }
}

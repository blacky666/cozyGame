import { CONFIG } from '../config';
import type { InputState } from '../net/protocol';

/** Left mouse button with hold-to-charge: counts completed clicks, never loses a quick one. */
export class ChargeButton {
  private pressedAt: number | null = null;
  private _taps = 0;
  private _charge = 0;

  get held(): boolean {
    return this.pressedAt !== null;
  }
  get taps(): number {
    return this._taps;
  }
  /** Charge (0..1) of the last completed click. */
  get charge(): number {
    return this._charge;
  }

  press(nowMs: number): void {
    this.pressedAt ??= nowMs;
  }

  /** A release without a press (click started outside the canvas) is ignored. */
  release(nowMs: number): void {
    if (this.pressedAt === null) return;
    this._charge = this.chargeAt(nowMs);
    this.pressedAt = null;
    this._taps++;
  }

  /** Focus lost: drop a held charge without counting a tap. */
  cancel(): void {
    this.pressedAt = null;
  }

  /** Current charge while held (for the charge indicator), else 0. */
  chargeAt(nowMs: number): number {
    if (this.pressedAt === null) return 0;
    return Math.min(1, Math.max(0, (nowMs - this.pressedAt) / CONFIG.snowball.maxChargeMs));
  }
}

/**
 * Pointer state shared by the minigame scene (writes it from Phaser pointer events) and whoever
 * builds the input: the client's send loop and the host's localInput.
 */
export class PointerInput {
  readonly button = new ChargeButton();
  /** Aim in the running game's simulation coordinates. */
  aimX = 0;
  aimY = 0;

  /** Keyboard state plus the pointer fields. */
  merge(s: InputState): InputState {
    const b = this.button;
    return { ...s, primary: b.held, primaryTaps: b.taps, primaryCharge: b.charge, aimX: this.aimX, aimY: this.aimY };
  }
}

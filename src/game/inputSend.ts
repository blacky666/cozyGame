import { CONFIG } from '../config';
import type { InputState } from '../net/protocol';

/** Equal in everything but the aim (aim-only changes are throttled separately). */
export const sameInput = (a: InputState, b: InputState): boolean =>
  a.up === b.up && a.down === b.down && a.left === b.left && a.right === b.right &&
  a.primary === b.primary && a.secondary === b.secondary && a.special === b.special && a.emote === b.emote && a.shoves === b.shoves &&
  a.primaryTaps === b.primaryTaps && a.primaryCharge === b.primaryCharge;

/** Whether the client should send its input this frame. Times are in ms. */
export function shouldSend(prev: InputState, next: InputState, nowMs: number, lastSentAt: number, lastAimAt: number): boolean {
  if (!sameInput(prev, next)) return true;
  const held = next.up || next.down || next.left || next.right || next.primary;
  if (held && nowMs - lastSentAt >= CONFIG.net.activeSendMs) return true;
  if ((prev.aimX !== next.aimX || prev.aimY !== next.aimY) && nowMs - lastAimAt >= CONFIG.net.aimSendMs) return true;
  return nowMs - lastSentAt >= CONFIG.net.inputHeartbeatMs;
}

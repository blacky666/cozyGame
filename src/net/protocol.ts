import type { Look } from '../save/profile';
import type { PlayerInfo } from './roster';

export type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  primary: boolean;
  secondary: boolean;
  special: boolean;
  emote: 0 | 1 | 2 | 3 | 4;
  aimX: number;
  aimY: number;
  /**
   * How often the shove key was pressed so far (only ever grows). A counter instead of a held
   * flag, so a quick tap between two host ticks is never lost.
   */
  shoves: number;
};

export function neutralInput(): InputState {
  return {
    up: false, down: false, left: false, right: false,
    primary: false, secondary: false, special: false,
    emote: 0, aimX: 0, aimY: 0, shoves: 0,
  };
}

export type RejectReason = 'full' | 'running' | 'version' | 'name' | 'kicked';

// Type names must stay <= 12 bytes (Trystero action-name limit).
export type Msg =
  | { type: 'hello'; data: { name: string; version: string; look: Look } }
  | { type: 'welcome'; data: { id: string; slot: number; roster: PlayerInfo[]; phase: string } }
  | { type: 'reject'; data: { reason: RejectReason } }
  | { type: 'roster'; data: PlayerInfo[] }
  | { type: 'ready'; data: { ready: boolean } }
  | { type: 'settings'; data: { rounds: number } }
  | { type: 'start'; data: unknown }
  | { type: 'input'; data: { seq: number; state: InputState } }
  | { type: 'snap'; data: { tick: number; phase: string; payload: unknown } }
  | { type: 'phase'; data: { phase: string; data?: unknown } }
  | { type: 'bye'; data: unknown };

export type MsgType = Msg['type'];
export const MSG_TYPES: readonly MsgType[] = [
  'hello', 'welcome', 'reject', 'roster', 'ready', 'settings', 'start', 'input', 'snap', 'phase', 'bye',
];
export type MsgData<T extends MsgType> = Extract<Msg, { type: T }>['data'];

const BUTTONS = ['up', 'down', 'left', 'right', 'primary', 'secondary', 'special'] as const;

/** Validate untrusted input from the wire; returns a clean copy or null. */
export function parseInputState(x: unknown): InputState | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  if (!BUTTONS.every((k) => typeof r[k] === 'boolean')) return null;
  const { emote, aimX, aimY } = r;
  if (emote !== 0 && emote !== 1 && emote !== 2 && emote !== 3 && emote !== 4) return null;
  if (typeof aimX !== 'number' || !Number.isFinite(aimX)) return null;
  if (typeof aimY !== 'number' || !Number.isFinite(aimY)) return null;
  const { shoves } = r;
  if (typeof shoves !== 'number' || !Number.isSafeInteger(shoves) || shoves < 0) return null;
  const s = neutralInput();
  for (const k of BUTTONS) s[k] = r[k] as boolean;
  s.emote = emote;
  s.aimX = aimX;
  s.aimY = aimY;
  s.shoves = shoves;
  return s;
}

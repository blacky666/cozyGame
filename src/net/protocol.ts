import type { Look } from '../save/profile';

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
};

export function neutralInput(): InputState {
  return {
    up: false, down: false, left: false, right: false,
    primary: false, secondary: false, special: false,
    emote: 0, aimX: 0, aimY: 0,
  };
}

export type RejectReason = 'full' | 'running' | 'version' | 'name';

// Type names must stay <= 12 bytes (Trystero action-name limit).
export type Msg =
  | { type: 'hello'; data: { name: string; version: string; look: Look } }
  | { type: 'welcome'; data: { slot: number; roster: unknown; phase: unknown } }
  | { type: 'reject'; data: { reason: RejectReason } }
  | { type: 'roster'; data: unknown }
  | { type: 'ready'; data: { ready: boolean } }
  | { type: 'settings'; data: { rounds: number } }
  | { type: 'start'; data: unknown }
  | { type: 'input'; data: { seq: number; state: InputState } }
  | { type: 'snap'; data: { tick: number; phase: string; payload: unknown } }
  | { type: 'phase'; data: unknown }
  | { type: 'bye'; data: unknown };

export type MsgType = Msg['type'];
export const MSG_TYPES: readonly MsgType[] = [
  'hello', 'welcome', 'reject', 'roster', 'ready', 'settings', 'start', 'input', 'snap', 'phase', 'bye',
];
export type MsgData<T extends MsgType> = Extract<Msg, { type: T }>['data'];

import type Phaser from 'phaser';
import type { InputState } from '../net/protocol';
import type { PlayerInfo } from '../net/roster';

export type { InputState };

/** Stable per-player key (survives reconnects, unlike PlayerInfo.id). */
export type PlayerKey = string;
export const playerKey = (slot: 0 | 1 | 2 | 3): PlayerKey => 'p' + slot;

/** Minimal world view handed to dev bots (see src/dev/bots.ts). */
export type BotView = { self: { x: number; y: number }; targets: { x: number; y: number }[] };

export interface MiniGameHost<S> {
  /** dt in seconds. */
  tick(dt: number, inputs: Record<PlayerKey, InputState>): void;
  snapshot(): S;
  /** Non-null = finished; tie groups of player keys, best first. */
  result(): PlayerKey[][] | null;
}

export interface MiniGameView<S> {
  render(s: S, selfKey: PlayerKey): void;
  /** Client-side prediction of the own player (called every frame before render; clients only). */
  predict?(input: InputState, dt: number, latest: S | null, ackSeq: number, sentSeq: number): void;
  destroy(): void;
}

export interface MiniGame<S = unknown> {
  id: string;
  title: string;
  rule: string;
  controls: string;
  durationMs: number | null;
  /** `opts.durationMs` overrides the game's duration (dev-only fast mode). */
  createHost(players: PlayerInfo[], rand: () => number, opts?: { durationMs?: number }): MiniGameHost<S>;
  createView(scene: Phaser.Scene, players: PlayerInfo[], selfKey: PlayerKey): MiniGameView<S>;
  /** Snapshot interpolation for clients (default: step to the newer state). */
  lerp?(a: S, b: S, t: number): S;
  /** World view for dev bots; null when the bot has nothing to do. */
  botView?(s: S, key: PlayerKey): BotView | null;
}

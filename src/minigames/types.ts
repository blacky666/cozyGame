import type Phaser from 'phaser';
import type { InputState } from '../net/protocol';
import type { PlayerInfo } from '../net/roster';

export type { InputState };

/** Stable per-player key (survives reconnects, unlike PlayerInfo.id). */
export type PlayerKey = string;
export const playerKey = (slot: 0 | 1 | 2 | 3): PlayerKey => 'p' + slot;

export interface MiniGameHost<S> {
  tick(dt: number, inputs: Record<PlayerKey, InputState>): void;
  snapshot(): S;
  /** Non-null = finished; tie groups of player keys, best first. */
  result(): PlayerKey[][] | null;
}

export interface MiniGameView<S> {
  render(s: S, selfKey: PlayerKey): void;
  destroy(): void;
}

export interface MiniGame<S = unknown> {
  id: string;
  title: string;
  rule: string;
  controls: string;
  durationMs: number | null;
  createHost(players: PlayerInfo[], rand: () => number): MiniGameHost<S>;
  createView(scene: Phaser.Scene, players: PlayerInfo[], selfKey: PlayerKey): MiniGameView<S>;
}

import type Phaser from 'phaser';
import type { AssetFile } from '../gfx/assetTypes';
import type { InputState } from '../net/protocol';
import type { Look } from '../save/profile';

export type { InputState };

/** Stable per-player key (survives reconnects, unlike PlayerInfo.id). */
export type PlayerKey = string;
export const playerKey = (slot: 0 | 1 | 2 | 3): PlayerKey => 'p' + slot;

/** What a minigame knows about a player. `remote`: a real remote peer (false for the host's own player and bots). */
export type GamePlayer = { key: PlayerKey; slot: 0 | 1 | 2 | 3; name: string; look: Look; remote: boolean };

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
  /** Local charge (0..1) of the held primary button, null when not held; called every frame before render. */
  setCharge?(charge: number | null): void;
  destroy(): void;
}

export interface MiniGame<S = unknown> {
  id: string;
  title: string;
  rule: string;
  controls: string;
  durationMs: number | null;
  /**
   * Games aimed with the mouse: simulation = pointer world position minus this offset (where the
   * view draws the map). Also turns the cursor into a crosshair while the game runs.
   */
  aimOffset?: { x: number; y: number };
  /**
   * `opts.durationMs` overrides the game's duration (dev-only fast mode); `opts.assets` are the loaded
   * asset files (games with an arena map need them).
   */
  createHost(
    players: GamePlayer[],
    rand: () => number,
    opts?: { durationMs?: number; assets?: Record<string, AssetFile> },
  ): MiniGameHost<S>;
  createView(scene: Phaser.Scene, players: GamePlayer[], selfKey: PlayerKey): MiniGameView<S>;
  /** Snapshot interpolation for clients (default: step to the newer state). */
  lerp?(a: S, b: S, t: number): S;
  /** World view for dev bots; null when the bot has nothing to do. */
  botView?(s: S, key: PlayerKey): BotView | null;
}

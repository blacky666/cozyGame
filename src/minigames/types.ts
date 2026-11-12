import type Phaser from 'phaser';
import type { RoundCard } from '../flow/cards';
import type { AssetFile } from '../gfx/assetTypes';
import type { InputState } from '../net/protocol';
import type { FeatId } from '../progress/feats';
import type { Look } from '../save/profile';

export type { InputState };

/** Stable per-player key (survives reconnects, unlike PlayerInfo.id). */
export type PlayerKey = string;
export const playerKey = (slot: 0 | 1 | 2 | 3): PlayerKey => 'p' + slot;

/** What a minigame knows about a player. `remote`: a real remote peer (false for the host's own player and bots). */
export type GamePlayer = { key: PlayerKey; slot: 0 | 1 | 2 | 3; name: string; look: Look; remote: boolean };

/**
 * Minimal world view handed to dev bots (see src/dev/bots.ts). `aim`: point to aim and throw at (same
 * coordinates as the simulation); `idle`: stand still (e.g. reloading); `fire`: press that button now.
 */
export type BotView = {
  self: { x: number; y: number };
  targets: { x: number; y: number }[];
  aim?: { x: number; y: number };
  idle?: boolean;
  /** Press exactly this button this call (instead of the random throws at `aim`). */
  fire?: 'primary' | 'secondary';
  /** Press the clockwise turn once this call. */
  turn?: 'cw';
};

/** A player as the prank host sees him in a top-down game (simulation coordinates of the feet). */
export type PrankBody = { key: PlayerKey; x: number; y: number; affectable: boolean; out: boolean };

export interface MiniGameHost<S> {
  /** dt in seconds. */
  tick(dt: number, inputs: Record<PlayerKey, InputState>): void;
  snapshot(): S;
  /** Non-null = finished; tie groups of player keys, best first. */
  result(): PlayerKey[][] | null;
  /** Achievements earned this round; read once when result() is non-null. */
  feats?(): Record<PlayerKey, FeatId[]>;
  /**
   * Prank hooks (spec §7.2), all optional. Top-down games: every player's feet; `affectable` = a prank
   * may hit him now, `out` = he cannot prank (ghost). PrankHost itself skips absent players (no input).
   */
  prankBodies?(): PrankBody[];
  /** Top-down: push `to` away from `from` like a landed shove (Quietsche-Hammer). */
  prankKnock?(from: PlayerKey, to: PlayerKey): void;
  /** Wackel-Turm: owner of the plot under aimX; null for the own plot or outside every plot. */
  prankPlot?(from: PlayerKey, aimX: number): PlayerKey | null;
  /** Wackel-Turm variants of three pranks; false = refused (nothing happened, the prank is not used up). */
  prankTower?(id: 'bananenschale' | 'furzkissen' | 'quietsche_hammer', from: PlayerKey, to: PlayerKey): boolean;
}

export interface MiniGameView<S> {
  render(s: S, selfKey: PlayerKey): void;
  /** Client-side prediction of the own player (called every frame before render; clients only). */
  predict?(input: InputState, dt: number, latest: S | null, ackSeq: number, sentSeq: number): void;
  /** Called every frame while the game scene runs, also before the first snapshot (e.g. the crosshair). */
  frame?(): void;
  /**
   * Main-camera world point an emote bubble's tail points at for this player (above the name label;
   * null hides the bubble).
   */
  emoteAnchor?(key: PlayerKey): { x: number; y: number } | null;
  /**
   * Main-camera point of the figure's feet as rendered (prediction included, ghosts too) for the prank
   * visuals; Wackel-Turm: the bottom of the hanging block (the hook while none hangs). null hides them.
   */
  figureAnchor?(key: PlayerKey): { x: number; y: number } | null;
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
  /** Keep the system cursor although aimOffset is set (games without a crosshair, e.g. Kartoffel). */
  systemCursor?: boolean;
  /** Sound package (public/audio/<name>/, listed in SOUND_PACKAGES): "<name>.countdown_tick" etc. */
  sounds?: string;
  /**
   * `opts.durationMs` overrides the game's duration (dev-only fast mode); `opts.assets` are the loaded
   * asset files (games with an arena map need them); `opts.card` is the Gemeinheit acting in this round.
   */
  createHost(
    players: GamePlayer[],
    rand: () => number,
    opts?: { durationMs?: number; assets?: Record<string, AssetFile>; leaders?: PlayerKey[]; card?: RoundCard | null },
  ): MiniGameHost<S>;
  createView(scene: Phaser.Scene, players: GamePlayer[], selfKey: PlayerKey): MiniGameView<S>;
  /** Snapshot interpolation for clients (default: step to the newer state). */
  lerp?(a: S, b: S, t: number): S;
  /** World view for dev bots; null when the bot has nothing to do. */
  botView?(s: S, key: PlayerKey): BotView | null;
}

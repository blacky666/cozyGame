import { CONFIG } from '../config';
import { Evening, type EveningPhase } from '../flow/evening';
import { neutralInput, type InputState } from '../net/protocol';
import type { PlayerInfo } from '../net/roster';
import { startHostTicker, type HostSession } from '../net/session';
import { playerKey, type BotView, type GamePlayer, type MiniGame, type MiniGameHost, type PlayerKey } from '../minigames/types';

/*
 * Host-side evening driver (no Phaser, so it is unit-tested):
 * - All timing runs on the worker ticker, so the evening keeps going in a background tab.
 * - Every phase change goes out via session.setPhase(kind, phase); clients render whatever arrives.
 * - Players are keyed by PlayerKey ('p' + slot). Session inputs arrive by peer id and are mapped
 *   through the roster each tick, so a reconnect (new peer id, same slot) needs no special case.
 */

export type EveningTiming = { introMs: number; standingsMs: number; durationScale: number };
/** acks: per player key, the seq of the last input the host processed (for client reconciliation). */
export type SnapPayload = { round: number; state: unknown; acks: Record<PlayerKey, number> };
export type BotBrain = (view: BotView) => InputState;

export const DEFAULT_TIMING: EveningTiming = {
  introMs: CONFIG.intro.ruleMs + CONFIG.intro.countdownMs,
  standingsMs: CONFIG.standings.showMs,
  durationScale: 1,
};

export interface EveningHostOptions {
  session: HostSession;
  rounds: number;
  games: MiniGame[];
  /** Host's own input (keyboard), sampled every tick for slot 0. */
  localInput: () => InputState;
  rand?: () => number;
  timing?: EveningTiming;
  /** Clock for snapshot tick times (ms); default performance.now. */
  now?: () => number;
  startTicker?: (hz: number, onTick: (dt: number) => void) => () => void;
  /** Local rendering hook (the host renders the same phases it broadcasts). */
  onPhase?: (p: EveningPhase) => void;
}

const keyOf = (p: PlayerInfo): PlayerKey => playerKey(p.slot);

export class EveningHost {
  phase: EveningPhase = { kind: 'lobby' };
  /** Latest minigame snapshot; the host scene interpolates over (latestTick, latestAt). */
  latest: unknown = null;
  latestTick = 0;
  /** Clock time (ms) at which `latest` was produced. */
  latestAt = 0;

  private readonly session: HostSession;
  private readonly timing: EveningTiming;
  private readonly rand: () => number;
  private readonly now: () => number;
  private evening: Evening | null = null;
  private keys: PlayerKey[] = [];
  private game: MiniGameHost<unknown> | null = null;
  private def: MiniGame | null = null;
  private elapsedMs = 0;
  private snapAcc = 0;
  private stopTicker: (() => void) | null = null;
  private readonly bots = new Map<string, BotBrain>();
  private known = new Set<string>();
  private active = false;
  private unsubRoster: (() => void) | null = null;

  constructor(private readonly o: EveningHostOptions) {
    this.session = o.session;
    this.timing = o.timing ?? DEFAULT_TIMING;
    this.rand = o.rand ?? Math.random;
    this.now = o.now ?? (() => performance.now());
  }

  addBot(id: string, brain: BotBrain): void {
    this.bots.set(id, brain);
  }

  start(): void {
    const players = this.session.roster.list().filter((p) => p.connected);
    this.keys = players.map(keyOf);
    this.known = new Set(players.map((p) => p.id));
    this.evening = new Evening(this.keys, this.o.rounds, this.o.games.map((g) => g.id), this.rand);
    this.active = true;
    this.unsubRoster?.();
    this.unsubRoster = this.session.onRoster((list) => this.onRoster(list));
    this.enter(this.evening.phase);
    const start = this.o.startTicker ?? ((hz, cb) => startHostTicker(hz, cb));
    this.stopTicker = start(CONFIG.net.simHz, (dt) => this.tick(dt));
  }

  /** "Nochmal?": stop the evening and return everyone to the lobby (same room). */
  backToLobby(): void {
    this.stop();
    this.phase = { kind: 'lobby' };
    this.session.resetForLobby(this.phase);
  }

  stop(): void {
    this.active = false;
    this.game = null;
    this.unsubRoster?.();
    this.unsubRoster = null;
    this.stopTicker?.();
    this.stopTicker = null;
  }

  tick(dt: number): void {
    const ev = this.evening;
    if (!this.active || !ev) return;
    const ph = this.phase;
    if (ph.kind === 'playing') {
      this.stepGame(dt, ev);
      return;
    }
    this.elapsedMs += dt * 1000;
    if (ph.kind === 'intro' && this.elapsedMs >= this.timing.introMs) this.enter(ev.advance({ type: 'introDone' }));
    else if (ph.kind === 'standings' && this.elapsedMs >= this.timing.standingsMs) {
      this.enter(ev.advance({ type: 'standingsDone' }));
    }
  }

  private stepGame(dt: number, ev: Evening): void {
    const game = this.game;
    const ph = this.phase;
    if (!game || ph.kind !== 'playing') return;
    const s = this.session;
    s.setLocalInput(s.selfId, this.o.localInput());
    for (const [id, brain] of this.bots) {
      const p = s.roster.get(id);
      if (!p) continue;
      const view = this.latest !== null ? this.def?.botView?.(this.latest, keyOf(p)) : null;
      s.setLocalInput(id, view ? brain(view) : neutralInput());
    }
    const inputs: Record<PlayerKey, InputState> = {};
    const acks: Record<PlayerKey, number> = {};
    for (const p of s.roster.list()) {
      if (!p.connected) continue;
      inputs[keyOf(p)] = s.input(p.id);
      acks[keyOf(p)] = s.lastSeq(p.id);
    }

    game.tick(dt, inputs);
    this.latest = game.snapshot();
    this.latestTick++;
    this.latestAt = this.now();
    const result = game.result();
    this.snapAcc += dt;
    const period = 1 / CONFIG.net.snapshotHz;
    if (this.snapAcc >= period - 1e-6 || result) {
      this.snapAcc = Math.min(this.snapAcc - period, period);
      s.broadcast('playing', { round: ph.round, state: this.latest, acks } satisfies SnapPayload);
    }
    if (result) {
      this.game = null;
      this.enter(ev.advance({ type: 'gameResult', placements: result }));
    }
  }

  private enter(p: EveningPhase): void {
    this.phase = p;
    this.elapsedMs = 0;
    this.snapAcc = 0;
    if (p.kind === 'playing') this.startGame(p.game);
    this.session.setPhase(p.kind, p);
    this.o.onPhase?.(p);
  }

  private startGame(id: string): void {
    const def = this.o.games.find((g) => g.id === id);
    if (!def) throw new Error(`unknown minigame ${id}`);
    const players: GamePlayer[] = this.session.roster
      .list()
      .filter((p) => this.keys.includes(keyOf(p)))
      .map((p) => ({
        key: keyOf(p),
        slot: p.slot,
        name: p.name,
        look: p.look,
        remote: !p.isBot && p.id !== this.session.selfId && !this.bots.has(p.id),
      }));
    const durationMs = def.durationMs === null ? undefined : def.durationMs * this.timing.durationScale;
    this.def = def;
    this.game = def.createHost(players, this.rand, { durationMs });
    this.latest = this.game.snapshot();
    this.latestTick = 0;
    this.latestAt = this.now();
  }

  /** A reconnecting peer has a new id: re-send the current phase so it can join in. */
  private onRoster(list: PlayerInfo[]): void {
    if (!this.active) return;
    const connected = list.filter((p) => p.connected).map((p) => p.id);
    const fresh = connected.some((id) => !this.known.has(id));
    this.known = new Set(connected);
    if (fresh && this.phase.kind !== 'lobby') this.session.setPhase(this.phase.kind, this.phase);
  }
}

import { CONFIG } from '../config';
import { pickMinigames } from './picker';
import { finalRanking, roundPoints } from './scoring';

export type EveningPhase =
  | { kind: 'lobby' }
  | { kind: 'intro'; round: number; game: string; double: boolean }
  | { kind: 'playing'; round: number; game: string }
  | { kind: 'standings'; round: number; points: Record<string, number>; totals: Record<string, number> }
  | { kind: 'podium'; ranking: string[][]; totals: Record<string, number> }
  | { kind: 'ended'; reason: 'host_left' };

export type EveningEvent =
  | { type: 'introDone' }
  | { type: 'gameResult'; placements: string[][] }
  | { type: 'standingsDone' };

/** Evening state machine, keyed by stable player keys. Starts at intro of round 1. */
export class Evening {
  phase: EveningPhase;
  private readonly schedule: string[];
  private totals: Record<string, number> = {};
  private wins: Record<string, number> = {};

  constructor(
    private readonly players: string[],
    private readonly rounds: number,
    games: string[],
    rand: () => number,
  ) {
    if (players.length < CONFIG.players.min) throw new Error('evening needs at least 2 players');
    if (!Number.isInteger(rounds) || rounds < CONFIG.rounds.min || rounds > CONFIG.rounds.max) {
      throw new Error(`rounds must be within ${CONFIG.rounds.min}..${CONFIG.rounds.max}`);
    }
    this.schedule = pickMinigames(games, rounds, rand);
    for (const p of players) {
      this.totals[p] = 0;
      this.wins[p] = 0;
    }
    this.phase = this.intro(1);
  }

  private intro(round: number): EveningPhase {
    return { kind: 'intro', round, game: this.schedule[round - 1], double: round === this.rounds };
  }

  advance(event: EveningEvent): EveningPhase {
    const ph = this.phase;
    if (event.type === 'introDone' && ph.kind === 'intro') {
      this.phase = { kind: 'playing', round: ph.round, game: ph.game };
    } else if (event.type === 'gameResult' && ph.kind === 'playing') {
      const last = ph.round === this.rounds;
      const points = roundPoints(event.placements, this.players.length, last ? CONFIG.lastRoundMultiplier : 1);
      for (const p of this.players) this.totals[p] += points[p] ?? 0;
      for (const p of event.placements[0] ?? []) if (p in this.wins) this.wins[p] += 1;
      const totals = { ...this.totals };
      this.phase = last
        ? { kind: 'podium', ranking: finalRanking(totals, this.wins), totals }
        : { kind: 'standings', round: ph.round, points, totals };
    } else if (event.type === 'standingsDone' && ph.kind === 'standings') {
      this.phase = this.intro(ph.round + 1);
    } else {
      throw new Error(`event ${event.type} does not fit phase ${ph.kind}`);
    }
    return this.phase;
  }
}

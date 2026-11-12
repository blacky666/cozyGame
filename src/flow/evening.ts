import { CONFIG } from '../config';
import { eveningXp, type RoundRecord, type XpLine } from '../progress/xp';
import { offerCards, type CardId, type RoundCard } from './cards';
import { pickMinigames } from './picker';
import { finalRanking, roundPoints } from './scoring';

export type EveningPhase =
  | { kind: 'lobby' }
  /** `card`: the Gemeinheit picked after the previous round (acts in this round), null when none. */
  | { kind: 'intro'; round: number; game: string; double: boolean; card: RoundCard | null }
  | { kind: 'playing'; round: number; game: string; card: RoundCard | null }
  | {
      kind: 'standings'; round: number; points: Record<string, number>; totals: Record<string, number>; tieOrder: string[];
      /** XP lines of every player so far (no gesamt lines); each client applies only its own. */
      eveningId: string; xp: Record<string, XpLine[]>;
    }
  | {
      kind: 'podium'; ranking: string[][]; totals: Record<string, number>; tieOrder: string[];
      /** XP lines of the whole evening, gesamt lines included. */
      eveningId: string; xp: Record<string, XpLine[]>;
    }
  /** The overall last place (chooser) picks one of `offer` against the first place (victim); `game` is the next game. */
  | { kind: 'cards'; round: number; game: string; chooser: string; victim: string; offer: CardId[] }
  /**
   * The picked card for everyone; `totals` already include Punkte-Klau; `random`: the chooser ran out of
   * time, `gone` (with random): because he left.
   */
  | {
      kind: 'reveal'; round: number; game: string; card: CardId; chooser: string; victim: string; random: boolean; gone?: true;
      totals: Record<string, number>; tieOrder: string[];
    }
  | { kind: 'ended'; reason: 'host_left' };

export type EveningEvent =
  | { type: 'introDone' }
  | { type: 'gameResult'; placements: string[][]; feats?: Record<string, string[]> }
  /** `present`: connected players (chooser/victim candidates); all players when missing. */
  | { type: 'standingsDone'; present?: string[] }
  | { type: 'cardPicked'; card: CardId; random: boolean; gone?: boolean }
  | { type: 'revealDone' };

export type EveningOptions = {
  /** Dev flag `card=<id>`: always offered first (when eligible). */
  forceCard?: CardId;
};

/** Evening state machine, keyed by stable player keys. Starts at intro of round 1. */
export class Evening {
  phase: EveningPhase;
  private readonly schedule: string[];
  /** Random permutation of all keys, fixed for the evening; breaks ties in standings and podium. */
  private readonly tieOrder: string[];
  private totals: Record<string, number> = {};
  private wins: Record<string, number> = {};
  /** Placements and feats of every finished round (for the XP lines). */
  private readonly records: RoundRecord[] = [];

  constructor(
    private readonly players: string[],
    private readonly rounds: number,
    games: string[],
    /** Kept for the later draws (chooser/victim ties, card offers). */
    private readonly rand: () => number,
    /** Random per evening; clients settle the XP of one evening exactly once. */
    readonly id: string = newEveningId(),
    private readonly opts: EveningOptions = {},
  ) {
    if (players.length < CONFIG.players.min) throw new Error('evening needs at least 2 players');
    if (!Number.isInteger(rounds) || rounds < CONFIG.rounds.min || rounds > CONFIG.rounds.max) {
      throw new Error(`rounds must be within ${CONFIG.rounds.min}..${CONFIG.rounds.max}`);
    }
    this.schedule = pickMinigames(games, rounds, rand);
    this.tieOrder = [...players];
    for (let i = this.tieOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [this.tieOrder[i], this.tieOrder[j]] = [this.tieOrder[j], this.tieOrder[i]];
    }
    for (const p of players) {
      this.totals[p] = 0;
      this.wins[p] = 0;
    }
    this.phase = this.intro(1);
  }

  private intro(round: number, card: RoundCard | null = null): EveningPhase {
    return { kind: 'intro', round, game: this.schedule[round - 1], double: round === this.rounds, card };
  }

  /**
   * After the standings of round `round`: the last place among the present players picks a card against
   * the first place. No card with fewer than 2 candidates or equal totals. Ties on either end are random.
   */
  private cardsOrIntro(round: number, present: string[] | undefined): EveningPhase {
    const pool = present ? new Set(present) : null;
    const cands = this.players.filter((k) => !pool || pool.has(k));
    const t = (k: string) => this.totals[k];
    if (cands.length < 2 || cands.every((k) => t(k) === t(cands[0]))) return this.intro(round + 1);
    const low = Math.min(...cands.map(t));
    const lows = cands.filter((k) => t(k) === low);
    const chooser = lows[Math.floor(this.rand() * lows.length)];
    const others = cands.filter((k) => k !== chooser);
    const high = Math.max(...others.map(t));
    const highs = others.filter((k) => t(k) === high);
    const victim = highs[Math.floor(this.rand() * highs.length)];
    const game = this.schedule[round];
    const offer = offerCards(game, this.rand, this.opts.forceCard);
    return { kind: 'cards', round, game, chooser, victim, offer };
  }

  /** Current evening totals (a copy). */
  totalsNow(): Record<string, number> {
    return { ...this.totals };
  }

  private byTieOrder(groups: string[][]): string[][] {
    const idx = (k: string) => this.tieOrder.indexOf(k);
    return groups.map((g) => [...g].sort((a, b) => idx(a) - idx(b)));
  }

  /** Drops unknown keys, duplicates and empty groups; players that are missing form one last tie group. */
  private sanitize(placements: string[][]): string[][] {
    const known = new Set(this.players);
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const group of Array.isArray(placements) ? placements : []) {
      const g: string[] = [];
      for (const k of Array.isArray(group) ? group : []) {
        if (known.has(k) && !seen.has(k)) {
          seen.add(k);
          g.push(k);
        }
      }
      if (g.length > 0) out.push(g);
    }
    const missing = this.players.filter((k) => !seen.has(k));
    if (missing.length > 0) out.push(missing);
    return out;
  }

  /** Known players only, string feat ids only (eveningXp drops unknown ids). */
  private sanitizeFeats(feats: Record<string, string[]> | undefined): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    if (typeof feats !== 'object' || feats === null) return out;
    for (const k of this.players) {
      const list: unknown = feats[k];
      if (Array.isArray(list)) out[k] = list.filter((f): f is string => typeof f === 'string');
    }
    return out;
  }

  advance(event: EveningEvent): EveningPhase {
    const ph = this.phase;
    if (event.type === 'introDone' && ph.kind === 'intro') {
      this.phase = { kind: 'playing', round: ph.round, game: ph.game, card: ph.card };
    } else if (event.type === 'gameResult' && ph.kind === 'playing') {
      const last = ph.round === this.rounds;
      const placements = this.sanitize(event.placements);
      const points = roundPoints(placements, this.players.length, last ? CONFIG.lastRoundMultiplier : 1);
      for (const p of this.players) this.totals[p] += points[p] ?? 0;
      for (const p of placements[0] ?? []) if (p in this.wins) this.wins[p] += 1;
      this.records.push({ placements, feats: this.sanitizeFeats(event.feats) });
      const totals = { ...this.totals };
      if (last) {
        const ranking = this.byTieOrder(finalRanking(totals, this.wins));
        const xp = eveningXp(this.players, this.records, ranking);
        this.phase = { kind: 'podium', ranking, totals, tieOrder: this.tieOrder, eveningId: this.id, xp };
      } else {
        const xp = eveningXp(this.players, this.records, null);
        this.phase = { kind: 'standings', round: ph.round, points, totals, tieOrder: this.tieOrder, eveningId: this.id, xp };
      }
    } else if (event.type === 'standingsDone' && ph.kind === 'standings') {
      this.phase = this.cardsOrIntro(ph.round, event.present);
    } else if (event.type === 'cardPicked' && ph.kind === 'cards' && ph.offer.includes(event.card)) {
      if (event.card === 'punkte_klau') {
        // The victim has strictly more points than the chooser, so at least 1.
        this.totals[ph.victim] -= 1;
        this.totals[ph.chooser] += 1;
      }
      const { round, game, chooser, victim } = ph;
      this.phase = {
        kind: 'reveal', round, game, card: event.card, chooser, victim, random: event.random,
        totals: { ...this.totals }, tieOrder: this.tieOrder,
      };
      if (event.random && event.gone) this.phase.gone = true;
    } else if (event.type === 'revealDone' && ph.kind === 'reveal') {
      this.phase = this.intro(ph.round + 1, { id: ph.card, chooser: ph.chooser, victim: ph.victim });
    } else {
      throw new Error(`event ${event.type} does not fit phase ${ph.kind}`);
    }
    return this.phase;
  }
}

/** Random evening id; randomUUID needs a secure context, so plain http (LAN dev) falls back to getRandomValues. */
function newEveningId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

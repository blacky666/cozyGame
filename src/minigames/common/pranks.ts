import { CONFIG } from '../../config';
import type { InputState } from '../../net/protocol';
import type { FeatId } from '../../progress/feats';
import type { MiniGameHost, PlayerKey, PrankBody } from '../types';
import { Edge } from './edges';
import { FeatTracker } from './feats';
import { dirOf, InputMask, type Dir8, type FxKind } from './prankInput';

const P = CONFIG.pranks;

/** Streich ids (spec §7.2), equal to the item names of category `prank`. */
export const PRANK_IDS = ['bananenschale', 'konfetti_kanone', 'furzkissen', 'verkehrte_welt', 'tintenklecks', 'quietsche_hammer'] as const;
export type PrankId = (typeof PRANK_IDS)[number];
const KNOWN: ReadonlySet<string> = new Set(PRANK_IDS);
const isPrankId = (x: string): x is PrankId => KNOWN.has(x);

/** A timed effect on a player; n identifies it (a new n = a new effect for sounds/visuals). */
export type PrankFx = { key: PlayerKey; kind: FxKind; leftMs: number; n: number; dir?: Dir8 };
export type Banana = { id: number; owner: PlayerKey; x: number; y: number; armed: boolean };
/** One-shot events every client plays once (by n): a fired prank, a slip, freezing and thawing. */
export type CueKind = PrankId | 'rutsch' | 'eis' | 'eis_weg';
export type PrankCue = { n: number; kind: CueKind; from: PlayerKey | null; to: PlayerKey[]; leftMs: number };
/** Prank state in every snapshot: effects, bananas, uses left per player, recent cues. */
export type PrankSnap = { fx: PrankFx[]; bananas: Banana[]; left: Record<PlayerKey, number>; cues: PrankCue[] };

export const emptyPrankSnap = (): PrankSnap => ({ fx: [], bananas: [], left: {}, cues: [] });

/** Pointed pranks that end as a timed effect on the victim (in every game). */
const POINTED: Partial<Record<PrankId, { kind: FxKind; ms: number }>> = {
  furzkissen: { kind: 'stumble', ms: P.stumbleMs },
  verkehrte_welt: { kind: 'reverse', ms: P.reverseMs },
  tintenklecks: { kind: 'ink', ms: P.inkMs },
  konfetti_kanone: { kind: 'confetti', ms: P.confettiMs },
};
/** Pranks the Wackel-Turm resolves itself (prankTower). */
const TOWER_IDS = new Set<PrankId>(['bananenschale', 'furzkissen', 'quietsche_hammer']);

type BananaState = Banana & { ageMs: number };

/**
 * Host-side pranks (spec §7.2), game-agnostic, one per round: resolves F presses (counter `pranks`)
 * into targets, uses, bananas and timed effects, and masks the players' inputs before the game sees
 * them (frozen / stumble / slip / reverse). Games only expose small hooks (MiniGameHost.prank*).
 * A press without a valid target or with a refused effect is not used up.
 */
export class PrankHost {
  private readonly prankOf = new Map<PlayerKey, string>();
  private readonly edges = new Map<PlayerKey, Edge>();
  private readonly left = new Map<PlayerKey, number>();
  private fx: PrankFx[] = [];
  private bananas: BananaState[] = [];
  private cues: PrankCue[] = [];
  private n = 0;
  private bananaId = 0;
  private readonly featT = new FeatTracker();
  private readonly inputMask = new InputMask();

  constructor(
    players: { key: PlayerKey; prank: string }[],
    usesOf: (key: PlayerKey) => number,
    private readonly rand: () => number,
  ) {
    for (const p of players) {
      this.prankOf.set(p.key, p.prank);
      this.edges.set(p.key, new Edge());
      this.left.set(p.key, usesOf(p.key));
    }
  }

  /** Card Falle: the player starts frozen for ms. */
  freeze(key: PlayerKey, ms: number): void {
    this.addFx(key, 'frozen', ms);
    this.cue('eis', null, [key]);
  }

  tick(dtMs: number, raw: Record<PlayerKey, InputState>, game: MiniGameHost<unknown>): void {
    for (const c of this.cues) c.leftMs -= dtMs;
    this.cues = this.cues.filter((c) => c.leftMs > 0);
    const kept: PrankFx[] = [];
    for (const f of this.fx) {
      f.leftMs -= dtMs;
      if (f.leftMs > 0) kept.push(f);
      else if (f.kind === 'frozen') this.cue('eis_weg', null, [f.key]);
    }
    this.fx = kept;

    const bodies = game.prankBodies?.() ?? null;
    this.tickBananas(dtMs, raw, bodies);

    for (const [key, input] of Object.entries(raw)) {
      const edge = this.edges.get(key);
      if (!edge) continue;
      // Several presses within one tick count as one.
      if (edge.take(input.pranks) <= 0) continue;
      if ((this.left.get(key) ?? 0) <= 0) continue;
      const id = this.prankOf.get(key) ?? '';
      if (!isPrankId(id)) continue;
      if (bodies) this.fireTopDown(id, key, input, bodies, game);
      else if (game.prankPlot) this.fireTower(id, key, input, game);
    }
  }

  /** The inputs as the game may see them (prank effects applied); a new record. */
  mask(raw: Record<PlayerKey, InputState>): Record<PlayerKey, InputState> {
    const out: Record<PlayerKey, InputState> = {};
    for (const [key, input] of Object.entries(raw)) {
      out[key] = this.inputMask.apply(key, input, this.fx.filter((f) => f.key === key));
    }
    return out;
  }

  snap(): PrankSnap {
    const left: Record<PlayerKey, number> = {};
    for (const [k, v] of this.left) left[k] = v;
    return {
      fx: this.fx.map((f) => ({ ...f })),
      bananas: this.bananas.map(({ id, owner, x, y, armed }) => ({ id, owner, x, y, armed })),
      left,
      cues: this.cues.map((c) => ({ ...c, to: [...c.to] })),
    };
  }

  feats(): Record<PlayerKey, FeatId[]> {
    return this.featT.result();
  }

  private tickBananas(dtMs: number, raw: Record<PlayerKey, InputState>, bodies: PrankBody[] | null): void {
    const kept: BananaState[] = [];
    for (const b of this.bananas) {
      b.ageMs += dtMs;
      if (b.ageMs >= P.bananaLifeMs) continue;
      b.armed = b.ageMs >= P.bananaArmMs;
      const victim = b.armed && bodies ? nearest(bodies, b.x, b.y, (v) => v.key !== b.owner, P.bananaTriggerPx) : null;
      if (!victim) {
        kept.push(b);
        continue;
      }
      const held = raw[victim.key] ? dirOf(raw[victim.key]) : null;
      this.addFx(victim.key, 'slip', P.slipMs, held ?? (Math.floor(this.rand() * 8) as Dir8));
      this.cue('rutsch', b.owner, [victim.key]);
      this.featT.award(b.owner, 'streich_gelandet');
    }
    this.bananas = kept;
  }

  private fireTopDown(id: PrankId, key: PlayerKey, input: InputState, bodies: PrankBody[], game: MiniGameHost<unknown>): void {
    const me = bodies.find((b) => b.key === key);
    if (!me || me.out) return;
    if (id === 'bananenschale') {
      this.bananas.push({ id: ++this.bananaId, owner: key, x: me.x, y: me.y, armed: false, ageMs: 0 });
      // Lands only when someone slips (feat then).
      this.fired(id, key, [], false);
      return;
    }
    if (id === 'quietsche_hammer') {
      const hit = bodies.filter((b) => b.key !== key && b.affectable && !b.out && Math.hypot(b.x - me.x, b.y - me.y) <= P.hammerRadiusPx);
      if (hit.length === 0) return;
      for (const b of hit) game.prankKnock?.(key, b.key);
      this.fired(id, key, hit.map((b) => b.key), true);
      return;
    }
    const eff = POINTED[id];
    if (!eff) return;
    const target = nearest(bodies, input.aimX, input.aimY, (b) => b.key !== key);
    if (!target) return;
    this.addFx(target.key, eff.kind, eff.ms);
    this.fired(id, key, [target.key], true);
  }

  private fireTower(id: PrankId, key: PlayerKey, input: InputState, game: MiniGameHost<unknown>): void {
    const target = game.prankPlot?.(key, input.aimX) ?? null;
    if (target === null || target === key) return;
    if (TOWER_IDS.has(id)) {
      if (!game.prankTower || !game.prankTower(id as 'bananenschale' | 'furzkissen' | 'quietsche_hammer', key, target)) return;
    } else {
      const eff = POINTED[id];
      if (!eff) return;
      this.addFx(target, eff.kind, eff.ms);
    }
    this.fired(id, key, [target], true);
  }

  private fired(id: PrankId, key: PlayerKey, to: PlayerKey[], landed: boolean): void {
    this.left.set(key, (this.left.get(key) ?? 0) - 1);
    this.cue(id, key, to);
    if (landed) this.featT.award(key, 'streich_gelandet');
  }

  /** Adds an effect; one of the same kind on the same player is replaced (new n, full time). */
  private addFx(key: PlayerKey, kind: FxKind, ms: number, dir?: Dir8): void {
    this.fx = this.fx.filter((f) => !(f.key === key && f.kind === kind));
    const f: PrankFx = { key, kind, leftMs: ms, n: ++this.n };
    if (dir !== undefined) f.dir = dir;
    this.fx.push(f);
  }

  private cue(kind: CueKind, from: PlayerKey | null, to: PlayerKey[]): void {
    this.cues.push({ n: ++this.n, kind, from, to, leftMs: P.cueMs });
  }
}

/** Nearest affectable, not-out body to (x, y) that passes `ok`, optionally within maxPx. */
function nearest(bodies: PrankBody[], x: number, y: number, ok: (b: PrankBody) => boolean, maxPx = Infinity): PrankBody | null {
  let best: PrankBody | null = null;
  let bestD = Infinity;
  for (const b of bodies) {
    if (!b.affectable || b.out || !ok(b)) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d <= maxPx && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

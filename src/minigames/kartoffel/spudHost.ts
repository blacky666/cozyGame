import { CONFIG } from '../../config';
import { neutralInput } from '../../net/protocol';
import { moveCircle, type Arena } from '../common/arena';
import { Edge } from '../common/edges';
import { newShoveSlot, resolveShoves, stepShove, type Facing, type ShoveSlot } from '../common/shove';
import type { Mover } from '../snowball/snowballMove';
import type { GamePlayer, MiniGameHost, PlayerKey } from '../types';
import { stepWalker } from './spudMove';

export type SpudPlayer = Mover & {
  /** Out (blown up): floats around, touches nothing, cannot be touched or shoved. */
  ghost: boolean;
  /** > 0 while sprinting. */
  sprintMs: number;
  /** > 0: no new sprint (counted from the click). */
  sprintCdMs: number;
  /** > 0 while slowed by the Gießkanne. */
  slowMs: number;
  /** Evening leader without a potato (walks at leaderFactor). */
  leader: boolean;
  stun: boolean;
  swing: boolean;
  shoveCdMs: number;
  /** Bangs this player was caught by (2 players: best of three). */
  losses: number;
};
export type Potato = {
  id: number;
  holder: PlayerKey;
  /** Coarse glow stage 0..3 (the exact fuse stays on the host). */
  heat: 0 | 1 | 2 | 3;
  /** The last giver, who cannot get it back while noBackMs > 0. */
  noBackFrom: PlayerKey | null;
  noBackMs: number;
};
export type SpudFx = {
  id: number;
  kind: 'knall' | 'konfetti' | 'uebergabe' | 'kein_zurueck' | 'kurze_lunte' | 'giesskanne' | 'pickup' | 'sprint';
  x: number;
  y: number;
  who: PlayerKey | null;
};
export type SpudPickup = { id: number; x: number; y: number; kind: 'fake' | 'kurze_lunte' | 'giesskanne' };
export type SpudState = {
  phase: 'play' | 'pause' | 'done';
  players: Record<PlayerKey, SpudPlayer>;
  /** Real and fake look the same here: no fuse, no "fake" flag. */
  potatoes: Potato[];
  pickups: SpudPickup[];
  /** Events of the last fxKeepMs (ids grow), so a missed snapshot still shows them. */
  fx: SpudFx[];
  /** Elimination order, first out first. */
  out: PlayerKey[];
  /** Bangs so far (2 players: best of 3). */
  bang: number;
  elapsedMs: number;
};

/** Host-only potato state (never in a snapshot). */
type HostPotato = Potato & {
  fuseMs: number;
  burnMs: number;
  fake: boolean;
  /** Time of the last "Kein Zurück!" fx of this potato. */
  blockFxAtMs: number;
};

/** Start positions (feet) per slot, one per garden quadrant (verified free in arena.test.ts). */
export const SPUD_SPAWNS: ReadonlyArray<readonly [number, number]> = [
  [72, 88],
  [344, 88],
  [72, 184],
  [344, 184],
];
const START_DIR: Facing = 'down';
/** Float slack for timers that count down in tick steps. */
const EPS = 1e-6;

/** Walking speed in px/s: walkSpeed x sprint x slow x leader. The client uses it for prediction. */
export function speedOf(p: SpudPlayer): number {
  const c = CONFIG.kartoffel;
  return c.walkSpeed
    * (p.sprintMs > 0 ? c.sprintFactor : 1)
    * (p.slowMs > 0 ? c.slowFactor : 1)
    * (p.leader ? c.leaderFactor : 1);
}

const countDown = (v: number, ms: number): number => (v - ms > EPS ? v - ms : 0);

/** Host simulation of "Heiße Kartoffel". dt in seconds. */
export function createSpudHost(
  gamePlayers: GamePlayer[],
  rand: () => number,
  arena: Arena,
  opts: { leaders?: PlayerKey[]; safetyMs?: number } = {},
): MiniGameHost<SpudState> {
  const c = CONFIG.kartoffel;
  const safetyMs = opts.safetyMs ?? c.safetyMs;
  const keys = gamePlayers.map((p) => p.key);
  const isLeader = new Set(opts.leaders ?? []);
  const players: Record<PlayerKey, SpudPlayer> = {};
  const shove: Record<PlayerKey, ShoveSlot> = {};
  const taps: Record<PlayerKey, Edge> = {};
  for (const gp of gamePlayers) {
    const [x, y] = SPUD_SPAWNS[gp.slot];
    players[gp.key] = {
      x, y, vx: 0, vy: 0, dir: START_DIR, ghost: false, sprintMs: 0, sprintCdMs: 0, slowMs: 0,
      leader: isLeader.has(gp.key), stun: false, swing: false, shoveCdMs: 0, losses: 0,
    };
    shove[gp.key] = newShoveSlot();
    taps[gp.key] = new Edge();
  }
  // Two players play best of three bangs inside one round; with more, every bang knocks one out.
  const bestOfTwo = keys.length === 2;
  const lossesToLose = Math.ceil(c.bestOf / 2);
  let phase: SpudState['phase'] = 'play';
  /** True while a real potato should be dealt (the first one in the first tick, when inputs show who is present). */
  let needDeal = true;
  let pauseMs = 0;
  let potatoes: HostPotato[] = [];
  const pickups: SpudPickup[] = [];
  let fx: (SpudFx & { atMs: number })[] = [];
  const out: PlayerKey[] = [];
  let bang = 0;
  let elapsedMs = 0;
  let nextPotatoId = 1;
  let nextFxId = 1;

  const addFx = (kind: SpudFx['kind'], x: number, y: number, who: PlayerKey | null) => {
    fx.push({ id: nextFxId++, kind, x: Math.round(x), y: Math.round(y), who, atMs: elapsedMs });
  };
  const living = () => keys.filter((k) => !players[k].ghost);
  const pick = <T>(list: T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  const heatOf = (p: HostPotato): Potato['heat'] => {
    const burnt = p.burnMs / p.fuseMs;
    return c.heatSteps.filter((s) => burnt >= s).length as Potato['heat'];
  };
  /** The leader flag carries the speed factor: only while the leader holds no potato. */
  const refreshLeaders = () => {
    for (const k of keys) players[k].leader = isLeader.has(k) && !potatoes.some((p) => p.holder === k);
  };

  /** A new real potato for a random living player who is present (anyone living if nobody is). */
  const deal = (present: (k: PlayerKey) => boolean) => {
    const alive = living();
    const cands = alive.filter(present);
    const holder = pick(cands.length > 0 ? cands : alive);
    const fuseMs = c.fuseMinMs + rand() * (c.fuseMaxMs - c.fuseMinMs);
    potatoes.push({
      id: nextPotatoId++, holder, heat: 0, noBackFrom: null, noBackMs: 0,
      fuseMs, burnMs: 0, fake: false, blockFxAtMs: -Infinity,
    });
  };

  /** The real potato burst on `k`. */
  const blowUp = (k: PlayerKey) => {
    const p = players[k];
    bang += 1;
    p.losses += 1;
    addFx('knall', p.x, p.y, k);
    // Every potato goes with the bang (a fake one too): the next round of the fuse starts clean.
    potatoes = [];
    if (!bestOfTwo || p.losses >= lossesToLose) {
      p.ghost = true;
      out.push(k);
    }
    if (living().length <= 1 || (bestOfTwo && p.losses >= lossesToLose)) {
      phase = 'done';
      return;
    }
    phase = 'pause';
    pauseMs = c.boomPauseMs;
  };

  return {
    tick(dt, inputs) {
      if (phase === 'done') return;
      const ms = Math.min(dt * 1000, Math.max(0, safetyMs - elapsedMs));
      const sec = ms / 1000;
      elapsedMs += ms;
      fx = fx.filter((f) => elapsedMs - f.atMs < c.fxKeepMs);
      if (phase === 'pause') pauseMs = countDown(pauseMs, ms);
      const present = (k: PlayerKey) => inputs[k] !== undefined;
      /** Can act and be touched: living and present this tick. */
      const active = keys.filter((k) => !players[k].ghost && present(k));

      // 1. Shoves (living players with input). Ghost presses are consumed, never queued.
      for (const k of keys) if (players[k].ghost && inputs[k]) shove[k].edge.take(inputs[k].shoves);
      resolveShoves(active, players, shove, inputs);

      // 2. Movement at speedOf; stunned players slide.
      for (const k of keys) {
        const p = players[k];
        const sh = shove[k];
        const stunned = sh.stunMs > 0;
        const slide = stepShove(sh, sec);
        if (stunned) {
          const r = moveCircle(arena, p.x, p.y, slide.dx, slide.dy, c.bodyRadius);
          p.x = r.x;
          p.y = r.y;
          p.vx = 0;
          p.vy = 0;
        } else {
          Object.assign(p, stepWalker(p, inputs[k] ?? neutralInput(), sec, arena, speedOf(p)));
        }
        p.stun = sh.stunMs > 0;
        p.swing = sh.swingMs > 0;
        p.shoveCdMs = Math.ceil(sh.cooldownMs);
        p.sprintMs = countDown(p.sprintMs, ms);
        p.sprintCdMs = countDown(p.sprintCdMs, ms);
        p.slowMs = countDown(p.slowMs, ms);
      }

      // 3. Sprint taps. Absent players take no edge, so a reconnect fires no phantom sprint.
      for (const k of keys) {
        const inp = inputs[k];
        if (!inp) continue;
        const p = players[k];
        if (taps[k].take(inp.primaryTaps) === 0) continue;
        if (p.ghost || p.stun || p.sprintCdMs > 0) continue;
        p.sprintMs = c.sprintMs;
        p.sprintCdMs = c.sprintCooldownMs;
        addFx('sprint', p.x, p.y, k);
      }

      // 4. Pickups (Task 3 hook: spawn on beet tiles, collect, apply fake / kurze Lunte / Gießkanne).

      // 5. Passes by touch: each potato at most once per tick, to the nearest touching living
      // player with input. The giver cannot get it back while noBackMs runs. Shoves never pass.
      for (const pot of potatoes) {
        pot.noBackMs = countDown(pot.noBackMs, ms);
        if (!present(pot.holder)) continue;
        const h = players[pot.holder];
        let best: PlayerKey | null = null;
        let bestD = Infinity;
        let blocked = false;
        for (const k of active) {
          if (k === pot.holder) continue;
          const d = Math.hypot(players[k].x - h.x, players[k].y - h.y);
          if (d > c.touchPx) continue;
          if (k === pot.noBackFrom && pot.noBackMs > 0) { blocked = true; continue; }
          if (d < bestD) { best = k; bestD = d; }
        }
        if (best) {
          const to = players[best];
          addFx('uebergabe', (h.x + to.x) / 2, (h.y + to.y) / 2, best);
          pot.noBackFrom = pot.holder;
          pot.noBackMs = c.noBackMs;
          pot.holder = best;
        } else if (blocked && elapsedMs - pot.blockFxAtMs >= c.noBackFxMs - EPS) {
          pot.blockFxAtMs = elapsedMs;
          addFx('kein_zurueck', h.x, h.y, pot.holder);
        }
      }

      // 6. Fuse burn and bang (after the passes: the potato bursts on whoever holds it now).
      for (const pot of [...potatoes]) {
        if (phase !== 'play') break;
        pot.burnMs += ms;
        pot.heat = heatOf(pot);
        if (pot.burnMs < pot.fuseMs - EPS) continue;
        if (pot.fake) {
          const h = players[pot.holder];
          addFx('konfetti', h.x, h.y, pot.holder);
          potatoes = potatoes.filter((o) => o !== pot);
          continue;
        }
        blowUp(pot.holder);
      }

      // 7. Pause, then the next potato.
      if (phase === 'pause' && pauseMs <= 0) {
        phase = 'play';
        needDeal = true;
      }
      if (phase === 'play' && needDeal) {
        needDeal = false;
        deal(present);
      }

      // 8. Safety limit: living players share first place.
      if (elapsedMs >= safetyMs - EPS) phase = 'done';
      refreshLeaders();
    },
    snapshot() {
      const ps: Record<PlayerKey, SpudPlayer> = {};
      for (const k of keys) ps[k] = { ...players[k] };
      return {
        phase,
        players: ps,
        potatoes: potatoes.map(({ id, holder, heat, noBackFrom, noBackMs }) => ({
          id, holder, heat, noBackFrom, noBackMs: Math.ceil(noBackMs),
        })),
        pickups: pickups.map((pk) => ({ ...pk })),
        fx: fx.map(({ id, kind, x, y, who }) => ({ id, kind, x, y, who })),
        out: [...out],
        bang,
        elapsedMs,
      };
    },
    result() {
      if (phase !== 'done') return null;
      const groups: PlayerKey[][] = [];
      const alive = living();
      if (alive.length > 0) groups.push(alive);
      for (let i = out.length - 1; i >= 0; i--) groups.push([out[i]]);
      return groups;
    },
  };
}

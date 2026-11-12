import { CONFIG } from '../../config';
import { neutralInput } from '../../net/protocol';
import { moveCircle, type Arena } from '../common/arena';
import { Edge } from '../common/edges';
import { newShoveSlot, resolveShoves, stepShove, type Facing, type ShoveSlot } from '../common/shove';
import type { Mover } from '../common/mover';
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
  /** Heat thresholds as fractions of the fuse, jittered per potato so heat does not reveal the fuse. */
  steps: number[];
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
/** Raster character of the vegetable beds: the only tiles pickups spawn on. */
const BEET = 'b';
/** Minimum gap between two heat thresholds and to the ends of (0, 1). */
const HEAT_GAP = 0.01;
const PICKUP_KINDS: ReadonlyArray<SpudPickup['kind']> = ['fake', 'kurze_lunte', 'giesskanne'];

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
  /** Centres of all beet tiles (pickup spawn spots). */
  const beets: { x: number; y: number }[] = [];
  arena.raster.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      if (line[col] === BEET) beets.push({ x: (col + 0.5) * arena.tile, y: (row + 0.5) * arena.tile });
    }
  });
  let spawnMs = 0;
  let nextPickupId = 1;
  let fx: (SpudFx & { atMs: number })[] = [];
  const out: PlayerKey[] = [];
  let bang = 0;
  let elapsedMs = 0;
  let nextFxId = 1;

  const addFx = (kind: SpudFx['kind'], x: number, y: number, who: PlayerKey | null) => {
    fx.push({ id: nextFxId++, kind, x: Math.round(x), y: Math.round(y), who, atMs: elapsedMs });
  };
  const living = () => keys.filter((k) => !players[k].ghost);
  const pick = <T>(list: T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  const heatOf = (p: HostPotato): Potato['heat'] => {
    const burnt = p.burnMs / p.fuseMs;
    return p.steps.filter((s) => burnt >= s).length as Potato['heat'];
  };
  /** Each heat step shifted by up to +-heatJitter, strictly increasing and inside (0, 1). */
  const jitteredSteps = (): number[] => {
    let prev = 0;
    return c.heatSteps.map((s, i) => {
      const lo = prev + HEAT_GAP;
      const hi = 1 - HEAT_GAP * (c.heatSteps.length - i);
      prev = Math.min(hi, Math.max(lo, s + (rand() * 2 - 1) * c.heatJitter));
      return prev;
    });
  };
  /** Random id (never reveals creation order, so a fake cannot be told from the real one by id). */
  const newPotatoId = (): number => {
    for (let i = 0; i < c.idTries; i++) {
      const id = 1 + Math.floor(rand() * c.idRange);
      if (!potatoes.some((o) => o.id === id)) return id;
    }
    // Degenerate rand (e.g. constant): fall back to an id above every live one.
    return Math.max(0, ...potatoes.map((o) => o.id)) + 1;
  };
  const newPotato = (
    holder: PlayerKey, fuseMs: number, fake: boolean, burnMs = 0, steps = jitteredSteps(),
  ): HostPotato => ({
    id: newPotatoId(), holder, heat: 0, noBackFrom: null, noBackMs: 0,
    fuseMs, burnMs, fake, steps, blockFxAtMs: -Infinity,
  });
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
    potatoes.push(newPotato(holder, fuseMs, false));
  };

  /** One new pickup on a free beet tile far from every living player, or none after pickupTries tries. */
  const spawnPickup = () => {
    const alive = living();
    for (let i = 0; i < c.pickupTries && beets.length > 0; i++) {
      const spot = pick(beets);
      if (pickups.some((pk) => pk.x === spot.x && pk.y === spot.y)) continue;
      if (alive.some((k) => Math.hypot(players[k].x - spot.x, players[k].y - spot.y) < c.pickupClearPx)) continue;
      // At most one fake at a time (as a pickup or as a potato in play).
      const fakeAround = pickups.some((pk) => pk.kind === 'fake') || potatoes.some((o) => o.fake);
      const kind = pick(PICKUP_KINDS.filter((kd) => kd !== 'fake' || !fakeAround));
      pickups.push({ id: nextPickupId++, x: spot.x, y: spot.y, kind });
      return;
    }
  };

  /** `k` took the pickup: apply its effect. */
  const applyPickup = (pk: SpudPickup, k: PlayerKey) => {
    addFx('pickup', pk.x, pk.y, k);
    if (pk.kind === 'fake') {
      // The fake starts at the real potato's burnt fraction (same glow), with its own 6-10 s left.
      const left = c.fakeFuseMinMs + rand() * (c.fakeFuseMaxMs - c.fakeFuseMinMs);
      const real = potatoes.find((o) => !o.fake);
      const frac = real ? Math.min(real.burnMs / real.fuseMs, 1 - EPS) : 0;
      const fuseMs = left / (1 - frac);
      const fake = newPotato(k, fuseMs, true, frac * fuseMs, real?.steps);
      fake.heat = heatOf(fake);
      potatoes.push(fake);
      return;
    }
    // Both extras hit every live potato alike, the fake included, so neither reveals the real one.
    for (const pot of potatoes) {
      if (pk.kind === 'kurze_lunte') {
        pot.fuseMs = Math.min(pot.fuseMs, pot.burnMs + c.shortFuseMs);
        addFx('kurze_lunte', pk.x, pk.y, pot.holder);
      } else {
        players[pot.holder].slowMs = c.slowMs;
        addFx('giesskanne', players[pot.holder].x, players[pot.holder].y, pot.holder);
      }
    }
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
      /** Can act (shove, sprint, pick up, pass) and be shoved: living and present this tick. */
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

      // 3. Sprint taps. Absent players take no edge. Edge only re-bases when a counter drops, so a
      // reconnect whose counter grew meanwhile fires its sprint once (as in snowballHost).
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

      // 4. Pickups: spawn on beet tiles every pickupSpawnMs while playing, collected by touch by
      // living players with input (ghosts never). Effects: fake potato / kurze Lunte / Gießkanne.
      if (phase === 'play') {
        spawnMs += ms;
        if (spawnMs >= c.pickupSpawnMs - EPS) {
          spawnMs = 0;
          if (pickups.length < c.maxPickups) spawnPickup();
        }
        for (const pk of [...pickups]) {
          let taker: PlayerKey | null = null;
          let takerD = c.pickupTouchPx;
          for (const k of active) {
            const d = Math.hypot(players[k].x - pk.x, players[k].y - pk.y);
            if (d <= takerD) { taker = k; takerD = d; }
          }
          if (!taker) continue;
          pickups.splice(pickups.indexOf(pk), 1);
          applyPickup(pk, taker);
        }
      }

      // 5. Passes by touch: each potato at most once per tick, from a present holder to the nearest
      // touching living player, present or not (an absent figure stands still and catches it like
      // anyone else, so a disconnect never wins the round). The giver cannot get it back while
      // noBackMs runs. Shoves never pass.
      const alive = living();
      for (const pot of potatoes) {
        pot.noBackMs = countDown(pot.noBackMs, ms);
        if (!present(pot.holder)) continue;
        const h = players[pot.holder];
        let best: PlayerKey | null = null;
        let bestD = Infinity;
        let blocked = false;
        for (const k of alive) {
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
        potatoes: potatoes
          .map(({ id, holder, heat, noBackFrom, noBackMs }) => ({
            id, holder, heat, noBackFrom, noBackMs: Math.ceil(noBackMs),
          }))
          .sort((a, b) => a.id - b.id),
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

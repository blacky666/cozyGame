import { CONFIG } from '../../config';
import { neutralInput } from '../../net/protocol';
import { moveCircle, tileAt, type Arena, type Solid } from '../common/arena';
import { Edge } from '../common/edges';
import { newShoveSlot, resolveShoves, stepShove, type Facing, type ShoveSlot } from '../common/shove';
import type { GamePlayer, MiniGameHost, PlayerKey } from '../types';
import { advanceBall, BALL_LIFT, throwPower, type BallTarget } from './snowballBalls';
import { stepMover, type Mover } from './snowballMove';

export type SnowPlayer = Mover & {
  score: number;
  balls: number;
  reloading: boolean;
  charging: boolean;
  invulnMs: number;
  stun: boolean;
  swing: boolean;
  shoveCdMs: number;
  extra: 'abpraller' | 'riesenball' | null;
  extraLeft: number;
  hat: boolean;
  throwAnimMs: number;
};
export type Ball = {
  id: number; x: number; y: number; vx: number; vy: number;
  /** Remaining range in px. */
  left: number;
  owner: PlayerKey;
  kind: 'normal' | 'abpraller' | 'riesenball';
  bounces: number;
};
export type Snowman = {
  /** Id of the arena solid. */
  id: string;
  hits: number;
  state: 'heil' | 'schaden1' | 'schaden2' | 'kaputt' | 'aufbau';
  rebuildMs: number;
};
export type Pickup = { id: number; x: number; y: number; kind: 'abpraller' | 'riesenball' | 'eiszapfenmuetze' };
export type SnowFx = { id: number; kind: 'treffer' | 'zerfall' | 'abprall' | 'schild_bruch'; x: number; y: number };
export type SnowState = {
  timeLeftMs: number;
  players: Record<PlayerKey, SnowPlayer>;
  balls: Ball[];
  snowmen: Snowman[];
  pickups: Pickup[];
  /** Events of the last FX_KEEP_MS (ids grow), so a missed snapshot still shows them. */
  fx: SnowFx[];
};

/** Start positions (feet) per slot, one per quadrant inside the fence (verified free in the tests). */
export const SPAWNS: ReadonlyArray<readonly [number, number]> = [
  [60, 110],
  [350, 110],
  [90, 180],
  [340, 180],
];
const START_DIR: Facing = 'down';
const FX_KEEP_MS = 500;
/** Ticks of position history per player (lag compensation needs CONFIG.net.rewindMs of it). */
const HISTORY_TICKS = 10;
const SNOWMAN_PREFIX = 'schnee.solid.schneemann.';
const DAMAGE: Snowman['state'][] = ['heil', 'schaden1', 'schaden2'];

/** Host simulation of "Schneeball-Schlacht". dt in seconds. */
export function createSnowballHost(
  gamePlayers: GamePlayer[],
  rand: () => number,
  arena: Arena,
  durationMs: number = CONFIG.snowball.durationMs,
): MiniGameHost<SnowState> {
  void rand; // pickups (Task 6) use it
  const c = CONFIG.snowball;
  const keys = gamePlayers.map((p) => p.key);
  const remote: Record<PlayerKey, boolean> = {};
  const players: Record<PlayerKey, SnowPlayer> = {};
  const shove: Record<PlayerKey, ShoveSlot> = {};
  const taps: Record<PlayerKey, Edge> = {};
  const sinceThrowMs: Record<PlayerKey, number> = {};
  const reloadMs: Record<PlayerKey, number> = {};
  const history: Record<PlayerKey, { ms: number; x: number; y: number }[]> = {};
  for (const gp of gamePlayers) {
    const [x, y] = SPAWNS[gp.slot];
    players[gp.key] = {
      x, y, vx: 0, vy: 0, dir: START_DIR, score: 0, balls: c.maxBalls, reloading: false, charging: false,
      invulnMs: 0, stun: false, swing: false, shoveCdMs: 0, extra: null, extraLeft: 0, hat: false, throwAnimMs: 0,
    };
    remote[gp.key] = gp.remote;
    shove[gp.key] = newShoveSlot();
    taps[gp.key] = new Edge();
    sinceThrowMs[gp.key] = Infinity;
    reloadMs[gp.key] = 0;
    history[gp.key] = [{ ms: 0, x, y }];
  }
  const snowmen: Snowman[] = arena.solids
    .filter((s) => s.sprite.startsWith(SNOWMAN_PREFIX))
    .map((s) => ({ id: s.id, hits: 0, state: 'heil', rebuildMs: 0 }));
  const snowmanById = new Map(snowmen.map((s) => [s.id, s]));
  let balls: Ball[] = [];
  let fx: (SnowFx & { atMs: number })[] = [];
  let elapsedMs = 0;
  let nextBallId = 1;
  let nextFxId = 1;

  /** Arena solids without broken (or rebuilding) snowmen. */
  const solidsNow = (): Solid[] =>
    arena.solids.filter((s) => {
      const sm = snowmanById.get(s.id);
      return !sm || (sm.state !== 'kaputt' && sm.state !== 'aufbau');
    });
  const addFx = (kind: SnowFx['kind'], x: number, y: number) => {
    fx.push({ id: nextFxId++, kind, x: Math.round(x), y: Math.round(y), atMs: elapsedMs });
  };

  /** Feet position of a player as seen by a thrower (rewound for remote throwers). */
  const seenAt = (k: PlayerKey, rewind: boolean): BallTarget => {
    const p = players[k];
    if (!rewind) return { key: k, x: p.x, y: p.y };
    const target = elapsedMs - CONFIG.net.rewindMs;
    let best = history[k][0];
    for (const h of history[k]) if (Math.abs(h.ms - target) < Math.abs(best.ms - target)) best = h;
    return { key: k, x: best.x, y: best.y };
  };

  const throwBall = (k: PlayerKey, aimX: number, aimY: number, charge: number) => {
    const p = players[k];
    let dx = aimX - p.x;
    let dy = aimY - p.y;
    let len = Number.isFinite(dx) && Number.isFinite(dy) ? Math.hypot(dx, dy) : 0;
    if (len < 1) {
      [dx, dy] = p.dir === 'side' ? [1, 0] : p.dir === 'left' ? [-1, 0] : p.dir === 'up' ? [0, -1] : [0, 1];
      len = 1;
    }
    const { speed, range } = throwPower(charge);
    balls.push({
      id: nextBallId++, x: p.x, y: p.y - BALL_LIFT, vx: (dx / len) * speed, vy: (dy / len) * speed,
      left: range, owner: k, kind: 'normal', bounces: 0,
    });
    p.balls -= 1;
    p.reloading = false;
    reloadMs[k] = 0;
    sinceThrowMs[k] = 0;
    p.throwAnimMs = c.throwGapMs;
  };

  const hitSnowman = (sm: Snowman) => {
    if (sm.state === 'kaputt' || sm.state === 'aufbau') return;
    sm.hits += 1;
    if (sm.hits >= c.snowmanHits) {
      sm.state = 'kaputt';
      sm.rebuildMs = c.snowmanRebuildMs;
    } else {
      sm.state = DAMAGE[Math.min(sm.hits, DAMAGE.length - 1)];
    }
  };

  const stepSnowmen = (ms: number) => {
    for (const sm of snowmen) {
      if (sm.state !== 'kaputt' && sm.state !== 'aufbau') continue;
      sm.rebuildMs -= ms;
      if (sm.rebuildMs > 1e-6) continue;
      if (sm.state === 'kaputt') {
        sm.state = 'aufbau';
        sm.rebuildMs = c.snowmanAufbauMs;
      } else {
        sm.state = 'heil';
        sm.hits = 0;
        sm.rebuildMs = 0;
      }
    }
  };

  return {
    tick(dt, inputs) {
      if (elapsedMs >= durationMs) return;
      const ms = Math.min(dt * 1000, durationMs - elapsedMs);
      const sec = ms / 1000;
      elapsedMs += ms;
      fx = fx.filter((f) => elapsedMs - f.atMs < FX_KEEP_MS);
      stepSnowmen(ms);
      let solids = solidsNow();

      // 1. Shoves; the slide goes through the arena collision.
      resolveShoves(keys, players, shove, inputs);
      // 2. Movement.
      for (const k of keys) {
        const p = players[k];
        const sh = shove[k];
        const stunned = sh.stunMs > 0;
        const slide = stepShove(sh, sec);
        if (stunned) {
          const r = moveCircle(arena, p.x, p.y, slide.dx, slide.dy, c.bodyRadius, solids);
          p.x = r.x;
          p.y = r.y;
          p.vx = 0;
          p.vy = 0;
        } else {
          Object.assign(p, stepMover(p, inputs[k] ?? neutralInput(), sec, arena, solids));
        }
        p.stun = sh.stunMs > 0;
        p.swing = sh.swingMs > 0;
        p.shoveCdMs = Math.ceil(sh.cooldownMs);
        p.invulnMs = Math.max(0, p.invulnMs - ms);
        p.throwAnimMs = Math.max(0, p.throwAnimMs - ms);
        sinceThrowMs[k] += ms;
        const h = history[k];
        h.push({ ms: elapsedMs, x: p.x, y: p.y });
        if (h.length > HISTORY_TICKS) h.shift();
      }
      // 3. Throws (one per tick at most; presses without ammo or too early are dropped) and 4. reload.
      for (const k of keys) {
        const p = players[k];
        const inp = inputs[k] ?? neutralInput();
        const presses = taps[k].take(inp.primaryTaps);
        p.charging = inp.primary;
        if (presses > 0 && p.balls >= 1 && sinceThrowMs[k] >= c.throwGapMs) {
          throwBall(k, inp.aimX, inp.aimY, inp.primaryCharge);
          continue;
        }
        const held = inp.up || inp.down || inp.left || inp.right;
        const still = Math.hypot(p.vx, p.vy) < 1 && !held;
        const canReload = still && !p.stun && !p.charging && tileAt(arena, p.x, p.y) !== 'j' && p.balls < c.maxBalls;
        if (!canReload) {
          p.reloading = false;
          reloadMs[k] = 0;
          continue;
        }
        p.reloading = true;
        reloadMs[k] += ms;
        if (reloadMs[k] >= c.reloadMs - 1e-6) {
          reloadMs[k] = 0;
          p.balls += 1;
          p.reloading = p.balls < c.maxBalls;
        }
      }
      // 5. Balls vs solids and 6. vs players.
      const kept: Ball[] = [];
      for (const b of balls) {
        const rewind = remote[b.owner] ?? false;
        const targets = keys.map((k) => seenAt(k, rewind));
        const ev = advanceBall(b, sec, arena, solids, targets);
        if (!ev) { kept.push(b); continue; }
        if (ev.kind === 'player') {
          const v = players[ev.victim];
          if (v.invulnMs > 0) { addFx('zerfall', ev.x, ev.y); continue; }
          const thrower = players[b.owner];
          if (thrower) thrower.score += c.hitPoints;
          v.score = Math.max(0, v.score - c.hitPenalty);
          v.invulnMs = c.invulnMs;
          addFx('treffer', ev.x, ev.y);
          continue;
        }
        addFx('zerfall', ev.x, ev.y);
        const sm = ev.kind === 'solid' && ev.solid ? snowmanById.get(ev.solid.id) : undefined;
        if (sm) {
          hitSnowman(sm);
          if (sm.state === 'kaputt') solids = solidsNow();
        }
      }
      balls = kept;
    },
    snapshot() {
      const ps: Record<PlayerKey, SnowPlayer> = {};
      for (const k of keys) ps[k] = { ...players[k] };
      return {
        timeLeftMs: Math.max(0, Math.ceil(durationMs - elapsedMs)),
        players: ps,
        balls: balls.map((b) => ({ ...b })),
        snowmen: snowmen.map((s) => ({ ...s })),
        pickups: [],
        fx: fx.map(({ id, kind, x, y }) => ({ id, kind, x, y })),
      };
    },
    result() {
      if (elapsedMs < durationMs) return null;
      const scores = [...new Set(keys.map((k) => players[k].score))].sort((a, b) => b - a);
      return scores.map((s) => keys.filter((k) => players[k].score === s));
    },
  };
}

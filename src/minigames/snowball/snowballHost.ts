import { CONFIG } from '../../config';
import { neutralInput } from '../../net/protocol';
import { moveCircle, tileAt, type Arena, type Solid } from '../common/arena';
import { Edge } from '../common/edges';
import { countShoves, FeatTracker } from '../common/feats';
import { newShoveSlot, resolveShoves, stepShove, type Facing, type ShoveSlot } from '../common/shove';
import type { GamePlayer, MiniGameHost, PlayerKey } from '../types';
import { advanceBall, BALL_LIFT, ballOverlaps, spawnIgnores, throwPower, type BallTarget } from './snowballBalls';
import { stepMover, type Mover } from './snowballMove';

export type SnowPlayer = Mover & {
  score: number;
  balls: number;
  reloading: boolean;
  invulnMs: number;
  /** Lying on the ground after a hit (no move, no throw, no reload, not shovable). */
  down: boolean;
  /** > 0 after a strong throw: no throw of any kind. */
  strongCdMs: number;
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
  /** Remaining flight distance in px (the ball lands when it reaches 0). */
  left: number;
  /** Flight distance at the throw (for the view's arc: progress = 1 - left / total). */
  total: number;
  owner: PlayerKey;
  kind: 'normal' | 'abpraller' | 'riesenball';
  bounces: number;
  /** Right-click throw (the view plays a heavier whoosh). */
  strong: boolean;
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
const PICKUP_KINDS: Pickup['kind'][] = ['abpraller', 'riesenball', 'eiszapfenmuetze'];
const PICKUP_RADIUS = 6;
const PICKUP_COLLECT_PX = 8;
const PICKUP_PLAYER_GAP = 24;
const PICKUP_TRIES = 20;
/** Tile rows inside the fence (the fence spans y 48..192 of the map). */
const PLAY_ROWS: readonly [number, number] = [3, 11];

const circleHitsRect = (s: Solid, x: number, y: number, r: number): boolean => {
  const dx = x - Math.max(s.x, Math.min(x, s.x + s.w));
  const dy = y - Math.max(s.y, Math.min(y, s.y + s.h));
  return dx * dx + dy * dy < r * r;
};

/** Host simulation of "Schneeball-Schlacht". dt in seconds. */
export function createSnowballHost(
  gamePlayers: GamePlayer[],
  rand: () => number,
  arena: Arena,
  durationMs: number = CONFIG.snowball.durationMs,
): MiniGameHost<SnowState> {
  const c = CONFIG.snowball;
  const keys = gamePlayers.map((p) => p.key);
  const feats = new FeatTracker();
  /** Someone already scored a hit this round (schnee_erster). */
  let anyHit = false;
  const remote: Record<PlayerKey, boolean> = {};
  const players: Record<PlayerKey, SnowPlayer> = {};
  const shove: Record<PlayerKey, ShoveSlot> = {};
  const taps: Record<PlayerKey, Edge> = {};
  const strongTaps: Record<PlayerKey, Edge> = {};
  const downMs: Record<PlayerKey, number> = {};
  const sinceThrowMs: Record<PlayerKey, number> = {};
  /**
   * A left press that came too early (inside throwGapMs or a strong cooldown) is kept this long and
   * fires as soon as the player can throw: a quick double click gives two balls, not one.
   */
  const pendingMs: Record<PlayerKey, number> = {};
  const reloadMs: Record<PlayerKey, number> = {};
  const history: Record<PlayerKey, { ms: number; x: number; y: number }[]> = {};
  for (const gp of gamePlayers) {
    const [x, y] = SPAWNS[gp.slot];
    players[gp.key] = {
      x, y, vx: 0, vy: 0, dir: START_DIR, score: 0, balls: c.maxBalls, reloading: false,
      invulnMs: 0, down: false, strongCdMs: 0, stun: false, swing: false, shoveCdMs: 0, extra: null, extraLeft: 0, hat: false, throwAnimMs: 0,
    };
    remote[gp.key] = gp.remote;
    shove[gp.key] = newShoveSlot();
    taps[gp.key] = new Edge();
    strongTaps[gp.key] = new Edge();
    downMs[gp.key] = 0;
    sinceThrowMs[gp.key] = Infinity;
    pendingMs[gp.key] = 0;
    reloadMs[gp.key] = 0;
    history[gp.key] = [{ ms: 0, x, y }];
  }
  const snowmen: Snowman[] = arena.solids
    .filter((s) => s.sprite.startsWith(SNOWMAN_PREFIX))
    .map((s) => ({ id: s.id, hits: 0, state: 'heil', rebuildMs: 0 }));
  const snowmanById = new Map(snowmen.map((s) => [s.id, s]));
  let balls: Ball[] = [];
  /** Host-only: per ball id, solids it spawned in and still overlaps (kept out of snapshots). */
  const ignore = new Map<number, string[]>();
  let fx: (SnowFx & { atMs: number })[] = [];
  let elapsedMs = 0;
  let nextBallId = 1;
  let nextFxId = 1;
  let pickups: Pickup[] = [];
  let nextPickupId = 1;
  let spawnTimerMs = 0;

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

  /**
   * The ball starts at hand height above the feet and flies straight to the aim point, where it
   * lands (or at the end of its range, if the aim is farther away).
   */
  const throwBall = (k: PlayerKey, aimX: number, aimY: number, strong: boolean, solids: Solid[]) => {
    const p = players[k];
    const sx = p.x;
    const sy = p.y - BALL_LIFT;
    const power = throwPower(strong);
    let dx = aimX - sx;
    let dy = aimY - sy;
    let len = Number.isFinite(dx) && Number.isFinite(dy) ? Math.hypot(dx, dy) : 0;
    let flight = Math.min(len, power.range);
    if (len < 1) {
      // Aim on the spawn point: along the facing, full range.
      [dx, dy] = p.dir === 'side' ? [1, 0] : p.dir === 'left' ? [-1, 0] : p.dir === 'up' ? [0, -1] : [0, 1];
      len = 1;
      flight = power.range;
    }
    const kind: Ball['kind'] = p.extraLeft > 0 && p.extra ? p.extra : 'normal';
    const speed = kind === 'riesenball' ? power.speed * c.giantSpeedFactor : power.speed;
    const b: Ball = {
      id: nextBallId++, x: sx, y: sy, vx: (dx / len) * speed, vy: (dy / len) * speed,
      left: flight, total: flight, owner: k, kind, bounces: 0, strong,
    };
    if (kind !== 'normal') {
      p.extraLeft -= 1;
      if (p.extraLeft <= 0) { p.extraLeft = 0; p.extra = null; }
    }
    balls.push(b);
    const ids = spawnIgnores(b.x, b.y, b.vx, b.vy, solids);
    if (ids.length > 0) ignore.set(b.id, ids);
    p.balls -= 1;
    p.reloading = false;
    reloadMs[k] = 0;
    sinceThrowMs[k] = 0;
    if (strong) p.strongCdMs = c.strongCooldownMs;
    p.throwAnimMs = c.throwGapMs;
  };

  /** Spawn one pickup on a random free tile (up to PICKUP_TRIES candidates), or skip. */
  const spawnPickup = (solids: Solid[]) => {
    const kind = PICKUP_KINDS[Math.min(PICKUP_KINDS.length - 1, Math.floor(rand() * PICKUP_KINDS.length))];
    const cols = arena.raster[0]?.length ?? 0;
    for (let i = 0; i < PICKUP_TRIES; i++) {
      const col = Math.min(cols - 1, Math.floor(rand() * cols));
      const row = PLAY_ROWS[0] + Math.min(PLAY_ROWS[1] - PLAY_ROWS[0], Math.floor(rand() * (PLAY_ROWS[1] - PLAY_ROWS[0] + 1)));
      const t = arena.raster[row]?.[col];
      if (t === undefined || t === 'w' || t === 'j') continue;
      const x = (col + 0.5) * arena.tile;
      const y = (row + 0.5) * arena.tile;
      if (solids.some((s) => circleHitsRect(s, x, y, PICKUP_RADIUS))) continue;
      if (keys.some((k) => Math.hypot(players[k].x - x, players[k].y - y) < PICKUP_PLAYER_GAP)) continue;
      pickups.push({ id: nextPickupId++, x, y, kind });
      return;
    }
  };

  const collectPickups = () => {
    for (const k of keys) {
      const p = players[k];
      pickups = pickups.filter((pk) => {
        if (Math.hypot(p.x - pk.x, p.y - pk.y) > PICKUP_COLLECT_PX) return true;
        if (pk.kind === 'eiszapfenmuetze') p.hat = true;
        else { p.extra = pk.kind; p.extraLeft = c.extraThrows; }
        return false;
      });
    }
  };

  /** Returns whether this hit broke the snowman. */
  const hitSnowman = (sm: Snowman): boolean => {
    if (sm.state === 'kaputt' || sm.state === 'aufbau') return false;
    sm.hits += 1;
    if (sm.hits >= c.snowmanHits) {
      sm.state = 'kaputt';
      sm.rebuildMs = c.snowmanRebuildMs;
      return true;
    }
    sm.state = DAMAGE[Math.min(sm.hits, DAMAGE.length - 1)];
    return false;
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
      // Only players with an input this tick (= connected) take part: absent ones can neither shove nor be shoved.
      // Down players neither shove nor can be shoved; their presses are consumed, not queued.
      for (const k of keys) if (players[k].down && inputs[k]) shove[k].edge.take(inputs[k].shoves);
      countShoves(feats, resolveShoves(keys.filter((k) => inputs[k] && !players[k].down), players, shove, inputs));
      // 2. Movement.
      for (const k of keys) {
        const p = players[k];
        const sh = shove[k];
        const stunned = sh.stunMs > 0;
        const slide = stepShove(sh, sec);
        downMs[k] = Math.max(0, downMs[k] - ms);
        p.down = downMs[k] > 1e-6;
        if (p.down) {
          p.vx = 0;
          p.vy = 0;
        } else if (stunned) {
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
        p.strongCdMs = Math.max(0, p.strongCdMs - ms);
        p.throwAnimMs = Math.max(0, p.throwAnimMs - ms);
        sinceThrowMs[k] += ms;
        const h = history[k];
        h.push({ ms: elapsedMs, x: p.x, y: p.y });
        if (h.length > HISTORY_TICKS) h.shift();
      }
      // 2b. Pickups: collect, then spawn on the timer (first one after spawnMs).
      collectPickups();
      spawnTimerMs += ms;
      if (spawnTimerMs >= c.spawnMs - 1e-6) {
        spawnTimerMs -= c.spawnMs;
        if (pickups.length < c.maxPickups) spawnPickup(solids);
      }
      // 3. Throws (one per tick at most; an early left press waits up to throwGapMs, presses without
      // ammo are dropped) and 4. reload.
      for (const k of keys) {
        const p = players[k];
        const inp = inputs[k];
        // Disconnected (no input this tick): no edge is taken, so a reconnect fires no phantom throw.
        if (!inp) {
          pendingMs[k] = 0;
          p.reloading = false;
          reloadMs[k] = 0;
          continue;
        }
        // Both edges every tick: presses are consumed, never queued.
        const normal = taps[k].take(inp.primaryTaps);
        const strong = strongTaps[k].take(inp.secondaryTaps);
        // Stumbling after a shove or lying after a hit: no throw, no reload.
        if (p.stun || p.down) {
          pendingMs[k] = 0;
          p.reloading = false;
          reloadMs[k] = 0;
          continue;
        }
        // Left and right in the same tick: the strong throw wins, the normal press is dropped.
        // throwGapMs only spaces normal throws; after a strong throw strongCooldownMs blocks both.
        if (normal > 0) pendingMs[k] = c.throwGapMs;
        const ready = p.balls >= 1 && p.strongCdMs <= 0;
        if (ready && (strong > 0 || (pendingMs[k] > 0 && sinceThrowMs[k] >= c.throwGapMs))) {
          // A strong throw also uses up a pending left press (left + right together = one ball).
          pendingMs[k] = 0;
          throwBall(k, inp.aimX, inp.aimY, strong > 0, solids);
          continue;
        }
        pendingMs[k] = Math.max(0, pendingMs[k] - ms);
        const held = inp.up || inp.down || inp.left || inp.right;
        const still = Math.hypot(p.vx, p.vy) < 1 && !held;
        const canReload = still && tileAt(arena, p.x, p.y) !== 'j' && p.balls < c.maxBalls;
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
        const targets = keys.filter((k) => inputs[k]).map((k) => seenAt(k, rewind));
        const skip = ignore.get(b.id);
        const fromX = b.x;
        const fromY = b.y;
        const ev = advanceBall(b, sec, arena, skip ? solids.filter((s) => !skip.includes(s.id)) : solids, targets);
        if (skip) {
          const still = ev ? [] : skip.filter((id) => { const s = solids.find((o) => o.id === id); return s && ballOverlaps(s, b.x, b.y); });
          if (still.length > 0) ignore.set(b.id, still); else ignore.delete(b.id);
        }
        if (!ev) { kept.push(b); continue; }
        if (ev.kind === 'player') {
          const v = players[ev.victim];
          if (v.invulnMs > 0) { addFx('zerfall', ev.x, ev.y); continue; }
          if (v.hat) {
            // The ice hat absorbs exactly one hit: no points for anyone.
            v.hat = false;
            v.invulnMs = c.invulnMs;
            addFx('schild_bruch', ev.x, ev.y);
            continue;
          }
          const thrower = players[b.owner];
          if (thrower) thrower.score += c.hitPoints;
          if (thrower && b.owner !== ev.victim) {
            if (!anyHit) feats.award(b.owner, 'schnee_erster');
            anyHit = true;
            if (feats.count(b.owner, 'schnee_serie') >= CONFIG.progress.feats.serie) feats.award(b.owner, 'schnee_serie');
          }
          // A scoring hit taken breaks the victim's streak (ice hat and invulnerable blocks do not).
          feats.reset(ev.victim, 'schnee_serie');
          v.score = Math.max(0, v.score - c.hitPenalty);
          v.invulnMs = c.invulnMs;
          // Knocked down: lies on the ground, cannot act; the shove slide (if any) stops.
          downMs[ev.victim] = c.downMs;
          v.down = true;
          v.vx = 0;
          v.vy = 0;
          v.reloading = false;
          reloadMs[ev.victim] = 0;
          addFx('treffer', ev.x, ev.y);
          continue;
        }
        const sm = ev.kind === 'solid' && ev.solid ? snowmanById.get(ev.solid.id) : undefined;
        if (sm) {
          if (hitSnowman(sm) && players[b.owner]) feats.award(b.owner, 'schnee_schneemann');
          if (sm.state === 'kaputt') solids = solidsNow();
        }
        if (ev.kind === 'solid' && b.kind === 'abpraller' && b.bounces < c.bounces) {
          // Bounce: reflect on the hit normal, keep the remaining flight distance minus the distance flown.
          b.left -= Math.hypot(b.x - fromX, b.y - fromY);
          if (b.left > 1e-6) {
            if (ev.normal === 'x') b.vx = -b.vx; else b.vy = -b.vy;
            b.bounces += 1;
            addFx('abprall', ev.x, ev.y);
            kept.push(b);
            continue;
          }
        }
        addFx('zerfall', ev.x, ev.y);
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
        pickups: pickups.map((pk) => ({ ...pk })),
        fx: fx.map(({ id, kind, x, y }) => ({ id, kind, x, y })),
      };
    },
    result() {
      if (elapsedMs < durationMs) return null;
      const scores = [...new Set(keys.map((k) => players[k].score))].sort((a, b) => b - a);
      return scores.map((s) => keys.filter((k) => players[k].score === s));
    },
    feats() {
      return feats.result();
    },
  };
}

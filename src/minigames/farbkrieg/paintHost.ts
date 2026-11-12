import { CONFIG } from '../../config';
import { neutralInput } from '../../net/protocol';
import { moveCircle, type Arena } from '../common/arena';
import { Edge } from '../common/edges';
import { newShoveSlot, resolveShoves, stepShove, type Facing, type ShoveSlot } from '../common/shove';
import { stepWalker } from '../kartoffel/spudMove';
import type { Mover } from '../common/mover';
import type { GamePlayer, MiniGameHost, PlayerKey } from '../types';
import { advanceBlob, type BlobTarget } from './paintBlobs';
import { createGrid, encodeGrid, PAINT_SPAWNS, paintDisc, paintTile, rankByCount, tileCounts, tileIndex } from './paintGrid';

export type ExtraKind = 'farbbombe' | 'wischmopp' | 'rollschuhe';
export type PaintPlayer = Mover & {
  /** > 0: no new Klecks (counted from the throw). */
  klecksCdMs: number;
  /** > 0 while getüncht (slowed by a hit). */
  slowMs: number;
  /** Held extra, used with the right mouse button (Task 3). */
  extra: ExtraKind | null;
  /** > 0 while the Wischmopp is active (Task 3). */
  moppMs: number;
  /** > 0 while on Rollschuhe (Task 3). */
  rollMs: number;
  stun: boolean;
  swing: boolean;
  shoveCdMs: number;
  /** Tiles of this player's colour (recounted every tick). */
  tiles: number;
  /** > 0 while the throw animation plays. */
  throwAnimMs: number;
};
export type Blob = {
  id: number; x: number; y: number; vx: number; vy: number;
  /** Remaining flight distance in px (the blob lands when it reaches 0). */
  left: number;
  owner: PlayerKey;
  kind: 'klecks' | 'bombe';
};
export type PaintPickup = { id: number; x: number; y: number; kind: ExtraKind };
export type PaintFx = {
  id: number;
  kind: 'wurf' | 'bombe_wurf' | 'platsch' | 'bombe' | 'getuencht' | 'pickup' | 'finale_fall' | 'finale';
  x: number;
  y: number;
  who: PlayerKey | null;
  /** Paint radius of a splash (px), 0 for other kinds. */
  r: number;
  /** getuencht: the thrower, whose colour the victim wears; null for the other kinds. */
  owner: PlayerKey | null;
};
export type PaintState = {
  timeLeftMs: number;
  durationMs: number;
  players: Record<PlayerKey, PaintPlayer>;
  /** encodeGrid of the floor (cols x rows chars), in every snapshot. */
  grid: string;
  blobs: Blob[];
  pickups: PaintPickup[];
  /** Events of the last fxKeepMs (ids grow), so a missed snapshot still shows them. */
  fx: PaintFx[];
  /** `who`: colour of the finale bomb, picked when the fall starts (null while waiting or when nobody was present). */
  finale: { phase: 'wait' | 'fall' | 'done'; fallLeftMs: number; x: number; y: number; who: PlayerKey | null };
};

const START_DIR: Facing = 'down';
const PICKUP_KINDS: readonly ExtraKind[] = ['farbbombe', 'wischmopp', 'rollschuhe'];
/** Tiles around the feet tile that rollers paint (1 = the 3x3 block). */
const ROLL_REACH = 1;
/** Float slack for timers that count down in tick steps. */
const EPS = 1e-6;
/** Length of the throw arm animation (as the shove swing). */
const THROW_ANIM_MS = CONFIG.shove.swingMs;
/** Unit throw direction per facing, used when the aim point is on the feet. */
const FACING_DIR: Record<Facing, readonly [number, number]> = { down: [0, 1], up: [0, -1], side: [1, 0], left: [-1, 0] };

/** Walking speed in px/s: walkSpeed x rollers x getüncht. The client uses it for prediction. */
export function speedOf(p: PaintPlayer): number {
  const c = CONFIG.farbkrieg;
  return c.walkSpeed * (p.rollMs > 0 ? c.rollFactor : 1) * (p.slowMs > 0 ? c.slowFactor : 1);
}

/** Time left (ms) at which the finale starts; scales with the round length (fast mode). */
export function finaleAt(durationMs: number): number {
  const c = CONFIG.farbkrieg;
  return (c.finaleMs * durationMs) / c.durationMs;
}

const countDown = (v: number, ms: number): number => (v - ms > EPS ? v - ms : 0);

/** Host simulation of "Farbkrieg". dt in seconds. */
export function createPaintHost(
  gamePlayers: GamePlayer[],
  rand: () => number,
  arena: Arena,
  durationMs: number = CONFIG.farbkrieg.durationMs,
): MiniGameHost<PaintState> {
  const c = CONFIG.farbkrieg;
  const keys = gamePlayers.map((p) => p.key);
  const slotOf: Record<PlayerKey, number> = {};
  const players: Record<PlayerKey, PaintPlayer> = {};
  const shove: Record<PlayerKey, ShoveSlot> = {};
  const taps: Record<PlayerKey, Edge> = {};
  const extraTaps: Record<PlayerKey, Edge> = {};
  for (const gp of gamePlayers) {
    const [x, y] = PAINT_SPAWNS[gp.slot];
    players[gp.key] = {
      x, y, vx: 0, vy: 0, dir: START_DIR, klecksCdMs: 0, slowMs: 0, extra: null, moppMs: 0, rollMs: 0,
      stun: false, swing: false, shoveCdMs: 0, tiles: 0, throwAnimMs: 0,
    };
    slotOf[gp.key] = gp.slot;
    shove[gp.key] = newShoveSlot();
    taps[gp.key] = new Edge();
    extraTaps[gp.key] = new Edge();
  }
  const grid = createGrid(arena);
  /** Grid owner value of a player (0 is neutral). */
  const colour = (k: PlayerKey) => slotOf[k] + 1;
  let blobs: Blob[] = [];
  const pickups: PaintPickup[] = [];
  const finale: PaintState['finale'] = { phase: 'wait', fallLeftMs: 0, x: arena.w / 2, y: arena.h / 2, who: null };
  let fx: (PaintFx & { atMs: number })[] = [];
  let elapsedMs = 0;
  /** Centres of all paintable tiles (pickup spawn spots). */
  const spots: { x: number; y: number }[] = [];
  for (let i = 0; i < grid.owner.length; i++) {
    if (!grid.paintable[i]) continue;
    spots.push({ x: ((i % grid.cols) + 0.5) * grid.tile, y: (Math.floor(i / grid.cols) + 0.5) * grid.tile });
  }
  let spawnMs = 0;
  let nextPickupId = 1;
  let nextBlobId = 1;
  let nextFxId = 1;

  const addFx = (kind: PaintFx['kind'], x: number, y: number, who: PlayerKey | null, r = 0, owner: PlayerKey | null = null) => {
    fx.push({ id: nextFxId++, kind, x: Math.round(x), y: Math.round(y), who, r, owner, atMs: elapsedMs });
  };

  /** Paintable tiles in the block of `reach` tiles around k's feet tile (none when off the grid). */
  const around = (k: PlayerKey, reach: number): number[] => {
    const p = players[k];
    const i = tileIndex(grid, p.x, p.y);
    if (i === null) return [];
    const col = i % grid.cols;
    const row = Math.floor(i / grid.cols);
    const out: number[] = [];
    for (let r = row - reach; r <= row + reach; r++) {
      for (let cc = col - reach; cc <= col + reach; cc++) {
        if (cc < 0 || r < 0 || cc >= grid.cols || r >= grid.rows) continue;
        if (grid.paintable[r * grid.cols + cc]) out.push(r * grid.cols + cc);
      }
    }
    return out;
  };
  /** Paintable tiles under k's feet: the feet tile, or the 3x3 block around it on rollers. */
  const feetTiles = (k: PlayerKey): number[] => around(k, players[k].rollMs > 0 ? ROLL_REACH : 0);

  /**
   * Feet paint: every present player claims its feet area (with or without a mopp). A tile owned by
   * one of its claimants stays; otherwise rand picks among the claimants, one draw per contested tile.
   * Claimants are collected in slot order, so the result does not depend on the order of players or
   * inputs. Then each mopp turns the foreign tiles in the moppReach block around its feet tile
   * neutral; own and neutral tiles stay, and so do the mopp player's own feet tiles.
   */
  const paintFeet = (present: PlayerKey[]) => {
    const bySlot = [...present].sort((a, b) => slotOf[a] - slotOf[b]);
    const claims = new Map<number, PlayerKey[]>();
    for (const k of bySlot) {
      for (const i of feetTiles(k)) {
        const list = claims.get(i);
        if (list) list.push(k); else claims.set(i, [k]);
      }
    }
    for (const [i, ks] of claims) {
      if (ks.some((k) => grid.owner[i] === colour(k))) continue;
      paintTile(grid, i, colour(ks.length === 1 ? ks[0] : pick(ks)));
    }
    for (const k of bySlot) {
      if (players[k].moppMs <= 0) continue;
      const feet = new Set(feetTiles(k));
      for (const i of around(k, c.moppReach)) {
        if (!feet.has(i) && grid.owner[i] !== 0 && grid.owner[i] !== colour(k)) paintTile(grid, i, 0);
      }
    }
  };

  /**
   * A blob from k's feet toward the aim point; it flies min(distance, blobRange), so it lands on the
   * aim point when that is in range. An aim on the feet (or a broken one) splashes at the feet.
   */
  const throwBlob = (k: PlayerKey, aimX: number, aimY: number, kind: Blob['kind']) => {
    const p = players[k];
    let dx = aimX - p.x;
    let dy = aimY - p.y;
    let len = Number.isFinite(dx) && Number.isFinite(dy) ? Math.hypot(dx, dy) : 0;
    let flight = Math.min(len, c.blobRange);
    if (!(len > EPS)) {
      [dx, dy] = FACING_DIR[p.dir];
      len = 1;
      flight = 0;
    }
    blobs.push({
      id: nextBlobId++, x: p.x, y: p.y, vx: (dx / len) * c.blobSpeed, vy: (dy / len) * c.blobSpeed,
      left: flight, owner: k, kind,
    });
    p.throwAnimMs = THROW_ANIM_MS;
    addFx(kind === 'bombe' ? 'bombe_wurf' : 'wurf', p.x, p.y, k);
  };

  /** True from finaleAt(durationMs) before the end: bigger Klecks, finale bomb. */
  const inFinale = () => durationMs - elapsedMs <= finaleAt(durationMs) + EPS;
  const paintR = (kind: Blob['kind']) => (kind === 'bombe' ? c.bombPaintR : inFinale() ? c.klecksPaintR * c.finaleKlecksFactor : c.klecksPaintR);
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

  /** One new pickup on a free paintable tile far from every present player, or none after pickupTries tries. */
  const spawnPickup = (present: PlayerKey[]) => {
    for (let i = 0; i < c.pickupTries && spots.length > 0; i++) {
      const spot = pick(spots);
      if (pickups.some((pk) => pk.x === spot.x && pk.y === spot.y)) continue;
      if (present.some((k) => Math.hypot(players[k].x - spot.x, players[k].y - spot.y) < c.pickupClearPx)) continue;
      pickups.push({ id: nextPickupId++, x: spot.x, y: spot.y, kind: pick(PICKUP_KINDS) });
      return;
    }
  };

  /** Right click: use the held extra. */
  const useExtra = (k: PlayerKey, aimX: number, aimY: number) => {
    const p = players[k];
    const extra = p.extra;
    if (extra === null) return;
    p.extra = null;
    if (extra === 'farbbombe') throwBlob(k, aimX, aimY, 'bombe');
    else if (extra === 'wischmopp') p.moppMs = c.moppMs;
    else p.rollMs = c.rollMs;
  };

  /** The present player with the fewest tiles (ties by rand), null when nobody is present. */
  const fewestTiles = (present: PlayerKey[]): PlayerKey | null => {
    if (present.length === 0) return null;
    const counts = tileCounts(grid);
    const fewest = Math.min(...present.map((k) => counts[colour(k)]));
    return pick(present.filter((k) => counts[colour(k)] === fewest));
  };

  /** Finale bomb: lands in the colour picked when the fall started; re-picked if that player is gone. */
  const explodeFinale = (present: PlayerKey[]) => {
    finale.phase = 'done';
    const who = finale.who !== null && present.includes(finale.who) ? finale.who : fewestTiles(present);
    finale.who = who;
    if (who !== null) paintDisc(grid, finale.x, finale.y, c.finalePaintR, colour(who));
    addFx('finale', finale.x, finale.y, who, c.finalePaintR);
  };

  return {
    tick(dt, inputs) {
      if (elapsedMs >= durationMs - EPS) return;
      const ms = Math.min(dt * 1000, durationMs - elapsedMs);
      const sec = ms / 1000;
      fx = fx.filter((f) => elapsedMs - f.atMs < c.fxKeepMs);
      /** Present players (input this tick) act, paint, can be hit and shoved; absent ones stand still. */
      const present = keys.filter((k) => inputs[k] !== undefined);

      // 1. Shoves (present players only).
      resolveShoves(present, players, shove, inputs);

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
          Object.assign(p, stepWalker(p, inputs[k] ?? neutralInput(), sec, arena, speedOf(p), c.bodyRadius));
        }
        p.stun = sh.stunMs > 0;
        p.swing = sh.swingMs > 0;
        p.shoveCdMs = Math.ceil(sh.cooldownMs);
        p.klecksCdMs = countDown(p.klecksCdMs, ms);
        p.slowMs = countDown(p.slowMs, ms);
        p.moppMs = countDown(p.moppMs, ms);
        p.rollMs = countDown(p.rollMs, ms);
        p.throwAnimMs = countDown(p.throwAnimMs, ms);
      }

      // 3. Feet paint.
      paintFeet(present);

      // 4. Klecks taps (left click). Absent players take no edge; a tap in the cooldown or while
      // stunned is dropped, not queued.
      for (const k of present) {
        const inp = inputs[k];
        const p = players[k];
        if (taps[k].take(inp.primaryTaps) === 0) continue;
        if (p.stun || p.klecksCdMs > 0) continue;
        p.klecksCdMs = c.klecksCooldownMs;
        throwBlob(k, inp.aimX, inp.aimY, 'klecks');
      }

      // 5. Extras: pickups spawn every pickupSpawnMs; present players without an extra take them by
      // touch; then right clicks use the held extra (not while stunned; absent players take no edge).
      spawnMs += ms;
      if (spawnMs >= c.pickupSpawnMs - EPS) {
        spawnMs = 0;
        if (pickups.length < c.maxPickups) spawnPickup(present);
      }
      for (const pk of [...pickups]) {
        let taker: PlayerKey | null = null;
        let takerD = c.pickupTouchPx;
        for (const k of present) {
          if (players[k].extra !== null) continue;
          const d = Math.hypot(players[k].x - pk.x, players[k].y - pk.y);
          if (d <= takerD) { taker = k; takerD = d; }
        }
        if (!taker) continue;
        pickups.splice(pickups.indexOf(pk), 1);
        players[taker].extra = pk.kind;
        addFx('pickup', pk.x, pk.y, taker);
      }
      for (const k of present) {
        const inp = inputs[k];
        if (extraTaps[k].take(inp.secondaryTaps) === 0 || players[k].stun) continue;
        useExtra(k, inp.aimX, inp.aimY);
      }

      // 6. Blobs in id order (a later blob paints over an earlier one). Absent players are not hit.
      const targets: BlobTarget[] = present.map((k) => ({ key: k, x: players[k].x, y: players[k].y }));
      const flying: Blob[] = [];
      for (const b of blobs) {
        const ev = advanceBlob(b, sec, arena, targets);
        if (!ev) { flying.push(b); continue; }
        const r = paintR(b.kind);
        paintDisc(grid, ev.x, ev.y, r, colour(b.owner));
        if (ev.kind === 'player') {
          players[ev.victim].slowMs = c.slowMs;
          addFx('getuencht', ev.x, ev.y, ev.victim, r, b.owner);
        } else {
          addFx(b.kind === 'bombe' ? 'bombe' : 'platsch', ev.x, ev.y, b.owner, r);
        }
      }
      blobs = flying;

      // 7. Finale: from finaleAt(durationMs) the bomb falls for finaleFallMs, then explodes once.
      if (finale.phase === 'wait' && inFinale()) {
        finale.phase = 'fall';
        finale.fallLeftMs = c.finaleFallMs;
        finale.who = fewestTiles(present);
        addFx('finale_fall', finale.x, finale.y, finale.who);
      } else if (finale.phase === 'fall') {
        finale.fallLeftMs = countDown(finale.fallLeftMs, ms);
        if (finale.fallLeftMs <= 0) explodeFinale(present);
      }

      // 8. Tile counts from the grid.
      const counts = tileCounts(grid);
      for (const k of keys) players[k].tiles = counts[colour(k)];

      // 9. Timer.
      elapsedMs += ms;
    },
    snapshot() {
      const ps: Record<PlayerKey, PaintPlayer> = {};
      for (const k of keys) ps[k] = { ...players[k] };
      return {
        timeLeftMs: Math.max(0, Math.ceil(durationMs - elapsedMs - EPS)),
        durationMs,
        players: ps,
        grid: encodeGrid(grid),
        blobs: blobs.map((b) => ({ ...b })),
        pickups: pickups.map((pk) => ({ ...pk })),
        fx: fx.map(({ id, kind, x, y, who, r, owner }) => ({ id, kind, x, y, who, r, owner })),
        finale: { ...finale },
      };
    },
    result() {
      if (elapsedMs < durationMs - EPS) return null;
      const counts: Record<PlayerKey, number> = {};
      for (const k of keys) counts[k] = players[k].tiles;
      return rankByCount(counts);
    },
  };
}

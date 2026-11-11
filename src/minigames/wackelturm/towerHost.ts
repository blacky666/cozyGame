import Matter from 'matter-js';
import { CONFIG } from '../../config';
import type { InputState } from '../../net/protocol';
import { Edge } from '../common/edges';
import { rankByCount } from '../farbkrieg/paintGrid';
import type { GamePlayer, MiniGameHost, PlayerKey } from '../types';
import type { Plot, TowerLayout } from './towerLayout';
import {
  atRest, blockKind, blockPose, createTowerWorld, FIES_KINDS, KINDS, NORMAL_KINDS, removeBlock, shapeSize, spawnBlock,
  stepWorld, type Kind, type Rot, type TowerWorld,
} from './towerPhysics';

/** Ärger-Aktion armed with the right mouse button (Task 4). */
export type ArmedAction = 'wind' | 'fies';
export type TowerPlayer = {
  /** Index into layout.plots. */
  plot: number;
  /** Pivot x of the hanging block (world x). */
  craneX: number;
  /** Top edge of the hanging block (world y); rises with the tower. */
  hangTop: number;
  hang: { kind: Kind; rot: Rot } | null;
  /** > 0: drop cooldown, no block hangs. */
  cdMs: number;
  /** Rested height above the foundation (px) and the best of the round. */
  heightPx: number;
  bestPx: number;
  /** Blocks that rested restHoldMs (charges count these, not drops). */
  placed: number;
  charges: number;
  armed: ArmedAction | null;
  /** Windstoß on this tower (mirrors the world). */
  windMs: number;
  windDir: -1 | 1;
  /** Flat [id, kindIndex, round(x × 10), round(y × 10), round(angle × 100)] per block; x/y is the pivot. */
  blocks: number[];
};
export type TowerFx = {
  id: number;
  kind: 'drop' | 'land' | 'weg' | 'wackel' | 'einsturz' | 'hoehe' | 'wind' | 'fies' | 'ziel';
  /** Whose tower. */
  who: PlayerKey;
  x: number;
  y: number;
  /** wind / fies: the player who used the action; null otherwise. */
  by: PlayerKey | null;
  /** land: a mean (FIES) block. */
  stone: boolean;
  /** wackel: the block moves more sideways than vertically. */
  slide: boolean;
};
export type TowerState = {
  timeLeftMs: number;
  durationMs: number;
  /** Goal height above the foundation (CONFIG, not the asset marker). */
  goalPx: number;
  players: Record<PlayerKey, TowerPlayer>;
  /** Events of the last fxKeepMs (ids grow), so a missed snapshot still shows them. */
  fx: TowerFx[];
  /** First to reach goalPx (lowest slot among same-tick reachers); null until then and on timeout. */
  winner: PlayerKey | null;
};
export type TowerHost = MiniGameHost<TowerState> & {
  /** Test hook: the player's physics world. */
  __world(k: PlayerKey): TowerWorld;
};

/** Plot index of the column under aimX (column bounds, right edge exclusive), or null outside all columns. */
export function columnAt(layout: TowerLayout, aimX: number): number | null {
  const i = layout.plots.findIndex((pl) => aimX >= pl.minX && aimX < pl.maxX);
  return i < 0 ? null : i;
}

/** Float slack for timers that count down in tick steps. */
const EPS = 1e-6;
/** Snapshot precision: positions in 1/10 px, angles in 1/100 rad, crane values in 1/100 px. */
const POS_SCALE = 10;
const ANGLE_SCALE = 100;
const CRANE_SCALE = 100;
const QUARTER_TURNS = 4;
/** rand() below this picks wind direction left. */
const WIND_LEFT_BELOW = 0.5;
const TAU = 2 * Math.PI;

/** Angle in (−π, π]. */
const wrapAngle = (a: number): number => a - TAU * Math.ceil((a - Math.PI) / TAU);

/** The pivot x range that keeps the hanging block inside the column. */
export function craneBounds(plot: Plot, kind: Kind, rot: Rot): { min: number; max: number } {
  const half = shapeSize(kind, rot).w / 2;
  return { min: plot.minX + half, max: plot.maxX - half };
}

const clamp = (v: number, b: { min: number; max: number }) => Math.min(b.max, Math.max(b.min, v));

/** Crane x after dt seconds of A/D (shared with the client prediction). */
export function stepCrane(x: number, input: InputState, dt: number, b: { min: number; max: number }): number {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  return clamp(x + dir * CONFIG.wackelturm.craneSpeed * dt, b);
}

/** Time left (ms) at which the finale music starts; scales with the round length (fast mode). */
export function finaleAt(durationMs: number): number {
  const c = CONFIG.wackelturm;
  return (c.finaleMs * durationMs) / c.durationMs;
}

const countDown = (v: number, ms: number): number => (v - ms > EPS ? v - ms : 0);
const moveToward = (v: number, target: number, step: number): number =>
  Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;

/** Per-body bookkeeping. `landed`: had a collision; `placed`: rested restHoldMs once. */
type Meta = { id: number; kind: Kind; restMs: number; landed: boolean; placed: boolean };
const EDGE_COUNTERS = ['primaryTaps', 'secondaryTaps', 'turnsCw', 'turnsCcw', 'drops'] as const;
type Presses = Record<(typeof EDGE_COUNTERS)[number], number>;
type Edges = Record<(typeof EDGE_COUNTERS)[number], Edge>;
const newEdges = (): Edges =>
  Object.fromEntries(EDGE_COUNTERS.map((c) => [c, new Edge()])) as Edges;

/** Host-only state per player. */
type Slot = {
  world: TowerWorld;
  metas: Map<Matter.Body, Meta>;
  /** Bodies that collided during the last stepWorld. */
  hits: Set<Matter.Body>;
  /** Index into the shared normal sequence. */
  seqIndex: number;
  /** Mean blocks waiting (Task 4); they come before the sequence. */
  fiesQueue: Kind[];
  /** True while the crane has not reached its target height (no drops). */
  rising: boolean;
  /** > 0: no new wackel fx. */
  wobbleMs: number;
  /** How long a resting placed block has stood at or above goalPx without a break. */
  goalMs: number;
  edges: Edges;
};

/** Host simulation of "Wackel-Turm". dt in seconds. Players get plots in slot order. */
export function createTowerHost(
  gamePlayers: GamePlayer[],
  rand: () => number,
  layout: TowerLayout,
  durationMs: number = CONFIG.wackelturm.durationMs,
): TowerHost {
  const c = CONFIG.wackelturm;
  const sorted = [...gamePlayers].sort((a, b) => a.slot - b.slot);
  const keys = sorted.map((p) => p.key);
  const slotOf: Record<PlayerKey, number> = {};
  const players: Record<PlayerKey, TowerPlayer> = {};
  const slots: Record<PlayerKey, Slot> = {};
  /** The shared normal sequence, drawn on demand: the k-th block is the same for everyone. */
  const seq: Kind[] = [];
  let fx: (TowerFx & { atMs: number })[] = [];
  let elapsedMs = 0;
  let winner: PlayerKey | null = null;
  let reachers: PlayerKey[] = [];
  let nextBlockId = 1;
  let nextFxId = 1;

  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  const kindAt = (i: number): Kind => {
    while (seq.length <= i) seq.push(pick(NORMAL_KINDS));
    return seq[i];
  };
  /** Next block for k: the fies queue first, else the shared sequence. */
  const nextKind = (k: PlayerKey): Kind => {
    const s = slots[k];
    return s.fiesQueue.shift() ?? kindAt(s.seqIndex++);
  };
  const plotOf = (k: PlayerKey) => layout.plots[players[k].plot];
  const boundsOf = (k: PlayerKey) => {
    const h = players[k].hang;
    const plot = plotOf(k);
    return h ? craneBounds(plot, h.kind, h.rot) : { min: plot.minX, max: plot.maxX };
  };

  const addFx = (
    kind: TowerFx['kind'], who: PlayerKey, x: number, y: number,
    extra: Partial<Pick<TowerFx, 'by' | 'stone' | 'slide'>> = {},
  ) => {
    fx.push({
      id: nextFxId++, kind, who, x: Math.round(x), y: Math.round(y),
      by: extra.by ?? null, stone: extra.stone ?? false, slide: extra.slide ?? false, atMs: elapsedMs,
    });
  };

  sorted.forEach((gp, i) => {
    const world = createTowerWorld(layout, i);
    const hits = new Set<Matter.Body>();
    Matter.Events.on(world.engine, 'collisionStart', (e: Matter.IEventCollision<Matter.Engine>) => {
      for (const pair of e.pairs) {
        for (const b of [pair.bodyA.parent, pair.bodyB.parent]) if (!b.isStatic) hits.add(b);
      }
    });
    slotOf[gp.key] = gp.slot;
    slots[gp.key] = {
      world, metas: new Map(), hits, seqIndex: 0, fiesQueue: [], rising: false, wobbleMs: 0, goalMs: 0, edges: newEdges(),
    };
    players[gp.key] = {
      plot: i, craneX: layout.plots[i].left + layout.hookOffsetX, hangTop: layout.hangTopStart, hang: null, cdMs: 0,
      heightPx: 0, bestPx: 0, placed: 0, charges: 0, armed: null, windMs: 0, windDir: 1, blocks: [],
    };
  });
  for (const k of keys) {
    players[k].hang = { kind: nextKind(k), rot: 0 };
    players[k].craneX = clamp(players[k].craneX, boundsOf(k));
  }

  /** Steps 2–4 for a present player: rotate, move the crane, drop. */
  const act = (k: PlayerKey, inp: InputState, n: Presses, sec: number) => {
    const p = players[k];
    const turn = n.turnsCw - n.turnsCcw;
    if (p.hang && turn !== 0) {
      p.hang.rot = ((((p.hang.rot + turn) % QUARTER_TURNS) + QUARTER_TURNS) % QUARTER_TURNS) as Rot;
    }
    p.craneX = stepCrane(p.craneX, inp, sec, boundsOf(k));
    // Right click cycles none -> wind -> fies -> none (only with a charge); a left click while armed
    // fires or cancels and never drops.
    for (let i = 0; i < n.secondaryTaps; i++) p.armed = cycleArmed(p);
    const armedClick = n.primaryTaps > 0 && p.armed !== null;
    if (armedClick) fire(k, inp.aimX);
    const wantDrop = n.drops > 0 || (n.primaryTaps > 0 && !armedClick);
    if (wantDrop && p.hang && !slots[k].rising) drop(k);
  };

  const cycleArmed = (p: TowerPlayer): ArmedAction | null => {
    if (p.armed === 'wind') return 'fies';
    if (p.armed === 'fies') return null;
    return p.charges > 0 ? 'wind' : null;
  };

  /** Left click while armed: another player's column fires (one charge), anything else cancels. */
  const fire = (k: PlayerKey, aimX: number) => {
    const p = players[k];
    const action = p.armed;
    p.armed = null;
    const col = columnAt(layout, aimX);
    const target = col === null ? undefined : keys[col];
    if (!action || target === undefined || target === k || p.charges <= 0) return;
    p.charges--;
    const t = players[target];
    const x = plotOf(target).centre;
    if (action === 'wind') {
      const w = slots[target].world;
      w.windMs = c.windMs;
      w.windDir = rand() < WIND_LEFT_BELOW ? -1 : 1;
      t.windMs = Math.ceil(w.windMs);
      t.windDir = w.windDir;
      addFx('wind', target, x, layout.surfaceY - t.heightPx, { by: k });
      return;
    }
    const mean = pick(FIES_KINDS);
    if (t.hang) {
      // Swap the hanging block now; the normal one comes right after.
      slots[target].fiesQueue.unshift(t.hang.kind);
      t.hang = { kind: mean, rot: t.hang.rot };
      t.craneX = clamp(t.craneX, boundsOf(target));
    } else {
      slots[target].fiesQueue.push(mean);
    }
    addFx('fies', target, x, t.hangTop, { by: k });
  };

  const drop = (k: PlayerKey) => {
    const p = players[k];
    const hang = p.hang;
    if (!hang) return;
    const y = p.hangTop + shapeSize(hang.kind, hang.rot).h / 2;
    const body = spawnBlock(slots[k].world, hang.kind, p.craneX, y, hang.rot);
    track(slots[k], body);
    addFx('drop', k, p.craneX, y);
    p.hang = null;
    p.cdMs = c.dropCooldownMs;
  };

  const track = (s: Slot, body: Matter.Body): Meta => {
    let m = s.metas.get(body);
    if (!m) {
      m = { id: nextBlockId++, kind: blockKind(body), restMs: 0, landed: false, placed: false };
      s.metas.set(body, m);
    }
    return m;
  };

  /** Step 6: landing, wobble, removal, placing. */
  const updateBodies = (k: PlayerKey, ms: number) => {
    const s = slots[k];
    const p = players[k];
    const plot = plotOf(k);
    for (const body of [...s.world.engine.world.bodies]) {
      if (body.isStatic) continue;
      const m = track(s, body);
      const pose = blockPose(body);
      if (!m.landed && s.hits.has(body)) {
        m.landed = true;
        addFx('land', k, pose.x, pose.y, { stone: FIES_KINDS.includes(m.kind) });
      }
      const out = body.position.x < plot.minX || body.position.x > plot.maxX || body.position.y > layout.surfaceY + c.fallMarginPx;
      if (out) {
        removeBlock(s.world, body);
        s.metas.delete(body);
        addFx('weg', k, pose.x, pose.y);
        continue;
      }
      m.restMs = atRest(body) ? m.restMs + ms : 0;
      if (m.placed && body.speed > c.wobbleSpeed && s.wobbleMs <= 0) {
        s.wobbleMs = c.wobbleGapMs;
        addFx('wackel', k, pose.x, pose.y, { slide: Math.abs(body.velocity.x) > Math.abs(body.velocity.y) });
      }
      if (!m.placed && m.restMs >= c.restHoldMs - EPS) {
        m.placed = true;
        p.placed++;
        if (p.placed % c.chargeEvery === 0) p.charges = Math.min(c.chargeCap, p.charges + 1);
      }
    }
    s.hits.clear();
  };

  /**
   * Step 7: height, goal hold and crane height. The height counts placed blocks that are not wobbling
   * (speed ≤ wobbleSpeed, angular speed ≤ wobbleAngSpeed), so a small jolt from a landing block does not
   * flicker the height while a toppling tower drops out at once. Rounded, because resting bodies sink a
   * fraction of a pixel into each other. The goal is stricter: a placed block at rest must reach goalPx
   * and something must stay there for goalHoldMs (goalMs).
   */
  const updateHeight = (k: PlayerKey, ms: number) => {
    const sec = ms / 1000;
    const s = slots[k];
    const p = players[k];
    const plot = plotOf(k);
    let landedTop = layout.surfaceY;
    let restedTop = layout.surfaceY;
    let goalTop = layout.surfaceY;
    for (const [body, m] of s.metas) {
      if (m.landed) landedTop = Math.min(landedTop, body.bounds.min.y);
      if (!m.placed) continue;
      if (body.speed <= c.wobbleSpeed && body.angularSpeed <= c.wobbleAngSpeed) restedTop = Math.min(restedTop, body.bounds.min.y);
      if (atRest(body)) goalTop = Math.min(goalTop, body.bounds.min.y);
    }
    s.goalMs = Math.round(layout.surfaceY - goalTop) >= c.goalPx ? s.goalMs + ms : 0;
    const h = Math.max(0, Math.round(layout.surfaceY - restedTop));
    if (h > p.bestPx) {
      p.bestPx = h;
      addFx('hoehe', k, plot.centre, layout.surfaceY - h);
    }
    if (p.heightPx - h >= c.collapseDropPx) addFx('einsturz', k, plot.centre, layout.surfaceY - p.heightPx);
    p.heightPx = h;
    const target = Math.min(layout.hangTopStart, landedTop - c.craneClearPx);
    p.hangTop = moveToward(p.hangTop, target, c.craneRiseSpeed * sec);
    s.rising = p.hangTop !== target;
  };

  const encodeBlocks = (s: Slot): number[] => {
    const out: number[] = [];
    for (const [body, m] of s.metas) {
      const pose = blockPose(body);
      out.push(m.id, KINDS.indexOf(m.kind), Math.round(pose.x * POS_SCALE), Math.round(pose.y * POS_SCALE), Math.round(wrapAngle(pose.a) * ANGLE_SCALE));
    }
    return out;
  };

  const over = () => winner !== null || elapsedMs >= durationMs - EPS;

  return {
    tick(dt, inputs) {
      if (over()) return;
      const ms = Math.min(dt * 1000, durationMs - elapsedMs);
      const sec = ms / 1000;
      fx = fx.filter((f) => elapsedMs - f.atMs < c.fxKeepMs);
      // Timers count down before the drop, so a drop's cooldown lasts exactly dropCooldownMs.
      for (const k of keys) {
        players[k].cdMs = countDown(players[k].cdMs, ms);
        slots[k].wobbleMs = countDown(slots[k].wobbleMs, ms);
      }

      // 1–4. Input edges, rotation, crane, drop. An absent player's edges start fresh, so counters
      // pressed while away are a baseline on return, not presses.
      for (const k of keys) {
        const inp = inputs[k];
        if (inp === undefined) {
          slots[k].edges = newEdges();
          players[k].armed = null;
          continue;
        }
        const e = slots[k].edges;
        const n = Object.fromEntries(EDGE_COUNTERS.map((cn) => [cn, e[cn].take(inp[cn])])) as Presses;
        act(k, inp, n, sec);
      }

      // 5. Physics for every tower (absent players' too).
      for (const k of keys) stepWorld(slots[k].world, ms);

      for (const k of keys) {
        // 6. Bodies; 7. height and crane.
        updateBodies(k, ms);
        updateHeight(k, ms);
        // 8. A new block after the cooldown, crane x kept and clamped.
        const p = players[k];
        if (!p.hang && p.cdMs <= 0) {
          p.hang = { kind: nextKind(k), rot: 0 };
          p.craneX = clamp(p.craneX, boundsOf(k));
        }
        p.windMs = Math.ceil(slots[k].world.windMs);
        p.windDir = slots[k].world.windDir;
      }

      // 9. Goal: the round ends in the first tick any resting block has held goalPx for goalHoldMs.
      reachers = keys.filter((k) => slots[k].goalMs >= c.goalHoldMs - EPS).sort((a, b) => slotOf[a] - slotOf[b]);
      if (reachers.length > 0) {
        winner = reachers[0];
        addFx('ziel', winner, plotOf(winner).centre, layout.surfaceY - c.goalPx);
      }

      // 10. Timer.
      elapsedMs += ms;
    },
    snapshot() {
      const ps: Record<PlayerKey, TowerPlayer> = {};
      for (const k of keys) {
        const p = players[k];
        ps[k] = {
          ...p,
          craneX: Math.round(p.craneX * CRANE_SCALE) / CRANE_SCALE,
          hangTop: Math.round(p.hangTop * CRANE_SCALE) / CRANE_SCALE,
          hang: p.hang ? { ...p.hang } : null,
          cdMs: Math.ceil(p.cdMs - EPS),
          blocks: encodeBlocks(slots[k]),
        };
      }
      return {
        timeLeftMs: Math.max(0, Math.ceil(durationMs - elapsedMs - EPS)),
        durationMs,
        goalPx: c.goalPx,
        players: ps,
        fx: fx.map(({ id, kind, who, x, y, by, stone, slide }) => ({ id, kind, who, x, y, by, stone, slide })),
        winner,
      };
    },
    result() {
      if (!over()) return null;
      const heights: Record<PlayerKey, number> = {};
      for (const k of keys) if (!reachers.includes(k)) heights[k] = players[k].heightPx;
      const rest = rankByCount(heights);
      return reachers.length > 0 ? [[...reachers], ...rest] : rest;
    },
    __world(k) {
      return slots[k].world;
    },
  };
}

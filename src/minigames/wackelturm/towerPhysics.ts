import Matter from 'matter-js';
import { CONFIG } from '../../config';
import type { Plot, TowerLayout } from './towerLayout';

const { Bodies, Body, Bounds, Composite, Engine, Sleeping } = Matter;

/**
 * Matter's motion threshold for falling asleep is a module-level internal (Sleeping._motionSleepThreshold,
 * not in the typings) shared by every engine; the towers are the only Matter user, so it is set once here.
 */
(Sleeping as unknown as { _motionSleepThreshold: number })._motionSleepThreshold = CONFIG.wackelturm.sleepMotion;

/** Block kinds; the snapshot sends the index into this list. */
export const KINDS = ['quader', 'kurz', 'lang', 'l', 't', 'kugel', 'dreieck', 'wackelstein'] as const;
export type Kind = (typeof KINDS)[number];
export const NORMAL_KINDS = KINDS.slice(0, 5) as readonly Kind[];
export const FIES_KINDS = KINDS.slice(5) as readonly Kind[];

/** Rotation in 90° steps clockwise. */
export type Rot = 0 | 1 | 2 | 3;

/** Cell size of the block sprites (px). */
const CELL = 16;

/** Sprite cells per kind (rows top to bottom, 'X' = filled), as in the asset's `zellen`; a test pins them. */
export const CELLS: Record<Kind, readonly string[]> = {
  quader: ['XX'],
  kurz: ['X'],
  lang: ['XXXX'],
  l: ['X.', 'X.', 'XX'],
  t: ['XXX', '.X.'],
  kugel: ['X'],
  dreieck: ['XX'],
  wackelstein: ['XX'],
};

/** Outlines relative to the pivot (sprite centre), read off the sprites. */
const DREIECK: readonly [number, number][] = [[-15, 7], [15, 7], [0, -8]];
const WACKELSTEIN: readonly [number, number][] = [
  [-8, -8], [5, -8], [12, -4], [16, 0], [13, 6], [8, 8], [-8, 8], [-14, 4], [-16, 0], [-12, -6],
];
const KUGEL_R = 8;

export type TowerWorld = { engine: Matter.Engine; plot: Plot; acc: number; windMs: number; windDir: -1 | 1 };

/** Sprite size of a kind at a rotation (odd rotations swap w and h). */
export function shapeSize(kind: Kind, rot: Rot): { w: number; h: number } {
  const rows = CELLS[kind];
  const w = rows[0].length * CELL;
  const h = rows.length * CELL;
  return rot % 2 === 1 ? { w: h, h: w } : { w, h };
}

/** One physics world per player: gravity and a static foundation; no ground or walls. */
export function createTowerWorld(layout: TowerLayout, plotIndex: number): TowerWorld {
  const plot = layout.plots[plotIndex];
  if (!plot) throw new Error(`wackelturm: no plot ${plotIndex}`);
  const engine = Engine.create({
    enableSleeping: true,
    positionIterations: CONFIG.wackelturm.positionIterations,
    velocityIterations: CONFIG.wackelturm.velocityIterations,
  });
  engine.gravity.x = 0;
  engine.gravity.y = CONFIG.wackelturm.gravityY;
  const fh = CELL;
  const foundation = Bodies.rectangle(plot.centre, layout.surfaceY + fh / 2, plot.w, fh, {
    isStatic: true,
    friction: CONFIG.wackelturm.friction,
    frictionStatic: CONFIG.wackelturm.frictionStatic,
    restitution: CONFIG.wackelturm.restitution,
    slop: CONFIG.wackelturm.slop,
  });
  Composite.add(engine.world, foundation);
  return { engine, plot: { ...plot }, acc: 0, windMs: 0, windDir: 1 };
}

function material() {
  const c = CONFIG.wackelturm;
  return { friction: c.friction, frictionStatic: c.frictionStatic, restitution: c.restitution, density: c.density, slop: c.slop };
}

/** Builds the body at angle 0 with its pivot at (px, py). */
function buildBody(kind: Kind, px: number, py: number): Matter.Body {
  const opts = material();
  if (kind === 'kugel') return Bodies.circle(px, py, KUGEL_R, opts);
  if (kind === 'dreieck' || kind === 'wackelstein') {
    const pts = kind === 'dreieck' ? DREIECK : WACKELSTEIN;
    const body = Bodies.fromVertices(px, py, [pts.map(([x, y]) => ({ x: px + x, y: py + y }))], opts);
    // fromVertices centres the outline on its centre of mass; shift it so the outline sits on the pivot again.
    const want = Bounds.create(pts.map(([x, y]) => ({ x: px + x, y: py + y })));
    Body.translate(body, { x: want.min.x - body.bounds.min.x, y: want.min.y - body.bounds.min.y });
    return body;
  }
  const rows = CELLS[kind];
  const { w, h } = shapeSize(kind, 0);
  const parts: Matter.Body[] = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== 'X') continue;
      parts.push(Bodies.rectangle(px - w / 2 + c * CELL + CELL / 2, py - h / 2 + r * CELL + CELL / 2, CELL, CELL, opts));
    }
  });
  if (parts.length === 1) return parts[0];
  const body = Body.create({ ...opts, parts });
  Body.setInertia(body, compoundInertia(body));
  return body;
}

/** Matter's inertia scale (Body._inertiaScale, 4 in 0.20); not in the typings. */
const INERTIA_SCALE = (Body as unknown as { _inertiaScale: number })._inertiaScale;

/**
 * Matter sums the part inertias of a compound without the parallel-axis term, so a lang of four cells would
 * spin about 8.5x too easily. This adds part.mass x distance² for every part (in Matter's scaled units).
 */
function compoundInertia(body: Matter.Body): number {
  let sum = 0;
  for (const part of body.parts.slice(1)) {
    const dx = part.position.x - body.position.x;
    const dy = part.position.y - body.position.y;
    sum += part.inertia / INERTIA_SCALE + part.mass * (dx * dx + dy * dy);
  }
  return INERTIA_SCALE * sum;
}

/**
 * Adds a block with its pivot (sprite centre) at (pivotX, pivotY), rotated rot × 90° clockwise about the pivot.
 * The body's position is its centre of mass; plugin.pivot keeps the pivot offset in body space.
 */
export function spawnBlock(w: TowerWorld, kind: Kind, pivotX: number, pivotY: number, rot: Rot): Matter.Body {
  const body = buildBody(kind, pivotX, pivotY);
  body.plugin = { ...(body.plugin ?? {}), kind, pivot: { x: pivotX - body.position.x, y: pivotY - body.position.y } };
  if (rot !== 0) {
    // Rotate about the pivot: turn the body, then swing its centre of mass around the pivot.
    const a = (rot * Math.PI) / 2;
    const dx = body.position.x - pivotX;
    const dy = body.position.y - pivotY;
    Body.rotate(body, a);
    Body.setPosition(body, { x: pivotX + dx * Math.cos(a) - dy * Math.sin(a), y: pivotY + dx * Math.sin(a) + dy * Math.cos(a) });
  }
  wakeAll(w);
  Composite.add(w.engine.world, body);
  return body;
}

/** The kind spawnBlock stored on the body. */
export function blockKind(b: Matter.Body): Kind {
  const kind = (b.plugin as { kind?: Kind } | undefined)?.kind;
  if (!kind) throw new Error('wackelturm: body without a block kind');
  return kind;
}

/** Takes a block out of the world and wakes every other body, so nothing stays floating. */
export function removeBlock(w: TowerWorld, b: Matter.Body): void {
  Composite.remove(w.engine.world, b);
  wakeAll(w);
}

/** Wakes every block: the tower changed, or a force (wind) acts that sleeping bodies would ignore. */
function wakeAll(w: TowerWorld): void {
  for (const b of w.engine.world.bodies) if (!b.isStatic) Sleeping.set(b, false);
}

/** The pivot in world coordinates and the body angle. */
export function blockPose(b: Matter.Body): { x: number; y: number; a: number } {
  const pv = (b.plugin as { pivot?: { x: number; y: number } } | undefined)?.pivot ?? { x: 0, y: 0 };
  const cos = Math.cos(b.angle);
  const sin = Math.sin(b.angle);
  return { x: b.position.x + pv.x * cos - pv.y * sin, y: b.position.y + pv.x * sin + pv.y * cos, a: b.angle };
}

/** Tolerance so that frame sums like 60 × 1000/30 still give the full number of steps. */
const STEP_EPS = 1e-6;

/**
 * Advances the world by dtMs in fixed sub-steps; the result depends only on the total time.
 * The step count per call is bounded upstream (session.ts clamps a tick's dt to 0.25 s, at most 15 sub-steps);
 * maxStepsPerTick is a defensive cap on top, and time beyond it is dropped.
 */
export function stepWorld(w: TowerWorld, dtMs: number): void {
  const c = CONFIG.wackelturm;
  w.acc += dtMs;
  let steps = 0;
  while (w.acc >= c.stepMs - STEP_EPS) {
    if (steps++ >= c.maxStepsPerTick) {
      w.acc = 0;
      break;
    }
    w.acc -= c.stepMs;
    if (w.windMs > 0) {
      wakeAll(w);
      for (const b of Composite.allBodies(w.engine.world)) {
        if (b.isStatic) continue;
        Body.applyForce(b, b.position, { x: (w.windDir * b.mass * c.windAccel) / 1e6, y: 0 });
      }
      w.windMs -= c.stepMs;
      if (w.windMs < STEP_EPS) w.windMs = 0;
    }
    Engine.update(w.engine, c.stepMs);
  }
  if (w.acc < 0) w.acc = 0;
}

/** True while the block barely moves. */
export function atRest(b: Matter.Body): boolean {
  return b.speed < CONFIG.wackelturm.restSpeed && b.angularSpeed < CONFIG.wackelturm.restAngSpeed;
}

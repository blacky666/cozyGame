import { readFileSync } from 'node:fs';
import Matter from 'matter-js';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../config';
import type { AssetFile } from '../../gfx/assetTypes';
import { readLayout } from './towerLayout';
import {
  atRest, blockKind, blockPose, CELLS, createTowerWorld, FIES_KINDS, KINDS, NORMAL_KINDS, removeBlock, shapeSize, spawnBlock, stepWorld,
  type Kind, type Rot, type TowerWorld,
} from './towerPhysics';

const file = JSON.parse(readFileSync('public/assets/arena-wackelturm.json', 'utf8')) as AssetFile;
const layout = readLayout(file);
const C = CONFIG.wackelturm;
const ROTS: Rot[] = [0, 1, 2, 3];

/** Steps the world in frames of frameMs until totalMs has passed. */
function run(w: TowerWorld, totalMs: number, frameMs = C.stepMs): void {
  for (let t = 0; t < totalMs - 1e-6; t += frameMs) stepWorld(w, frameMs);
}

describe('towerPhysics', () => {
  it('kind lists', () => {
    expect(KINDS).toEqual(['quader', 'kurz', 'lang', 'l', 't', 'kugel', 'dreieck', 'wackelstein']);
    expect(NORMAL_KINDS).toEqual(['quader', 'kurz', 'lang', 'l', 't']);
    expect(FIES_KINDS).toEqual(['kugel', 'dreieck', 'wackelstein']);
  });

  it('cells and sizes match the block sprites', () => {
    for (const k of KINDS) {
      const s = file.sprites[`block.${k}`] as unknown as { w: number; h: number; pivot: [number, number]; zellen: string[] };
      expect(CELLS[k]).toEqual(s.zellen);
      expect(shapeSize(k, 0)).toEqual({ w: s.w, h: s.h });
      expect(s.pivot).toEqual([s.w / 2, s.h / 2]);
    }
  });

  it('shapeSize swaps for odd rotations', () => {
    expect(shapeSize('l', 0)).toEqual({ w: 32, h: 48 });
    expect(shapeSize('l', 1)).toEqual({ w: 48, h: 32 });
    expect(shapeSize('l', 2)).toEqual({ w: 32, h: 48 });
    expect(shapeSize('lang', 3)).toEqual({ w: 16, h: 64 });
  });

  it('blockPose round trip for every kind and rotation', () => {
    for (const k of KINDS) for (const rot of ROTS) {
      const w = createTowerWorld(layout, 0);
      const b = spawnBlock(w, k, 60, 100, rot);
      const p = blockPose(b);
      expect(p.x, `${k} ${rot}`).toBeCloseTo(60, 9);
      expect(p.y, `${k} ${rot}`).toBeCloseTo(100, 9);
      expect(p.a, `${k} ${rot}`).toBeCloseTo((rot * Math.PI) / 2, 9);
    }
  });

  it('outlines sit on the pivot at rot 0', () => {
    const w = createTowerWorld(layout, 0);
    const box = (k: Kind) => {
      const b = spawnBlock(w, k, 60, 100, 0).bounds;
      return [b.min.x - 60, b.min.y - 100, b.max.x - 60, b.max.y - 100].map((v) => Math.round(v * 1e6) / 1e6);
    };
    expect(box('dreieck')).toEqual([-15, -8, 15, 7]);
    expect(box('wackelstein')).toEqual([-16, -8, 16, 8]);
    // The circle is a polygon slightly inside r 8; it is centred on the pivot.
    const k = box('kugel');
    expect([k[0] + k[2], k[1] + k[3]]).toEqual([0, 0]);
    expect(k[3]).toBe(8);
    expect(box('l')).toEqual([-16, -24, 16, 24]);
    expect(box('t')).toEqual([-24, -16, 24, 16]);
  });

  it('multi-cell blocks have the rotational inertia of the solid shape', () => {
    const solid = (wPx: number, hPx: number) =>
      Matter.Bodies.rectangle(0, 0, wPx, hPx, { density: C.density }).inertia;
    const w = createTowerWorld(layout, 0);
    const lang = spawnBlock(w, 'lang', 60, 100, 0);
    const quader = spawnBlock(w, 'quader', 60, 100, 1);
    expect(Math.abs(lang.inertia / solid(64, 16) - 1)).toBeLessThan(0.05);
    expect(Math.abs(quader.inertia / solid(32, 16) - 1)).toBeLessThan(0.05);
    // Rotation does not change it; l and t get the parallel-axis share as well.
    expect(spawnBlock(w, 'lang', 60, 100, 1).inertia).toBeCloseTo(lang.inertia, 6);
    for (const k of ['l', 't'] as const) {
      const b = spawnBlock(w, k, 60, 100, 0);
      const naive = b.parts.slice(1).reduce((sum, p) => sum + p.inertia, 0);
      expect(b.inertia).toBeGreaterThan(naive * 2);
      expect(b.inverseInertia).toBeCloseTo(1 / b.inertia, 12);
    }
  });

  it('stepWorld runs at most maxStepsPerTick sub-steps per call and drops the rest', () => {
    const w = createTowerWorld(layout, 0);
    const b = spawnBlock(w, 'kurz', 60, 0, 0);
    stepWorld(w, C.stepMs * (C.maxStepsPerTick + 30));
    expect(w.engine.timing.timestamp).toBeCloseTo(C.stepMs * C.maxStepsPerTick, 6);
    expect(w.acc).toBe(0);
    expect(b.position.y).toBeGreaterThan(0);
  });

  it('the l and t have their centre of mass off the pivot', () => {
    const w = createTowerWorld(layout, 0);
    const l = spawnBlock(w, 'l', 60, 100, 0);
    const t = spawnBlock(w, 't', 60, 100, 0);
    expect(Math.hypot(l.position.x - 60, l.position.y - 100)).toBeGreaterThan(1);
    expect(Math.hypot(t.position.x - 60, t.position.y - 100)).toBeGreaterThan(1);
  });

  it('a kurz dropped on the foundation settles on top and comes to rest within 2 s', () => {
    const w = createTowerWorld(layout, 0);
    const plot = layout.plots[0];
    const b = spawnBlock(w, 'kurz', plot.centre, layout.surfaceY - 40, 0);
    let restedAt = -1;
    for (let t = 0; t < 2000; t += C.stepMs) {
      stepWorld(w, C.stepMs);
      if (restedAt < 0 && atRest(b) && b.position.y > layout.surfaceY - 20) restedAt = t;
    }
    expect(restedAt).toBeGreaterThanOrEqual(0);
    expect(atRest(b)).toBe(true);
    expect(Math.abs(blockPose(b).y - 8 - (layout.surfaceY - 16))).toBeLessThanOrEqual(0.5);
  });

  it('determinism: the poses depend only on the total time', () => {
    const plot = layout.plots[1];
    const poses = (frames: number[]) => {
      const w = createTowerWorld(layout, 1);
      const a = spawnBlock(w, 'quader', plot.centre - 10, layout.surfaceY - 30, 0);
      const b = spawnBlock(w, 'l', plot.centre + 6, layout.surfaceY - 80, 1);
      for (const f of frames) stepWorld(w, f);
      return [blockPose(a), blockPose(b)];
    };
    const mix: number[] = [];
    let left = 2000;
    for (let i = 0; left > 0; i++) {
      const f = Math.min([7, 13, 41][i % 3], left);
      mix.push(f);
      left -= f;
    }
    const ref = poses(Array<number>(60).fill(1000 / 30));
    for (const other of [poses(Array<number>(120).fill(1000 / 60)), poses(mix)]) {
      for (let i = 0; i < 2; i++) {
        expect(Math.abs(other[i].x - ref[i].x)).toBeLessThan(1e-9);
        expect(Math.abs(other[i].y - ref[i].y)).toBeLessThan(1e-9);
        expect(Math.abs(other[i].a - ref[i].a)).toBeLessThan(1e-9);
      }
    }
    // The blocks really moved (the test is not trivially equal).
    expect(ref[0].y).toBeGreaterThan(layout.surfaceY - 30);
  });

  it('wind pushes a resting kurz sideways in windDir and stops after 1500 ms', () => {
    for (const dir of [-1, 1] as const) {
      const w = createTowerWorld(layout, 2);
      const plot = layout.plots[2];
      const b = spawnBlock(w, 'kurz', plot.centre, layout.surfaceY - 8, 0);
      run(w, 1000);
      expect(atRest(b)).toBe(true);
      const x0 = blockPose(b).x;
      w.windMs = C.windMs;
      w.windDir = dir;
      run(w, 500);
      expect(w.windMs).toBeGreaterThan(0);
      expect((blockPose(b).x - x0) * dir).toBeGreaterThan(1);
      run(w, 1000);
      expect(w.windMs).toBe(0);
      // Once the gust is over the block stops again (friction), still sliding at most a little.
      const x1 = blockPose(b).x;
      run(w, 1000);
      expect(Math.abs(blockPose(b).x - x1)).toBeLessThan(1);
    }
  });

  describe('Windstoß balance (one gust)', () => {
    /**
     * Builds n blocks of kind on plot 0, each shifted dx from the one below: spawned in place, or dropped
     * 30 px above the current top every 700 ms. Returns the tower top (px above the foundation) before and
     * after one gust in dir, counting only blocks still over the plot.
     */
    function gust(kind: Kind, n: number, rot: Rot, dx: number, dir: -1 | 1, mode: 'spawn' | 'drop') {
      const plot = layout.plots[0];
      const w = createTowerWorld(layout, 0);
      const bodies: Matter.Body[] = [];
      const top = () => {
        const on = bodies.filter((b) => Math.abs(b.position.x - plot.centre) < plot.w / 2 + 16 && b.position.y < layout.surfaceY);
        return Math.round(layout.surfaceY - Math.min(layout.surfaceY, ...on.map((b) => b.bounds.min.y)));
      };
      const h = shapeSize(kind, rot).h;
      for (let i = 0; i < n; i++) {
        if (mode === 'spawn') bodies.push(spawnBlock(w, kind, plot.centre + dx * i, layout.surfaceY - h / 2 - h * i, rot));
        else {
          bodies.push(spawnBlock(w, kind, plot.centre + dx * i, layout.surfaceY - top() - h / 2 - 30, rot));
          run(w, 700);
        }
      }
      run(w, 3000);
      const before = top();
      w.windMs = C.windMs;
      w.windDir = dir;
      run(w, C.windMs + 3500);
      return { before, after: top() };
    }

    it('an 11-layer flat lang tower survives a gust from either side (spawned or dropped)', () => {
      for (const mode of ['spawn', 'drop'] as const) {
        for (const dir of [-1, 1] as const) {
          const { before, after } = gust('lang', 11, 0, 0, dir, mode);
          expect(before, `${mode} ${dir}`).toBeGreaterThanOrEqual(11 * 16 - 10);
          expect(after, `${mode} ${dir}`).toBeGreaterThanOrEqual(0.9 * before);
        }
      }
    });

    it('a one-cell-wide column and a clearly overhanging tower do not survive a gust', () => {
      for (const dir of [-1, 1] as const) {
        const col = gust('quader', 6, 1, 0, dir, 'spawn');
        expect(col.before, `column ${dir}`).toBeGreaterThanOrEqual(6 * 32 - 8);
        expect(col.after, `column ${dir}`).toBeLessThan(col.before / 2);
        const over = gust('lang', 8, 0, 4, dir, 'drop');
        expect(over.before, `overhang ${dir}`).toBeGreaterThanOrEqual(8 * 16 - 8);
        expect(over.after, `overhang ${dir}`).toBeLessThan(over.before / 2);
      }
    });
  });

  it('a lang dropped with its centre beyond the foundation edge falls off', () => {
    const w = createTowerWorld(layout, 0);
    const plot = layout.plots[0];
    const b = spawnBlock(w, 'lang', plot.left + plot.w + 4, layout.surfaceY - 20, 0);
    run(w, 3000);
    expect(blockPose(b).y).toBeGreaterThan(layout.surfaceY + C.fallMarginPx);
  });

  it('the world has one static foundation and the configured gravity', () => {
    const w = createTowerWorld(layout, 3);
    const statics = w.engine.world.bodies.filter((b) => b.isStatic);
    expect(statics).toHaveLength(1);
    expect(statics[0].bounds.min.y).toBeCloseTo(layout.surfaceY, 9);
    expect(statics[0].bounds.min.x).toBeCloseTo(layout.plots[3].left, 9);
    expect(statics[0].bounds.max.x).toBeCloseTo(layout.plots[3].left + layout.plots[3].w, 9);
    expect(w.engine.gravity.y).toBe(C.gravityY);
    expect(w.engine.enableSleeping).toBe(true);
    expect((Matter.Sleeping as unknown as { _motionSleepThreshold: number })._motionSleepThreshold).toBe(C.sleepMotion);
    expect(statics[0].slop).toBe(C.slop);
    expect(w.engine.positionIterations).toBe(C.positionIterations);
    expect(w.engine.velocityIterations).toBe(C.velocityIterations);
    expect(w.plot).toEqual(layout.plots[3]);
  });

  it('spawnBlock adds the body to the world with the configured material', () => {
    const w = createTowerWorld(layout, 0);
    const kinds: Kind[] = ['quader', 'kugel'];
    for (const k of kinds) {
      const b = spawnBlock(w, k, 50, 50, 0);
      expect(w.engine.world.bodies).toContain(b);
      expect(b.friction).toBe(C.friction);
      expect(b.frictionStatic).toBe(C.frictionStatic);
      expect(b.restitution).toBe(C.restitution);
      expect(b.slop).toBe(C.slop);
    }
  });

  it('blockKind reads the kind spawnBlock stored; removeBlock takes the body out of the world', () => {
    const w = createTowerWorld(layout, 0);
    const a = spawnBlock(w, 'l', 50, 50, 1);
    const b = spawnBlock(w, 'kugel', 80, 50, 0);
    expect(blockKind(a)).toBe('l');
    expect(blockKind(b)).toBe('kugel');
    removeBlock(w, a);
    expect(w.engine.world.bodies).not.toContain(a);
    expect(w.engine.world.bodies).toContain(b);
  });

  it('a carefully stacked tower of 10 flat lang stays above 150 px for 10 s', () => {
    const w = createTowerWorld(layout, 0);
    const plot = layout.plots[0];
    const bodies = Array.from({ length: 10 }, (_, i) => spawnBlock(w, 'lang', plot.centre, layout.surfaceY - 8 - 16 * i, 0));
    const height = () => layout.surfaceY - Math.min(...bodies.map((b) => b.bounds.min.y));
    let lowest = Infinity;
    for (let t = 0; t < 10000; t += C.stepMs) {
      stepWorld(w, C.stepMs);
      lowest = Math.min(lowest, height());
    }
    expect(lowest).toBeGreaterThan(150);
    expect(bodies.every((b) => b.isSleeping)).toBe(true);
  });

  it('a sleeping tower is woken and pushed by wind; spawning wakes the world', () => {
    const w = createTowerWorld(layout, 1);
    const plot = layout.plots[1];
    const a = spawnBlock(w, 'kurz', plot.centre, layout.surfaceY - 8, 0);
    const b = spawnBlock(w, 'kurz', plot.centre, layout.surfaceY - 24, 0);
    run(w, 3000);
    expect(a.isSleeping && b.isSleeping).toBe(true);
    const x0 = blockPose(b).x;
    w.windMs = C.windMs;
    w.windDir = -1;
    run(w, 500);
    expect(x0 - blockPose(b).x).toBeGreaterThan(1);
    run(w, 4000);
    expect(a.isSleeping && b.isSleeping).toBe(true);
    spawnBlock(w, 'kurz', plot.centre + 30, layout.surfaceY - 40, 0);
    expect(a.isSleeping || b.isSleeping).toBe(false);
  });

  it('a lang tipping slowly off a marginal overhang falls instead of falling asleep at a tilt', () => {
    // A dynamic 32×80 support on the foundation; the lang's centre of mass d px past its right edge.
    for (const d of [0.2, 0.5]) {
      const w = createTowerWorld(layout, 0);
      const plot = layout.plots[0];
      const support = Matter.Bodies.rectangle(plot.centre, layout.surfaceY - 40, 32, 80, {
        friction: C.friction, frictionStatic: C.frictionStatic, restitution: C.restitution, density: C.density, slop: C.slop,
      });
      Matter.Composite.add(w.engine.world, support);
      const top = spawnBlock(w, 'lang', plot.centre + 16 + d, layout.surfaceY - 80 - 8, 0);
      let tiltedAsleep = false;
      for (let i = 0; i < 600; i++) {
        stepWorld(w, C.stepMs);
        if (top.isSleeping && Math.abs(Math.sin(top.angle)) > 0.05) tiltedAsleep = true;
      }
      expect(tiltedAsleep, `d ${d}`).toBe(false);
      // Fallen: off the support (removed by the host) or lying on the foundation, not perched up there.
      expect(top.position.y, `d ${d}`).toBeGreaterThan(layout.surfaceY - 40);
    }
  });
});

import { CONFIG } from '../../config';
import type { BotView, MiniGame, PlayerKey } from '../types';
import { craneBounds, createTowerHost, type TowerPlayer, type TowerState } from './towerHost';
import { readLayout, type TowerLayout } from './towerLayout';
import { CELLS, type Kind, type Rot } from './towerPhysics';
import { ARENA_FILE, ARENA_OFFSET, TowerView } from './towerView';

/** Values per block in TowerPlayer.blocks: id, kind index, x × 10, y × 10, angle × 100. */
const STRIDE = 5;
/** A full turn in snapshot angle units (angle × 100). */
const TURN = 200 * Math.PI;

/** Interpolated angle (× 100) from a to b the short way round. */
function lerpAngle(a: number, b: number, t: number): number {
  const d = b - a - TURN * Math.round((b - a) / TURN);
  return a + d * t;
}

/** Blocks matched by id move (x, y and the angle the short way); blocks only in b are taken as they are. */
function lerpBlocks(a: number[], b: number[], t: number): number[] {
  const before = new Map<number, number>();
  for (let i = 0; i < a.length; i += STRIDE) before.set(a[i], i);
  const out = b.slice();
  for (let i = 0; i < b.length; i += STRIDE) {
    const j = before.get(b[i]);
    if (j === undefined) continue;
    out[i + 2] = a[j + 2] + (b[i + 2] - a[j + 2]) * t;
    out[i + 3] = a[j + 3] + (b[i + 3] - a[j + 3]) * t;
    out[i + 4] = lerpAngle(a[j + 4], b[i + 4], t);
  }
  return out;
}

/** Snapshot interpolation: crane x / height and block poses move; everything else comes from `b`. */
export function lerpTower(a: TowerState, b: TowerState, t: number): TowerState {
  const players: Record<PlayerKey, TowerPlayer> = {};
  for (const [k, pb] of Object.entries(b.players)) {
    const pa = a.players[k];
    players[k] = pa
      ? {
          ...pb,
          craneX: pa.craneX + (pb.craneX - pa.craneX) * t,
          hangTop: pa.hangTop + (pb.hangTop - pa.hangTop) * t,
          blocks: lerpBlocks(pa.blocks, pb.blocks, t),
        }
      : { ...pb };
  }
  return { ...b, players };
}

/** Where a bot aims its blocks: around the plot centre, shifted by the placed count. */
const BOT_OFFSETS = [-16, 0, 16] as const;
/** The bot drops once the crane is this close to its target (px). */
const BOT_NEAR = 2;
const ROTS: readonly Rot[] = [0, 1, 2, 3];

/** Number of filled cells on the bottom row of a kind at a rotation (its base width in cells). */
export function baseCells(kind: Kind, rot: Rot): number {
  let rows: readonly string[] = CELLS[kind];
  for (let i = 0; i < rot; i++) {
    // One clockwise quarter turn: the new rows are the old columns, read bottom to top.
    rows = Array.from(rows[0], (_, c) => rows.map((_r, r) => rows[rows.length - 1 - r][c]).join(''));
  }
  return [...rows[rows.length - 1]].filter((ch) => ch === 'X').length;
}

/** The rotation with the widest base (most cells on the bottom row); ties go to the lowest rotation. */
export function flatRot(kind: Kind): Rot {
  let best: Rot = 0;
  for (const r of ROTS) if (baseCells(kind, r) > baseCells(kind, best)) best = r;
  return best;
}

/**
 * Tower bots: with a charge they arm the Windstoß (right click) and click the leader's plot (the
 * highest other present tower that is not wind-immune; never in the last aergerLockMs); otherwise they turn the hanging block flat, move the crane over the plot
 * centre (−16 / 0 / +16 px in turn) and drop. Idle once the time is up.
 */
export function towerBotView(s: TowerState, key: PlayerKey, layout: TowerLayout): BotView | null {
  const me = s.players[key];
  if (!me) return null;
  const self = { x: me.craneX, y: 0 };
  if (s.timeLeftMs <= 0) return { self, targets: [], idle: true };
  const plot = layout.plots[me.plot];
  if (!plot) return { self, targets: [] };
  let x = plot.centre + BOT_OFFSETS[me.placed % BOT_OFFSETS.length];
  const flat = me.hang ? flatRot(me.hang.kind) : null;
  if (me.hang && flat !== null) {
    const b = craneBounds(plot, me.hang.kind, flat);
    x = Math.min(b.max, Math.max(b.min, x));
  }
  const targets = [{ x, y: self.y }];

  // Bots only use the Windstoß: absent players and towers still immune from the last one are no target.
  const victims = Object.entries(s.players).filter(([k, p]) => k !== key && p.present && p.windImmuneMs <= 0).map(([, p]) => p);
  if (me.armed !== null) {
    let leader: TowerPlayer | null = null;
    for (const p of victims) if (!leader || p.heightPx > leader.heightPx) leader = p;
    const at = leader ? layout.plots[leader.plot] : undefined;
    // Nobody to target: cycle the armed action back to none.
    if (!at) return { self, targets, fire: 'secondary' };
    return { self, targets, aim: { x: at.centre, y: 0 }, fire: 'primary' };
  }
  const canArm = s.timeLeftMs > CONFIG.wackelturm.aergerLockMs;
  if (me.charges > 0 && canArm && victims.length > 0) return { self, targets, fire: 'secondary' };
  if (!me.hang || flat === null) return { self, targets };
  if (me.hang.rot !== flat) return { self, targets, turn: 'cw' };
  if (Math.abs(me.craneX - x) <= BOT_NEAR) return { self, targets, fire: 'primary' };
  return { self, targets };
}

/** Layout of the last host created here (bots only run on the host). */
let botLayout: TowerLayout | undefined;

export const wackelturm: MiniGame<TowerState> = {
  id: 'wackelturm',
  title: 'Wackel-Turm',
  rule: 'Stapelt die Klötze zum höchsten Turm – wer zuerst die Fahne erreicht, gewinnt sofort!',
  controls:
    'A/D Kran schieben · W/S oder Mausrad drehen · Leertaste oder Linksklick fallen lassen · Rechtsklick Ärger-Aktion, dann fremden Bauplatz anklicken',
  durationMs: CONFIG.wackelturm.durationMs,
  aimOffset: ARENA_OFFSET,
  sounds: 'wackelturm',
  createHost: (players, rand, opts) => {
    const file = opts?.assets?.[ARENA_FILE];
    if (!file) throw new Error(`wackelturm: assets missing (${ARENA_FILE}); pass opts.assets to createHost`);
    botLayout = readLayout(file);
    return createTowerHost(players, rand, botLayout, opts?.durationMs ?? CONFIG.wackelturm.durationMs, { card: opts?.card });
  },
  createView: (scene, players, selfKey) => new TowerView(scene, players, selfKey),
  lerp: lerpTower,
  botView: (s, key) => (botLayout ? towerBotView(s, key, botLayout) : null),
};

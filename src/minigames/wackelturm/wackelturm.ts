import { CONFIG } from '../../config';
import type { BotView, MiniGame, PlayerKey } from '../types';
import { craneBounds, createTowerHost, type TowerPlayer, type TowerState } from './towerHost';
import { readLayout, type TowerLayout } from './towerLayout';
import { shapeSize, type Kind, type Rot } from './towerPhysics';
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

/** The lowest rotation with the widest footprint (the flattest way to lay the block). */
export function flatRot(kind: Kind): Rot {
  let best: Rot = 0;
  for (const r of ROTS) if (shapeSize(kind, r).w > shapeSize(kind, best).w) best = r;
  return best;
}

/**
 * Tower bots: with a charge they arm the Windstoß (right click) and click the leader's plot (the
 * highest other tower); otherwise they turn the hanging block flat, move the crane over the plot
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

  if (me.armed !== null) {
    let leader: TowerPlayer | null = null;
    for (const [k, p] of Object.entries(s.players)) {
      if (k !== key && (!leader || p.heightPx > leader.heightPx)) leader = p;
    }
    const at = leader ? layout.plots[leader.plot] : undefined;
    return { self, targets, aim: { x: at ? at.centre : -1, y: 0 }, fire: 'primary' };
  }
  if (me.charges > 0) return { self, targets, fire: 'secondary' };
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
    'A/D Kran schieben · Q/E oder Mausrad drehen · S oder Linksklick fallen lassen · Rechtsklick Ärger-Aktion, dann fremden Bauplatz anklicken',
  durationMs: CONFIG.wackelturm.durationMs,
  aimOffset: ARENA_OFFSET,
  sounds: 'wackelturm',
  createHost: (players, rand, opts) => {
    const file = opts?.assets?.[ARENA_FILE];
    if (!file) throw new Error(`wackelturm: assets missing (${ARENA_FILE}); pass opts.assets to createHost`);
    botLayout = readLayout(file);
    return createTowerHost(players, rand, botLayout, opts?.durationMs ?? CONFIG.wackelturm.durationMs);
  },
  createView: (scene, players, selfKey) => new TowerView(scene, players, selfKey),
  lerp: lerpTower,
  botView: (s, key) => (botLayout ? towerBotView(s, key, botLayout) : null),
};

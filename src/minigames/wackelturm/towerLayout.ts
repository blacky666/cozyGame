import type { AssetFile, SpriteDef } from '../../gfx/assetTypes';

/** One tower plot: the foundation's left edge and width, its centre, and the column bounds (world x). */
export type Plot = { left: number; w: number; centre: number; minX: number; maxX: number };

export type TowerLayout = {
  /** Plots sorted by x (player order maps onto this). */
  plots: Plot[];
  /** Top edge of the foundation (world y). */
  surfaceY: number;
  /** The asset's crane marker line (world y) and its height above the foundation. */
  goalY: number;
  goalPx: number;
  /** Top edge of a hanging block while the crane is parked (world y). */
  hangTopStart: number;
  /** Hook centre x relative to the plot's left edge. */
  hookOffsetX: number;
  /** Distance between neighbouring plots; each column spans centre +- pitch/2. */
  pitch: number;
};

const MAP = 'wackelturm.szene';

type SceneObject = { sprite: string; x: number; y: number };

function sprite(file: AssetFile, key: string): SpriteDef {
  const s = file.sprites[key];
  if (!s) throw new Error(`wackelturm: sprite '${key}' missing`);
  return s;
}

function objects(file: AssetFile, key: string): SceneObject[] {
  const map = file.maps?.[MAP] as unknown as { objects?: SceneObject[] } | undefined;
  if (!map?.objects) throw new Error(`wackelturm: map '${MAP}' missing`);
  const list = map.objects.filter((o) => o.sprite === key).sort((a, b) => a.x - b.x);
  if (list.length === 0) throw new Error(`wackelturm: no '${key}' object in '${MAP}'`);
  return list;
}

/** Derives the tower geometry from the scene (object x/y is the sprite's top-left corner). */
export function readLayout(file: AssetFile): TowerLayout {
  const fund = sprite(file, 'turm.solid.fundament');
  const fahne = sprite(file, 'turm.ziel.fahne');
  const haken = sprite(file, 'turm.kran.haken');
  if (!fund.hitbox) throw new Error("wackelturm: 'turm.solid.fundament' has no hitbox");
  const [hx, hy, hw] = fund.hitbox;

  const funds = objects(file, 'turm.solid.fundament');
  if (funds.length < 2) throw new Error('wackelturm: need at least two foundations');
  const lefts = funds.map((o) => o.x + hx);
  const pitch = lefts[1] - lefts[0];
  const plots = lefts.map((left): Plot => {
    const centre = left + hw / 2;
    return { left, w: hw, centre, minX: centre - pitch / 2, maxX: centre + pitch / 2 };
  });

  const surfaceY = funds[0].y + hy;
  const goalY = objects(file, 'turm.ziel.fahne')[0].y + fahne.pivot[1];
  const hook = objects(file, 'turm.kran.haken')[0];
  return {
    plots,
    surfaceY,
    goalY,
    goalPx: surfaceY - goalY,
    hangTopStart: hook.y + haken.h,
    hookOffsetX: hook.x + haken.pivot[0] - plots[0].left,
    pitch,
  };
}

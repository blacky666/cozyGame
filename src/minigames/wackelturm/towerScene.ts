import type Phaser from 'phaser';
import type { AssetFile, SpriteDef } from '../../gfx/assetTypes';
import { assetSprite } from '../../game/ui';
import { columnAt } from './towerHost';
import type { Plot, TowerLayout } from './towerLayout';

export const ARENA_FILE = 'arena-wackelturm';
export const SCENE_MAP = 'wackelturm.szene';

/** A map object: sprite name, top-left corner, z order (small = back), optional start frame. */
type SceneObject = { sprite: string; x: number; y: number; z?: number; frame?: number };

/** Map objects the view does not draw as backdrop: the cranes and blocks (drawn live) and the example fx. */
const LIVE = (name: string) =>
  name.startsWith('turm.kran.') || name.startsWith('block.') || name === 'turm.wind' || name === 'turm.staub_landung';
/** The goal marker moves to surfaceY − goalPx (CONFIG), not where the asset puts it. */
const GOAL = (name: string) => name === 'turm.ziel.wimpelkette' || name === 'turm.ziel.fahne';
const SKY = 'turm.bg.himmel';

export function sceneObjects(file: AssetFile): SceneObject[] {
  const map = file.maps?.[SCENE_MAP] as unknown as { objects?: SceneObject[] } | undefined;
  if (!map?.objects) throw new Error(`wackelturm: map '${SCENE_MAP}' missing`);
  return map.objects;
}

const parallaxOf = (def: SpriteDef | undefined): number => (def as { parallax?: number } | undefined)?.parallax ?? 1;

/**
 * Draws the backdrop of the scene into `layer` at world = map + (ox, oy): every map object except the
 * live ones, z as depth, the sprite's parallax as the vertical scroll factor. Returns the colour of the
 * top sky pixel (for the area above the map) or null.
 */
export function drawBackdrop(
  scene: Phaser.Scene,
  file: AssetFile,
  layout: TowerLayout,
  goalPx: number,
  layer: Phaser.GameObjects.Layer,
  ox: number,
  oy: number,
): Phaser.Display.Color | null {
  const goalDy = layout.surfaceY - goalPx - layout.goalY;
  let sky: Phaser.Display.Color | null = null;
  for (const o of sceneObjects(file)) {
    if (LIVE(o.sprite)) continue;
    const s = assetSprite(scene, o.sprite, o.x + ox, o.y + oy + (GOAL(o.sprite) ? goalDy : 0));
    if (!s) continue;
    s.setOrigin(0).setDepth(o.z ?? 0).setScrollFactor(1, parallaxOf(file.sprites[o.sprite]));
    if (o.frame !== undefined && !s.anims.isPlaying) s.setFrame(o.frame);
    layer.add(s);
    if (o.sprite === SKY && !sky) sky = scene.textures.getPixel(0, 0, s.texture.key, 0);
  }
  return sky;
}

/** One crane part relative to the hook top (dy) and to the plot's left edge or, if it moves, the crane x (dx). */
type Piece = { name: string; dx: number; dy: number; z: number; moving: boolean };
/** Parts that travel with the crane x. */
const MOVING = new Set(['turm.kran.laufkatze', 'turm.kran.seil', 'turm.kran.haken']);
const MAST = 'turm.kran.turm';
const HOOK = 'turm.kran.haken';
/** Mast segment height (px). */
const MAST_STEP = 16;

/** Crane geometry read off plot 0's crane in the map (offsets from the hook top). */
export type CraneShape = {
  pieces: Piece[];
  /** Mast: x of its segments from the plot's left edge, top of the highest segment from the hook top, z. */
  mastDx: number;
  mastDy: number;
  mastZ: number;
  /** World-free map y where the mast ends (the ground). */
  groundY: number;
  /** Hook top minus hangTop (the hook sits right above the hanging block). */
  hookDy: number;
};

export function readCrane(file: AssetFile, layout: TowerLayout): CraneShape {
  const plot0 = layout.plots[0];
  const mine = sceneObjects(file).filter((o) => {
    if (!o.sprite.startsWith('turm.kran.')) return false;
    const def = file.sprites[o.sprite];
    return columnAt(layout, o.x + (def?.w ?? 0) / 2) === 0;
  });
  const hook = mine.find((o) => o.sprite === HOOK);
  const mast = mine.filter((o) => o.sprite === MAST);
  if (!hook || mast.length === 0) throw new Error('wackelturm: crane of plot 0 incomplete in the map');
  const hookX = hook.x + (file.sprites[HOOK]?.pivot[0] ?? 0);
  const pieces = mine
    .filter((o) => o.sprite !== MAST)
    .map((o): Piece => {
      const moving = MOVING.has(o.sprite);
      return { name: o.sprite, dx: o.x - (moving ? hookX : plot0.left), dy: o.y - hook.y, z: o.z ?? 0, moving };
    });
  const top = Math.min(...mast.map((o) => o.y));
  return {
    pieces,
    mastDx: mast[0].x - plot0.left,
    mastDy: top - hook.y,
    mastZ: mast[0].z ?? 0,
    groundY: Math.max(...mast.map((o) => o.y)) + MAST_STEP,
    hookDy: hook.y - layout.hangTopStart,
  };
}

/** One plot's crane: mast segments down to the ground, boom, cab and lamp, trolley, rope and hook. */
export class CraneRig {
  private readonly parts: { piece: Piece; sprite: Phaser.GameObjects.Sprite }[] = [];
  private readonly mast: Phaser.GameObjects.Sprite[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly shape: CraneShape,
    private readonly plot: Plot,
    private readonly layer: Phaser.GameObjects.Layer,
    /** World offset of the simulation. */
    private readonly ox: number,
    private readonly oy: number,
  ) {
    for (const piece of shape.pieces) {
      const sprite = assetSprite(scene, piece.name, 0, 0);
      if (!sprite) continue;
      sprite.setOrigin(0).setDepth(piece.z);
      layer.add(sprite);
      this.parts.push({ piece, sprite });
    }
  }

  /** Places the crane for the hanging block's top edge (hangTop) and pivot x (craneX), simulation coordinates. */
  update(hangTop: number, craneX: number): void {
    const h = hangTop + this.shape.hookDy;
    for (const { piece, sprite } of this.parts) {
      const x = (piece.moving ? Math.round(craneX) : this.plot.left) + piece.dx;
      sprite.setPosition(x + this.ox, Math.round(h + piece.dy) + this.oy);
    }
    let i = 0;
    for (let y = Math.round(h + this.shape.mastDy); y < this.shape.groundY; y += MAST_STEP, i++) {
      let seg = this.mast[i];
      if (!seg) {
        const made = assetSprite(this.scene, MAST, 0, 0);
        if (!made) return;
        seg = made.setOrigin(0).setDepth(this.shape.mastZ);
        this.layer.add(seg);
        this.mast.push(seg);
      }
      seg.setPosition(this.plot.left + this.shape.mastDx + this.ox, y + this.oy).setVisible(true);
    }
    for (; i < this.mast.length; i++) this.mast[i].setVisible(false);
  }
}

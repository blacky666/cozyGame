import Phaser from 'phaser';
import type { ColorMap } from '../../gfx/assetTypes';
import { assetSprite, playerColors, swapSprite } from '../../game/ui';
import { TILE_DEPTH } from '../common/arenaView';
import { decodeGrid, edgeMask, MUSTER, type Grid } from './paintGrid';

/** Above the dielen (flaechen, TILE_DEPTH + 1), below the rand (TILE_DEPTH + 2). */
export const PAINT_DEPTH = TILE_DEPTH + 1.5;
const FRESH_DEPTH = TILE_DEPTH + 1.6;
const FRESH_SPRITE = 'farbe.tile.frisch';

/** Paint tile of an owner (1-4) with its same-owner neighbour mask. */
export const paintTileName = (owner: number, mask: number): string =>
  `farbkrieg.tile.farbe_${MUSTER[owner - 1]}.${mask}`;

/**
 * The painted floor: one sprite per paintable tile (created when it first gets an owner), hidden while
 * neutral. Each tile shows its owner's pattern with the edge piece of its same-owner neighbours,
 * recoloured to the owner's player colour; a newly coloured tile gets the `frisch` shimmer once.
 */
export class PaintLayer {
  private readonly sprites: (Phaser.GameObjects.Sprite | null)[];
  /** What each tile shows: owner * 16 + mask, 0 = nothing. */
  private readonly shown: Int16Array;
  private readonly colors: ColorMap[];
  private readonly fresh = new Set<Phaser.GameObjects.Sprite>();
  private last: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    /** A grid of this arena (only cols, rows, tile and paintable are used; its owners are overwritten). */
    private readonly grid: Grid,
    private readonly off: { readonly x: number; readonly y: number },
  ) {
    this.sprites = new Array<Phaser.GameObjects.Sprite | null>(grid.owner.length).fill(null);
    this.shown = new Int16Array(grid.owner.length);
    this.colors = [0, 1, 2, 3].map((slot) => playerColors(scene, slot));
  }

  /** Owner (0-4) of the tile under the map point, from the last decoded grid. */
  ownerAt(x: number, y: number): number {
    const g = this.grid;
    const c = Math.floor(x / g.tile);
    const r = Math.floor(y / g.tile);
    if (!(c >= 0 && r >= 0 && c < g.cols && r < g.rows)) return 0;
    return g.owner[r * g.cols + c];
  }

  /**
   * Show a snapshot grid. A string of the wrong length (a broken or foreign snapshot) is ignored and
   * the previous floor stays. Only tiles whose owner or mask changed are touched.
   */
  update(gridStr: string): void {
    const g = this.grid;
    if (gridStr === this.last || gridStr.length !== g.cols * g.rows) return;
    // The first floor is not "newly coloured": a (re)joining client sees it without shimmer.
    const first = this.last === null;
    this.last = gridStr;
    decodeGrid(gridStr, g);
    for (let i = 0; i < g.owner.length; i++) {
      if (!g.paintable[i]) continue;
      const owner = g.owner[i];
      const code = owner === 0 ? 0 : owner * 16 + edgeMask(g, i);
      const before = this.shown[i];
      if (code === before) continue;
      this.shown[i] = code;
      const s = this.sprites[i];
      if (owner === 0) {
        s?.setVisible(false);
        continue;
      }
      this.show(i, paintTileName(owner, code - owner * 16), this.colors[owner - 1]);
      if (!first && owner !== before >> 4) this.shimmer(i);
    }
  }

  private tileXY(i: number): { x: number; y: number } {
    const g = this.grid;
    return { x: this.off.x + (i % g.cols) * g.tile, y: this.off.y + Math.floor(i / g.cols) * g.tile };
  }

  private show(i: number, name: string, colors: ColorMap): void {
    let s = this.sprites[i];
    if (!s) {
      const { x, y } = this.tileXY(i);
      s = assetSprite(this.scene, name, x, y, colors);
      if (!s) return;
      s.setOrigin(0, 0).setDepth(PAINT_DEPTH);
      this.sprites[i] = s;
    } else {
      // Paint tiles have their pivot on the top-left corner, like the origin set above.
      swapSprite(this.scene, s, name, false, true, colors);
    }
    s.setVisible(true);
  }

  private shimmer(i: number): void {
    const { x, y } = this.tileXY(i);
    const s = assetSprite(this.scene, FRESH_SPRITE, x, y);
    if (!s) return;
    s.setOrigin(0, 0).setDepth(FRESH_DEPTH);
    this.fresh.add(s);
    const done = () => {
      this.fresh.delete(s);
      s.destroy();
    };
    if (s.anims.isPlaying) s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, done);
    else done();
  }

  destroy(): void {
    for (const s of this.sprites) s?.destroy();
    for (const s of this.fresh) s.destroy();
    this.sprites.fill(null);
    this.fresh.clear();
  }
}

import Phaser from 'phaser';
import type { AssetFile } from '../../gfx/assetTypes';
import { assetSprite } from '../../game/ui';

const TILE_DEPTH = -1000;

/**
 * Draws tile layers (fixed low depth) and map objects (depth = bottom y in world).
 * Objects are also recorded by id in `objectSprites` (key `obj<index>`).
 */
export function drawArena(
  scene: Phaser.Scene,
  file: AssetFile,
  mapName: string,
  offsetX: number,
  offsetY: number,
  objectSprites: Map<string, Phaser.GameObjects.Sprite> = new Map(),
): Phaser.GameObjects.GameObject[] {
  const map = file.maps?.[mapName];
  if (!map) throw new Error(`map not found: ${mapName}`);
  const out: Phaser.GameObjects.GameObject[] = [];
  const place = (name: string, x: number, y: number, depth: number) => {
    const s = assetSprite(scene, name, offsetX + x, offsetY + y);
    if (!s) return null;
    s.setOrigin(0, 0).setDepth(depth);
    out.push(s);
    return s;
  };
  const layers: [(string | null)[][], number][] = [
    [map.layers.boden, TILE_DEPTH],
    [map.layers.flaechen, TILE_DEPTH + 1],
    [map.layers.rand, TILE_DEPTH + 2],
  ];
  for (const [grid, depth] of layers) {
    grid.forEach((row, r) => row.forEach((name, c) => {
      if (name) place(name, c * map.tile, r * map.tile, depth);
    }));
  }
  map.objects.forEach((o, i) => {
    const h = file.sprites[o.sprite]?.h ?? 0;
    const s = place(o.sprite, o.x, o.y, offsetY + o.y + h);
    if (s) objectSprites.set(`obj${i}`, s);
  });
  return out;
}

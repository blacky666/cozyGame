import type { AssetFile } from '../gfx/assetTypes';
import { findSprite, layerPlan } from '../gfx/layerPlan';
import { rasterize } from '../gfx/rasterize';
import type { Look } from '../save/profile';

const PAD_X = 8;
const PAD_Y = 14;
const SIZE = 40;

/** Composite a standing character onto a small canvas (no Phaser). */
export function drawCharacter(look: Look, slot: number, assets: Record<string, AssetFile>): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.className = 'cg-char';
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  for (const layer of layerPlan(look, slot, 'down', 'idle', 0, assets)) {
    const s = findSprite(assets, layer.sprite);
    const frame = s?.def.frames[layer.frame];
    if (!s || !frame) continue;
    const tmp = document.createElement('canvas');
    tmp.width = s.def.w;
    tmp.height = s.def.h;
    const data = rasterize(frame, s.file, layer.colors);
    tmp.getContext('2d')?.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, s.def.w, s.def.h), 0, 0);
    ctx.drawImage(tmp, PAD_X + layer.x, PAD_Y + layer.y);
  }
  return canvas;
}

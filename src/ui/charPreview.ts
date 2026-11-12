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

/**
 * A single asset sprite (first frame) on its own canvas, `scale` x its size via CSS pixels
 * (item previews: emote/prank icons, accessories, the box). Empty canvas when the sprite is unknown.
 */
export function drawSprite(name: string, assets: Record<string, AssetFile>, scale = 2): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'cg-sprite';
  const s = findSprite(assets, name);
  const frame = s?.def.frames[0];
  if (!s || !frame) return canvas;
  canvas.width = s.def.w;
  canvas.height = s.def.h;
  canvas.style.width = `${s.def.w * scale}px`;
  canvas.style.height = `${s.def.h * scale}px`;
  const data = rasterize(frame, s.file, {});
  canvas.getContext('2d')?.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, s.def.w, s.def.h), 0, 0);
  return canvas;
}

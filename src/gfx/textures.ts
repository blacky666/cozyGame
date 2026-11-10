import type Phaser from 'phaser';
import type { AssetFile, ColorMap } from './assetTypes';
import { rasterize } from './rasterize';

/** Asset files fetched by loadAssets(); later packages add more names. */
export const ASSET_FILES = ['char-body', 'char-head', 'char-misc', 'outfits'] as const;

export async function loadAssets(): Promise<Record<string, AssetFile>> {
  const base = import.meta.env.BASE_URL;
  const entries = await Promise.all(
    ASSET_FILES.map(async (n) => {
      const res = await fetch(`${base}assets/${n}.json`);
      if (!res.ok) throw new Error(`asset ${n}.json: HTTP ${res.status}`);
      return [n, (await res.json()) as AssetFile] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function hashColors(colors: ColorMap): string {
  return Object.keys(colors)
    .sort()
    .map((k) => `${k}=${colors[k as keyof ColorMap]}`)
    .join(',');
}

/**
 * Build (once) a spritesheet texture for sprite+colors and register its animation.
 * The returned key is both texture key and animation key.
 */
export function getTextureKey(
  scene: Phaser.Scene,
  file: AssetFile,
  sprite: string,
  colors: ColorMap,
): string {
  const def = file.sprites[sprite];
  if (!def) throw new Error(`unknown sprite ${sprite}`);
  const key = `${sprite}|${hashColors(colors)}`;
  if (scene.textures.exists(key)) return key;

  const { w, h, frames } = def;
  const tex = scene.textures.createCanvas(key, w * frames.length, h);
  if (!tex) throw new Error(`could not create texture ${key}`);
  const ctx = tex.getContext();
  frames.forEach((fr, i) => {
    const data = rasterize(fr, file, colors);
    ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), i * w, 0);
    tex.add(i, 0, i * w, 0, w, h);
  });
  tex.refresh();

  scene.anims.create({
    key,
    frames: frames.map((_, i) => ({ key, frame: i })),
    frameRate: def.fps,
    repeat: def.loop ? -1 : 0,
  });
  return key;
}

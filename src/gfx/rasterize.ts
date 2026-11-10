import type { AssetFile, ColorMap, FrameDef } from './assetTypes';

/** Parse '#rrggbb' or '#rrggbbaa' into [r,g,b,a]. */
export function parseHex(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
}

/** Rasterize one frame to RGBA (w*h*4). Width is taken from the first row. */
export function rasterize(frame: FrameDef, file: AssetFile, colors: ColorMap): Uint8ClampedArray {
  const h = frame.rows.length;
  const w = frame.rows[0]?.length ?? 0;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = frame.rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === undefined || ch === '.') continue;
      const slot = file.recolor[ch];
      const hex = (slot && colors[slot]) || file.palette[ch];
      if (!hex) continue;
      out.set(parseHex(hex), (y * w + x) * 4);
    }
  }
  return out;
}

import type { AssetFile } from '../gfx/assetTypes';
import { rasterize } from '../gfx/rasterize';

/** Render ui.favicon.32 to a PNG data URL and set it as page icon; silently does nothing on failure. */
export function setFavicon(assets: Record<string, AssetFile>): void {
  try {
    for (const file of Object.values(assets)) {
      const def = file.sprites['ui.favicon.32'];
      if (!def) continue;
      const canvas = document.createElement('canvas');
      canvas.width = def.w;
      canvas.height = def.h;
      const data = rasterize(def.frames[0], file, {});
      canvas.getContext('2d')?.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, def.w, def.h), 0, 0);
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.append(link);
      }
      link.type = 'image/png';
      link.href = canvas.toDataURL('image/png');
      return;
    }
  } catch {
    /* no favicon is fine */
  }
}

import type { AssetFile } from './assetTypes';

/** Validate an asset file; returns error messages (empty = ok). Phaser-free. */
export function validateAssetFile(name: string, file: AssetFile): string[] {
  const errors: string[] = [];
  const pal = file.palette;
  for (const k of Object.keys(file.recolor ?? {})) {
    if (!(k in pal)) errors.push(`${name}: recolor key '${k}' not in palette`);
  }
  for (const [n, s] of Object.entries(file.sprites)) {
    if (!/^[a-z0-9._]+$/.test(n)) errors.push(`${name}: bad sprite name ${n}`);
    const isBody = n.startsWith('char.body.') || n.startsWith('outfit.');
    s.frames.forEach((fr, i) => {
      const at = `${name}:${n}[${i}]`;
      if (fr.rows.length !== s.h) errors.push(`${at} ${fr.rows.length} rows, expected ${s.h}`);
      fr.rows.forEach((r, y) => {
        if (r.length !== s.w) errors.push(`${at} row ${y} len ${r.length}, expected ${s.w}`);
        for (const ch of r) {
          if (ch !== '.' && !(ch in pal)) errors.push(`${at} unknown key '${ch}'`);
        }
      });
      if (isBody) {
        for (const a of ['head', 'hand', 'back'] as const) {
          if (!fr.anchors?.[a]) errors.push(`${at} missing anchor ${a}`);
        }
      }
    });
  }
  return errors;
}

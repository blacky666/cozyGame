import { readdirSync, readFileSync } from 'node:fs';
import { validateAssetFile } from '../src/gfx/validate';
import type { AssetFile } from '../src/gfx/assetTypes';

const dir = new URL('../public/assets/', import.meta.url);
let errors = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  const file = JSON.parse(readFileSync(new URL(f, dir), 'utf-8')) as AssetFile;
  for (const e of validateAssetFile(f, file)) {
    console.error(e);
    errors++;
  }
}
console.log(`${errors} errors`);
process.exit(errors > 0 ? 1 : 0);

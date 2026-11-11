// Debug render of the arenas: the art (from the asset JSON) with solids (red), unreachable walkable
// cells (magenta), pinch gaps (yellow) and spawns (cyan), plus a text report.
// Usage: npx tsx tools/arena-debug.ts <outDir> [suffix]
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { AssetFile } from '../src/gfx/assetTypes';
import { floodFill, hitboxOverhang, loadArenaCases, pinchGaps, unreachableRegions } from './arenaPassability';

const out = process.argv[2] ?? 'arena-debug';
const suffix = process.argv[3] ?? '';
const SCALE = 3;
mkdirSync(out, { recursive: true });

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

class Canvas {
  px: Uint8Array;
  constructor(public w: number, public h: number) { this.px = new Uint8Array(w * h * 4); }
  set(x: number, y: number, [r, g, b]: number[], a = 1) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const k = (y * this.w + x) * 4;
    this.px[k] = this.px[k] * (1 - a) + r * a;
    this.px[k + 1] = this.px[k + 1] * (1 - a) + g * a;
    this.px[k + 2] = this.px[k + 2] * (1 - a) + b * a;
    this.px[k + 3] = 255;
  }
}
const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

function drawSprite(cv: Canvas, file: AssetFile, name: string, x0: number, y0: number) {
  const def = file.sprites[name];
  if (!def) return;
  def.frames[0].rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const col = file.palette[ch];
    if (!col || ch === '.') return;
    for (let i = 0; i < SCALE; i++) for (let j = 0; j < SCALE; j++) cv.set((x0 + x) * SCALE + i, (y0 + y) * SCALE + j, hex(col));
  }));
}

const report: string[] = [];
for (const c of loadArenaCases()) {
  const { arena: a, file } = c;
  const map = file.maps![c.map];
  const cv = new Canvas(a.w * SCALE, a.h * SCALE);
  for (const grid of [map.layers.boden, map.layers.flaechen, map.layers.rand]) {
    grid.forEach((row, r) => row.forEach((n, col) => { if (n) drawSprite(cv, file, n, col * a.tile, r * a.tile); }));
  }
  [...map.objects].sort((p, q) => p.y + (file.sprites[p.sprite]?.h ?? 0) - q.y - (file.sprites[q.sprite]?.h ?? 0))
    .forEach((o) => drawSprite(cv, file, o.sprite, o.x, o.y));
  const field = floodFill(a, c.spawns, c.r, 1);
  for (let k = 0; k < field.free.length; k++) {
    if (!field.free[k] || field.reach[k]) continue;
    const i = k % field.cols;
    const j = (k - i) / field.cols;
    for (let di = 0; di < SCALE; di++) for (let dj = 0; dj < SCALE; dj++) cv.set(i * SCALE + di, j * SCALE + dj, [255, 0, 255], 0.45);
  }
  for (const s of a.solids) {
    for (let x = s.x * SCALE; x < (s.x + s.w) * SCALE; x++) for (let y = s.y * SCALE; y < (s.y + s.h) * SCALE; y++) {
      const edge = x < s.x * SCALE + 1 || y < s.y * SCALE + 1 || x >= (s.x + s.w) * SCALE - 1 || y >= (s.y + s.h) * SCALE - 1;
      cv.set(x, y, [255, 0, 0], edge ? 1 : 0.25);
    }
  }
  const gaps = pinchGaps(c, 2, field);
  for (const g of gaps) for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) cv.set(g.x * SCALE + i, g.y * SCALE + j, g.problem ? [255, 230, 0] : [0, 160, 0]);
  for (const [x, y] of c.spawns) for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) cv.set(x * SCALE + i, y * SCALE + j, [0, 255, 255]);
  writeFileSync(`${out}/${c.name}${suffix}.png`, png(cv.w, cv.h, cv.px));

  report.push(`== ${c.name}: ${a.solids.length} solids, r=${c.r}`);
  report.push('pinch gaps (< 2r+2 and reachable; problem = tight | looksOpen):');
  for (const g of gaps) report.push(`  ${g.problem ?? 'ok (looks closed)'}: hitbox gap ${g.gap}px, art gap ${g.artGap}px at (${g.x.toFixed(1)},${g.y.toFixed(1)}): ${g.a} <-> ${g.b}`);
  report.push('unreachable walkable regions (feet circle, 1 px grid):');
  for (const r of unreachableRegions(c, field)) report.push(`  ${r.cells} cells, x ${r.x0}..${r.x1}, y ${r.y0}..${r.y1}${r.hidden ? ' (hidden under art)' : ' VISIBLE'}`);
  report.push('hitbox overhang beyond the art (px top/bottom/left/right):');
  const sprites = new Set(a.solids.map((s) => s.sprite));
  for (const s of sprites) {
    const o = hitboxOverhang(file, s);
    if (o && (o.top || o.bottom || o.left || o.right)) report.push(`  ${s} hb ${JSON.stringify(file.sprites[s].hitbox)}: ${o.top}/${o.bottom}/${o.left}/${o.right}`);
  }
  report.push('solids:');
  for (const s of a.solids.filter((x) => x.kind === 'object')) report.push(`  ${s.id} ${s.sprite} x ${s.x}..${s.x + s.w} y ${s.y}..${s.y + s.h}`);
}
writeFileSync(`${out}/report${suffix}.txt`, report.join('\n'));
console.log(report.join('\n'));

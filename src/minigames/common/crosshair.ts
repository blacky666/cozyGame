import type Phaser from 'phaser';

export const CROSSHAIR_DEPTH = 3000;
export const CROSSHAIR_OUTLINE = 0x3b2418;
/** Alpha of the crosshair while the own player cannot throw. */
export const CROSSHAIR_DIM = 0.4;
/**
 * Crosshair, 13x13 around the pointer pixel (0, 0): four arms 5 px long and 2 px thick around an
 * empty 3x3 centre. [x, y, w, h] of each arm and of its 1 px outline; the outline leaves the inner
 * end open so the centre gap stays 3x3. With an even thickness inside an odd box the arms sit on
 * pixel rows/columns 0 and 1 (half a pixel off the box centre).
 */
const CROSSHAIR_ARMS: ReadonlyArray<readonly [readonly number[], readonly number[]]> = [
  [[2, 0, 5, 2], [2, -1, 6, 4]],
  [[-6, 0, 5, 2], [-7, -1, 6, 4]],
  [[0, 2, 2, 5], [-1, 2, 4, 6]],
  [[0, -6, 2, 5], [-1, -7, 4, 6]],
];

/** Own crosshair in the player colour ('#rrggbb'), hidden until the view's frame() places it. */
export function drawCrosshair(scene: Phaser.Scene, color: string): Phaser.GameObjects.Graphics {
  const fill = Number.parseInt(color.replace('#', ''), 16);
  const g = scene.add.graphics().setDepth(CROSSHAIR_DEPTH).setVisible(false);
  g.fillStyle(CROSSHAIR_OUTLINE, 1);
  for (const [, [x, y, w, h]] of CROSSHAIR_ARMS) g.fillRect(x, y, w, h);
  g.fillStyle(Number.isFinite(fill) ? fill : 0xffffff, 1);
  for (const [[x, y, w, h]] of CROSSHAIR_ARMS) g.fillRect(x, y, w, h);
  return g;
}

/** World pixel under the pointer, or null while the pointer is off the canvas. */
export function pointerPixel(scene: Phaser.Scene): { x: number; y: number } | null {
  const input = scene.input;
  if (!input?.manager || !input.isOver) return null;
  const p = input.activePointer;
  const w = scene.cameras.main.getWorldPoint(p.x, p.y);
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}

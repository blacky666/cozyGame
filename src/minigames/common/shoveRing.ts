import type Phaser from 'phaser';
import { CONFIG } from '../../config';

/** Filling ellipse under the feet while the shove cools down; cleared (hidden) when ready. */
export function drawShoveRing(ring: Phaser.GameObjects.Graphics, x: number, y: number, cdMs: number): void {
  const g = ring.clear();
  if (cdMs <= 0) return;
  const done = 1 - cdMs / CONFIG.shove.cooldownMs;
  g.setPosition(x, y + 1).setScale(1, 0.5).setDepth(y - 1);
  g.lineStyle(2, 0x3b2418, 0.35).strokeCircle(0, 0, 10);
  g.lineStyle(2, 0xfff4a8, 0.9).beginPath();
  g.arc(0, 0, 10, -Math.PI / 2, -Math.PI / 2 + done * Math.PI * 2, false).strokePath();
}

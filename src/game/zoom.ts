import type Phaser from 'phaser';
import { CONFIG } from '../config';

/** Largest whole-number scale at which the view fits the window (pixel art stays crisp); at least 1. */
export function integerZoom(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.min(width / CONFIG.view.width, height / CONFIG.view.height)));
}

/** Registry key holding the stage's current whole-number zoom. */
export const ZOOM_KEY = 'zoom';

/** Current zoom of the game a scene belongs to (1 when no stage set one). */
export const zoomOf = (scene: Phaser.Scene): number => (scene.registry.get(ZOOM_KEY) as number | undefined) ?? 1;

/** Zoom the scene's main camera from the top-left so the 426x240 world fills the canvas. */
export function fitCamera(scene: Phaser.Scene): void {
  scene.cameras.main.setOrigin(0, 0).setZoom(zoomOf(scene)).setScroll(0, 0);
}

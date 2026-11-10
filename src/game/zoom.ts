import { CONFIG } from '../config';

/** Largest whole-number scale at which the view fits the window (pixel art stays crisp); at least 1. */
export function integerZoom(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.min(width / CONFIG.view.width, height / CONFIG.view.height)));
}

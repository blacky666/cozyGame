import Phaser from 'phaser';
import { CONFIG } from '../../config';
import { loadAssets } from '../../gfx/textures';
import { FONT } from '../ui';
import { fitCamera, zoomOf } from '../zoom';

/** Loads the asset JSONs and the pixel font, then hands over to the stage. */
export class BootScene extends Phaser.Scene {
  constructor(private readonly onReady: () => void) {
    super('BootScene');
  }

  create(): void {
    // Boot starts before the stage hooks scene creation, so it fits its own camera.
    fitCamera(this);
    const label = this.add
      .text(CONFIG.view.width / 2, CONFIG.view.height / 2, 'Lade …', { fontFamily: FONT, fontSize: '10px', color: '#ffffff', resolution: zoomOf(this) })
      .setOrigin(0.5);
    const font = document.fonts?.load(`10px ${FONT}`).catch(() => undefined) ?? Promise.resolve();
    void Promise.all([loadAssets(), font]).then(
      ([assets]) => {
        this.registry.set('assets', assets);
        label.destroy();
        this.onReady();
      },
      (e: unknown) => {
        console.error('assets failed to load', e);
        label.setText('Grafiken konnten nicht geladen werden. Bitte Seite neu laden.');
      },
    );
  }
}

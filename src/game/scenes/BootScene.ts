import Phaser from 'phaser';
import { loadAssets } from '../../gfx/textures';
import { FONT } from '../ui';

/** Loads the asset JSONs and the pixel font, then hands over to the stage. */
export class BootScene extends Phaser.Scene {
  constructor(private readonly onReady: () => void) {
    super('BootScene');
  }

  create(): void {
    const label = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Lade …', { fontFamily: FONT, fontSize: '10px', color: '#ffffff' })
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

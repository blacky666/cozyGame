import Phaser from 'phaser';
import { CONFIG } from '../../config';
import type { SceneData } from '../stageCtx';
import { button, txt } from '../ui';

export const HOST_LEFT = 'Der Gastgeber hat den Abend verlassen.';

/** ended/host_left: shown on clients when the host disappears mid-evening. */
export class EndedScene extends Phaser.Scene {
  constructor() {
    super('EndedScene');
  }

  create({ ctx }: SceneData<'ended'>): void {
    const { width: w, height: h } = CONFIG.view;
    this.add.rectangle(0, 0, w, h, 0x2b2b3d).setOrigin(0);
    this.add.rectangle(w / 2, h / 2, 300, 90, 0xefdcb0).setStrokeStyle(3, 0x8a5a3a);
    txt(this, w / 2, h / 2 - 18, HOST_LEFT, 11);
    button(this, w / 2, h / 2 + 20, 'Zurück zum Start', () => ctx.backToStart());
  }
}

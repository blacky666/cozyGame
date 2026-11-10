import Phaser from 'phaser';
import { CONFIG } from '../../config';
import { Character } from '../../gfx/character';
import type { SceneData } from '../stageCtx';
import { assetSprite, assetsOf, button, byKey, txt } from '../ui';

const GROUND = 196;
/** Step x positions and heights for places 1-3 (ui.podest.N sprites). */
const STEPS: Record<number, { x: number; h: number }> = { 1: { x: 213, h: 40 }, 2: { x: 163, h: 30 }, 3: { x: 263, h: 22 } };

/** Final podium: places 1-3 on wooden steps, the rest beside them; host can start over. */
export class PodiumScene extends Phaser.Scene {
  constructor() {
    super('PodiumScene');
  }

  create({ phase, ctx }: SceneData<'podium'>): void {
    const { width: w, height: h } = CONFIG.view;
    const info = byKey(ctx.players());
    const assets = assetsOf(this);
    this.add.rectangle(0, 0, w, h, 0x2b2b3d).setOrigin(0);
    this.add.rectangle(0, GROUND, w, h - GROUND, 0x5b8c3a).setOrigin(0);
    txt(this, w / 2, 16, 'Siegerehrung', 16, '#ffd27a');
    assetSprite(this, 'ui.pokal', w / 2 - 70, 16);
    assetSprite(this, 'ui.pokal', w / 2 + 70, 16);

    for (const n of [1, 2, 3]) {
      const s = STEPS[n];
      const step = assetSprite(this, `ui.podest.${n}`, s.x, GROUND);
      if (step) step.setOrigin(0.5, 1);
      else this.add.rectangle(s.x, GROUND, 40, s.h, 0x8a5a3a).setOrigin(0.5, 1);
    }

    let place = 1;
    let besideX = 320;
    phase.ranking.forEach((group, gi) => {
      const last = phase.ranking.length > 1 && gi === phase.ranking.length - 1;
      group.forEach((key, i) => {
        const p = info.get(key);
        const step = STEPS[place];
        const off = (i - (group.length - 1) / 2) * 14;
        const x = step ? step.x + off : (besideX += 34);
        const y = step ? GROUND - step.h + 2 : GROUND;
        if (p) {
          const c = new Character(this, assets, p.look, p.slot).setPosition(x, y).setDepth(y);
          c.play(last ? 'cry' : 'cheer', 'down');
        }
        txt(this, x, y - 44 - (i % 2) * 10, `${p?.name ?? key}`, 8).setDepth(500);
        txt(this, x, y - 35 - (i % 2) * 10, `${phase.totals[key] ?? 0} P.`, 8, '#ffd27a').setDepth(500);
      });
      place += group.length;
    });

    if (ctx.isHost && ctx.playAgain) {
      const again = ctx.playAgain;
      button(this, w / 2, h - 18, 'Nochmal?', () => again()).setDepth(1000);
    } else {
      txt(this, w / 2, h - 18, 'Warte auf den Gastgeber …', 9).setDepth(1000);
    }
  }
}

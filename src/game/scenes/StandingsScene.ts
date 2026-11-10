import Phaser from 'phaser';
import { CONFIG } from '../../config';
import { Character } from '../../gfx/character';
import type { SceneData } from '../stageCtx';
import { assetsOf, byKey, playerSymbol, txt } from '../ui';

export const CARD_PLACEHOLDER = 'Gemeinheit-Karte (kommt in Plan 7)';

const ROW_H = 32;
const TOP = 46;

/** Ranking after a round: the round points fly into the totals. */
export class StandingsScene extends Phaser.Scene {
  constructor() {
    super('StandingsScene');
  }

  create({ phase, ctx }: SceneData<'standings'>): void {
    const { width: w, height: h } = CONFIG.view;
    const info = byKey(ctx.players());
    const assets = assetsOf(this);
    this.add.rectangle(0, 0, w, h, 0x2b2b3d).setOrigin(0);
    txt(this, w / 2, 20, `Zwischenstand nach Runde ${phase.round}`, 14, '#ffd27a');

    const keys = Object.keys(phase.totals).sort((a, b) => phase.totals[b] - phase.totals[a] || a.localeCompare(b));
    // Animation timing: rows appear, then the points fly over (well within standings.showMs).
    const flyAt = Math.min(1200, ctx.timing.standingsMs * 0.25);
    let rank = 0;
    keys.forEach((key, i) => {
      if (i === 0 || phase.totals[key] !== phase.totals[keys[i - 1]]) rank = i + 1;
      const y = TOP + i * ROW_H + ROW_H / 2;
      const p = info.get(key);
      const pts = phase.points[key] ?? 0;
      const total = phase.totals[key];
      this.add.rectangle(w / 2, y, w - 80, ROW_H - 4, 0xefdcb0).setStrokeStyle(2, 0x8a5a3a);
      txt(this, 58, y, `${rank}.`, 12);
      if (p) {
        new Character(this, assets, p.look, p.slot).setPosition(86, y + 13);
        playerSymbol(this, p.slot, 108, y);
      }
      txt(this, 118, y, p?.name ?? key, 11).setOrigin(0, 0.5);
      const totalText = txt(this, 330, y, `${total - pts}`, 12, '#ffd27a');
      const plus = txt(this, 380, y, `+${pts}`, 11, pts > 0 ? '#9be37a' : '#dddddd');
      this.tweens.add({
        targets: plus,
        x: 330,
        alpha: 0,
        delay: flyAt + i * 150,
        duration: 600,
        ease: 'Quad.easeIn',
        onComplete: () => {
          totalText.setText(String(total));
          this.tweens.add({ targets: totalText, scale: 1.3, yoyo: true, duration: 150 });
        },
      });
    });

    // Placeholder for the prank card picked by the last player (Plan 7).
    const boxY = TOP + keys.length * ROW_H + 18;
    this.add.rectangle(w / 2, boxY, 220, 22, 0x3b2a4a).setStrokeStyle(1, 0xffd27a);
    txt(this, w / 2, boxY, CARD_PLACEHOLDER, 9, '#ffd27a');
  }
}

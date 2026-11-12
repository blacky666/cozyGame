import Phaser from 'phaser';
import { sound } from '../../audio/sound';
import { CONFIG } from '../../config';
import { getMinigame } from '../../minigames/registry';
import { introCardLine } from '../cardText';
import type { SceneData } from '../stageCtx';
import { assetSprite, byKey, INK, txt } from '../ui';

export const DOUBLE_BANNER = 'Letzte Runde – doppelte Punkte!';

/** Title, rule and controls for ruleMs, then the 3-2-1 countdown ("LOS!" opens the MinigameScene). */
export class RoundIntroScene extends Phaser.Scene {
  constructor() {
    super('RoundIntroScene');
  }

  create({ phase, ctx }: SceneData<'intro'>): void {
    const { width: w, height: h } = CONFIG.view;
    const game = getMinigame(phase.game);
    this.add.rectangle(0, 0, w, h, 0x2b2b3d).setOrigin(0);
    this.add.rectangle(w / 2, h / 2 + 8, w - 60, 150, 0xefdcb0).setStrokeStyle(3, 0x8a5a3a);

    if (phase.double) {
      this.add.rectangle(w / 2, 22, w - 40, 22, 0xb8443a).setStrokeStyle(2, 0x3b2418);
      const banner = txt(this, w / 2, 22, DOUBLE_BANNER, 12, '#fff4de');
      this.tweens.add({ targets: banner, scale: 1.08, yoyo: true, repeat: -1, duration: 450 });
    }

    const info = [
      txt(this, w / 2, 60, `Runde ${phase.round}`, 12, INK),
      txt(this, w / 2, 86, game?.title ?? phase.game, 22, '#ffd27a'),
      txt(this, w / 2, 124, game?.rule ?? '', 13, INK).setWordWrapWidth(w - 90),
      txt(this, w / 2, 168, game ? `Steuerung: ${game.controls}` : '', 11, INK).setWordWrapWidth(w - 90),
    ];
    const players = byKey(ctx.players());
    const cardLine = introCardLine(phase.card, (k) => players.get(k)?.name ?? k);
    if (cardLine) info.push(txt(this, w / 2, 196, cardLine, 11, '#b8443a', false).setWordWrapWidth(w - 90));

    // One opener: last round > evening start > the game's own jingle.
    sound.setMusic(null);
    if (phase.double) sound.play('ablauf.letzte_runde');
    else if (phase.round === 1) sound.play('ui.abend_start');
    else sound.playRound(game?.sounds, 'jingle_runde_start');
    const step = ctx.timing.countdownMs / 3;
    let shown: Phaser.GameObjects.GameObject | null = null;
    const show = (n: number) => {
      shown?.destroy();
      sound.playRound(game?.sounds, 'countdown_tick');
      shown = assetSprite(this, `ui.countdown.${n}`, w / 2, h / 2 + 8) ?? txt(this, w / 2, h / 2 + 8, String(n), 40);
    };
    this.time.delayedCall(ctx.timing.ruleMs, () => {
      info.forEach((t) => t.setAlpha(0.25));
      show(3);
      this.time.delayedCall(step, () => show(2));
      this.time.delayedCall(step * 2, () => show(1));
    });
  }
}

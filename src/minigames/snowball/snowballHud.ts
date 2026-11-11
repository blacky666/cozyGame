import type Phaser from 'phaser';
import { CONFIG } from '../../config';
import { byKey, pivotSprite, playerSymbol, swapSprite, txt } from '../../game/ui';
import type { GamePlayer, PlayerKey } from '../types';
import type { SnowState } from './snowballHost';

const BAR_W = 16;
const BAR_H = 3;
/** Charge bar top, relative to the feet (between the player symbol and the name label). */
const BAR_DY = -38;

/**
 * Schneeball HUD: top bar like Münzjagd (symbol + score per player, time in the middle), the own
 * player's ammo bottom-left and the charge bar above the own figure while the button is held.
 */
export class SnowballHud {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly scores = new Map<PlayerKey, Phaser.GameObjects.Text>();
  private readonly ammo: Phaser.GameObjects.Sprite[] = [];
  private readonly time: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    players: GamePlayer[],
  ) {
    const { width, height } = CONFIG.view;
    this.objects.push(scene.add.rectangle(0, 0, width, 16, 0x3b2418, 0.55).setOrigin(0).setDepth(1000));
    this.time = txt(scene, width / 2, 8, '', 10).setDepth(1001);
    this.objects.push(this.time);
    [...byKey(players).entries()].forEach(([key, p], i) => {
      const x = i < 2 ? 14 + i * 50 : width - 86 + (i - 2) * 50;
      const sym = playerSymbol(scene, p.slot, x, 8)?.setDepth(1001);
      if (sym) this.objects.push(sym);
      const t = txt(scene, x + 8, 8, '0', 10).setOrigin(0, 0.5).setDepth(1001);
      this.scores.set(key, t);
      this.objects.push(t);
    });
    for (let i = 0; i < CONFIG.snowball.maxBalls; i++) {
      const s = pivotSprite(scene, 'schnee.munition.voll', 10 + i * 9, height - 10);
      if (!s) continue;
      s.setDepth(1001);
      this.ammo.push(s);
      this.objects.push(s);
    }
    this.bar = scene.add.graphics().setDepth(1001);
    this.objects.push(this.bar);
  }

  update(s: SnowState, selfKey: PlayerKey): void {
    for (const [key, t] of this.scores) {
      const p = s.players[key];
      if (p) t.setText(String(p.score));
    }
    this.time.setText(`${Math.ceil(s.timeLeftMs / 1000)} s`);
    const balls = s.players[selfKey]?.balls ?? 0;
    this.ammo.forEach((a, i) => swapSprite(this.scene, a, i < balls ? 'schnee.munition.voll' : 'schnee.munition.leer'));
  }

  /** Charge bar above the own figure at feet (x, y); null hides it. */
  drawCharge(x: number, y: number, charge: number | null): void {
    const g = this.bar.clear();
    if (charge === null) return;
    const left = x - BAR_W / 2;
    const top = y + BAR_DY;
    g.fillStyle(0x3b2418, 0.8).fillRect(left - 1, top - 1, BAR_W + 2, BAR_H + 2);
    g.fillStyle(charge >= 1 ? 0xffffff : 0xfff4a8, 1).fillRect(left, top, Math.round(BAR_W * charge), BAR_H);
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.scores.clear();
    this.ammo.length = 0;
  }
}

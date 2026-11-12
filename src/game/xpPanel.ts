import Phaser from 'phaser';
import { sound } from '../audio/sound';
import { itemLabel, itemSprite } from '../progress/items';
import type { PodiumStep } from '../progress/podiumScript';
import { assetSprite, INK, nineSlice, txt } from './ui';

// Panel box on the podium's left side (virtual px).
const X = 6;
const Y = 34;
const W = 144;
const H = 156;
const CX = X + W / 2;
const PAD = 7;
const ROW_Y = Y + 22;
const ROW_H = 10;
const MAX_ROWS = 8;
const LEVEL_Y = Y + 108;
const BAR_Y = LEVEL_Y + 10;
const BAR_W = W - 2 * PAD;
const BAR_H = 10;
const TIP_Y = Y + H - 9;
/** Centre of the level-up / unlock card. */
const CARD_Y = Y + 66;
const GOLD = '#ffd27a';
const DEPTH = 1500;

/** Shorten a text object with "…" until it fits `max` px. */
function fit(t: Phaser.GameObjects.Text, max: number): void {
  let s = t.text;
  while (t.width > max && s.length > 2) {
    s = s.slice(0, -1);
    t.setText(`${s.trimEnd()}…`);
  }
}

/**
 * The podium's XP panel (spec §4 step 6): plays a podiumScript timeline – item rows, the level bar,
 * "Level Up!", unlock cards, boxes and the save tip. Drawing only; the XP is already saved.
 */
export class XpPanel {
  private readonly objs: Phaser.GameObjects.GameObject[] = [];
  private card: Phaser.GameObjects.GameObject[] = [];
  private rows = 0;
  private readonly levelText: Phaser.GameObjects.Text;
  private readonly fill: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
  private readonly numbers: Phaser.GameObjects.Text;
  private fillTween: Phaser.Tweens.Tween | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly steps: PodiumStep[],
    level: number,
    into: number,
    need: number,
  ) {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => this.add(o);
    add(nineSlice(scene, 'ui.panel.karte', X, Y, W, H));
    add(txt(scene, CX, Y + 10, 'Deine XP', 12, INK));
    const badge = assetSprite(scene, 'ui.icon.level_abzeichen', X + PAD + 8, LEVEL_Y);
    if (badge) add(badge);
    this.levelText = add(txt(scene, X + PAD + 20, LEVEL_Y, `Level ${level}`, 10, INK).setOrigin(0, 0.5));
    add(nineSlice(scene, 'ui.balken.xp.rahmen', X + PAD, BAR_Y, BAR_W, BAR_H, 0x3b2418));
    const f = assetSprite(scene, 'ui.balken.xp.fuellung', X + PAD + 2, BAR_Y + 2);
    this.fill = add(f ?? scene.add.rectangle(X + PAD + 2, BAR_Y + 2, 1, BAR_H - 4, 0x7ad0ff));
    this.fill.setOrigin(0, 0);
    this.numbers = add(txt(scene, CX, BAR_Y + BAR_H + 7, '', 10, INK));
    this.setBar(into, need);
  }

  /** Schedule every step (call at podium.startMs). */
  start(): void {
    for (const s of this.steps) this.scene.time.delayedCall(s.at, () => this.run(s));
  }

  destroy(): void {
    this.fillTween?.stop();
    for (const o of [...this.objs, ...this.card]) o.destroy();
  }

  private add<T extends Phaser.GameObjects.GameObject>(o: T, card = false): T {
    (o as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(card ? DEPTH + 10 : DEPTH);
    (card ? this.card : this.objs).push(o);
    return o;
  }

  private setBar(into: number, need: number): void {
    const frac = need > 0 ? Math.max(0, Math.min(1, into / need)) : 0;
    this.fill.setDisplaySize(Math.max(0.001, (BAR_W - 4) * frac), BAR_H - 4);
    this.fill.setVisible(frac > 0);
    this.numbers.setText(`${Math.round(into)} / ${need} XP`);
  }

  private clearCard(): void {
    for (const o of this.card) o.destroy();
    this.card = [];
  }

  private run(s: PodiumStep): void {
    const sc = this.scene;
    switch (s.kind) {
      case 'item': {
        if (this.rows >= MAX_ROWS) return;
        const y = ROW_Y + this.rows++ * ROW_H;
        const xp = this.add(txt(sc, X + W - PAD, y, `+${s.xp}`, 10, INK).setOrigin(1, 0.5));
        const label = this.add(txt(sc, X + PAD, y, s.label, 10, INK).setOrigin(0, 0.5));
        fit(label, W - 2 * PAD - xp.width - 6);
        sound.play('ablauf.xp_klimpern');
        return;
      }
      case 'bar': {
        this.clearCard();
        this.levelText.setText(`Level ${s.level}`);
        this.fillTween?.stop();
        const v = { x: s.from };
        this.setBar(s.from, s.need);
        this.fillTween = sc.tweens.add({ targets: v, x: s.to, duration: s.ms, onUpdate: () => this.setBar(v.x, s.need) });
        return;
      }
      case 'levelUp': {
        this.clearCard();
        this.levelText.setText(`Level ${s.level}`);
        this.add(nineSlice(sc, 'ui.panel.karte', X + 2, ROW_Y - 6, W - 4, LEVEL_Y - ROW_Y - 2), true);
        const rays = assetSprite(sc, 'ui.levelup.strahlen', CX, CARD_Y);
        if (rays) this.add(rays, true);
        this.add(txt(sc, CX, ROW_Y + 2, 'Level Up!', 16, GOLD), true);
        sound.play('ablauf.level_up');
        return;
      }
      case 'unlock': {
        const frame = assetSprite(sc, 'ui.belohnung.rahmen', CX, CARD_Y);
        if (frame) this.add(frame, true);
        const icon = assetSprite(sc, itemSprite(s.item), CX, CARD_Y);
        if (icon) this.add(icon, true);
        const neu = assetSprite(sc, 'ui.icon.neu', CX + 22, CARD_Y - 20);
        if (neu) this.add(neu, true);
        const t = this.add(txt(sc, CX, CARD_Y + 30, `Neu: ${itemLabel(s.item)}`, 10, GOLD), true);
        fit(t, W - 8);
        this.scene.time.delayedCall(250, () => sound.play('ablauf.freischaltung'));
        return;
      }
      case 'box': {
        this.clearCard();
        this.add(nineSlice(sc, 'ui.panel.karte', X + 2, ROW_Y - 6, W - 4, LEVEL_Y - ROW_Y - 2), true);
        const box = assetSprite(sc, 'ui.kiste.wackeln', CX, CARD_Y + 22);
        if (box) this.add(box, true);
        sound.play('ablauf.ueberraschung');
        sc.time.delayedCall(500, () => {
          box?.destroy();
          const opening = assetSprite(sc, 'ui.kiste.oeffnen', CX, CARD_Y + 22);
          if (opening) this.add(opening, true);
          sc.time.delayedCall(450, () => {
            opening?.destroy();
            const open = assetSprite(sc, 'ui.kiste.offen', CX, CARD_Y + 22);
            if (open) this.add(open, true);
            const prize = assetSprite(sc, s.item ? itemSprite(s.item) : 'ui.icon.stern', CX, CARD_Y - 26);
            if (prize) this.add(prize, true);
            const t = this.add(txt(sc, CX, CARD_Y + 32, s.item ? `Neu: ${itemLabel(s.item)}` : 'Bonus-Stern!', 10, GOLD), true);
            fit(t, W - 8);
          });
        });
        return;
      }
      case 'tip':
        this.add(txt(sc, CX, TIP_Y, 'Tipp: Spielstand sichern (Profil)', 10, INK).setWordWrapWidth(W - 2 * PAD));
        return;
    }
  }
}

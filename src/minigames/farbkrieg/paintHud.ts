import type Phaser from 'phaser';
import { CONFIG } from '../../config';
import { byKey, INK, pivotSprite, playerColor, playerSymbol, swapSprite, txt } from '../../game/ui';
import type { GamePlayer, PlayerKey } from '../types';
import type { ExtraKind, PaintState } from './paintHost';

const HUD_DEPTH = 1000;
/** Top band: symbols in the upper row, the stacked bar below with the time on its middle. */
const BAND_H = 24;
const SYMBOL_Y = 7;
const BAR_X = 8;
const BAR_Y = 14;
const BAR_H = 6;
const TIME_Y = 17;
/** Symbols never overlap: at least this far apart (they are 8 px wide). */
const SYMBOL_GAP = 9;
const INK_FILL = 0x3b2418;
/** Unpainted share of the floor. */
const NEUTRAL = 0xd9c393;
/** Parchment box like the Schneeball ammo box. */
const BOX_PANEL = 0xefdcb0;
const BOX_BORDER = 0x8a5a3a;
const BOX_X = 3;
const BOX_W = 93;
const BOX_H = 17;
/** Extra slot (left in the box) and the Klecks cooldown bar (right). */
const SLOT = 12;
const SLOT_X = 5;
const CD_X = 56;
const CD_W = 32;
const CD_H = 7;
const CD_READY = 0xe8a23a;
const CD_COOL = 0xb59a78;
const CD_TRACK = 0xd9c393;

const PICKUP_SPRITE = (kind: ExtraKind) => `farbkrieg.pickup.${kind}`;
const hex = (c: string) => {
  const n = Number.parseInt(c.replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0xffffff;
};

type Entry = { slot: number; color: number; sym: Phaser.GameObjects.Sprite | null };

/**
 * Farbkrieg HUD: the floor shares as a stacked bar in player colours (each player's symbol above its
 * segment, the time in the middle) and bottom-left the own held extra and the Klecks cooldown.
 */
export class PaintHud {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly entries = new Map<PlayerKey, Entry>();
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly time: Phaser.GameObjects.Text;
  private readonly icon: Phaser.GameObjects.Sprite | null;
  private readonly cd: Phaser.GameObjects.Graphics;
  private readonly barW: number;
  /** State the bar / cooldown were drawn for (redrawn only on change). */
  private barFor = '';
  private cdFor = '';
  private extra: ExtraKind | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    players: GamePlayer[],
    /** Paintable tiles of the floor (the 100 % of the bar). */
    private readonly total: number,
  ) {
    const { width, height } = CONFIG.view;
    this.barW = width - 2 * BAR_X;
    this.objects.push(scene.add.rectangle(0, 0, width, BAND_H, INK_FILL, 0.55).setOrigin(0).setDepth(HUD_DEPTH));
    this.bar = scene.add.graphics().setPosition(BAR_X, BAR_Y).setDepth(HUD_DEPTH + 1);
    this.time = txt(scene, width / 2, TIME_Y, '', 10).setDepth(HUD_DEPTH + 2);
    this.objects.push(this.bar, this.time);
    for (const [key, p] of [...byKey(players).entries()].sort((a, b) => a[1].slot - b[1].slot)) {
      const sym = playerSymbol(scene, p.slot, 0, SYMBOL_Y)?.setDepth(HUD_DEPTH + 1) ?? null;
      if (sym) this.objects.push(sym);
      this.entries.set(key, { slot: p.slot, color: hex(playerColor(scene, p.slot)), sym });
    }

    const top = height - 19;
    const mid = height - 10;
    const box = scene.add.rectangle(BOX_X, top, BOX_W, BOX_H, BOX_PANEL).setOrigin(0).setStrokeStyle(2, BOX_BORDER).setDepth(HUD_DEPTH);
    const slot = scene.add
      .rectangle(BOX_X + SLOT_X, mid - SLOT / 2, SLOT, SLOT, CD_TRACK)
      .setOrigin(0)
      .setStrokeStyle(1, BOX_BORDER)
      .setDepth(HUD_DEPTH + 1);
    // Pickup sprites are 16x16 with the pivot at the bottom centre.
    this.icon = pivotSprite(scene, PICKUP_SPRITE('farbbombe'), BOX_X + SLOT_X + SLOT / 2, mid + 7)?.setDepth(HUD_DEPTH + 2).setVisible(false) ?? null;
    const label = txt(scene, BOX_X + SLOT_X + SLOT + 4, mid, 'Klecks', 10, INK).setOrigin(0, 0.5).setDepth(HUD_DEPTH + 1);
    this.cd = scene.add.graphics().setPosition(BOX_X + CD_X, mid - Math.floor(CD_H / 2)).setDepth(HUD_DEPTH + 1);
    this.objects.push(box, slot, label, this.cd, ...(this.icon ? [this.icon] : []));
  }

  update(s: PaintState, selfKey: PlayerKey): void {
    this.time.setText(`${Math.ceil(s.timeLeftMs / 1000)} s`);
    this.drawBar(s);
    const me = s.players[selfKey];
    const extra = me?.extra ?? null;
    if (extra !== this.extra) {
      this.extra = extra;
      if (this.icon && extra) swapSprite(this.scene, this.icon, PICKUP_SPRITE(extra));
      this.icon?.setVisible(extra !== null);
    }
    this.drawCooldown(me?.klecksCdMs ?? 0);
  }

  /** Segments in slot order (left to right), the unpainted rest on the right. */
  private drawBar(s: PaintState): void {
    const tiles = [...this.entries.keys()].map((k) => s.players[k]?.tiles ?? 0);
    const key = tiles.join(',');
    if (key === this.barFor) return;
    this.barFor = key;
    const g = this.bar.clear();
    const w = this.barW;
    g.fillStyle(INK_FILL, 1).fillRect(-1, -1, w + 2, BAR_H + 2);
    g.fillStyle(NEUTRAL, 1).fillRect(0, 0, w, BAR_H);
    const total = Math.max(1, this.total);
    let sum = 0;
    let x0 = 0;
    let lastSym = -Infinity;
    [...this.entries.values()].forEach((e, i) => {
      sum += tiles[i];
      const x1 = Math.round((w * Math.min(sum, total)) / total);
      if (x1 > x0) g.fillStyle(e.color, 1).fillRect(x0, 0, x1 - x0, BAR_H);
      // Symbol over the middle of its segment, kept on the bar and clear of the previous symbol.
      const sx = Math.min(w - 4, Math.max(4, (x0 + x1) / 2, lastSym + SYMBOL_GAP));
      lastSym = sx;
      e.sym?.setPosition(Math.round(BAR_X + sx), SYMBOL_Y);
      x0 = x1;
    });
  }

  /** The bar fills up while the Klecks recharges; full and bright when ready. */
  private drawCooldown(cdMs: number): void {
    const cool = cdMs > 0;
    const fill = cool ? Math.round(CD_W * (1 - Math.min(1, cdMs / CONFIG.farbkrieg.klecksCooldownMs))) : CD_W;
    const key = `${fill}|${cool}`;
    if (key === this.cdFor) return;
    this.cdFor = key;
    const g = this.cd.clear();
    g.fillStyle(INK_FILL, 1).fillRect(-1, -1, CD_W + 2, CD_H + 2);
    g.fillStyle(CD_TRACK, 1).fillRect(0, 0, CD_W, CD_H);
    if (fill > 0) g.fillStyle(cool ? CD_COOL : CD_READY, 1).fillRect(0, 0, fill, CD_H);
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.entries.clear();
  }
}

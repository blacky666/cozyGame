import type Phaser from 'phaser';
import { CONFIG } from '../../config';
import { byKey, playerColor, playerSymbol, txt } from '../../game/ui';
import type { GamePlayer, PlayerKey } from '../types';
import type { ArmedAction, TowerState } from './towerHost';
import type { TowerLayout } from './towerLayout';

const HUD_DEPTH = 1000;
const INK_FILL = 0x3b2418;
/** Top band with the time in its middle. */
export const BAND_H = 16;
/** Column rows (main camera): name, height + charges, armed card. */
const NAME_Y = 23;
const HEIGHT_Y = 34;
const ARMED_Y = 45;
/** Below the armed card: the Windstoß immunity of a column. */
const IMMUNE_Y = 56;
/** Bottom edge of the column HUD rows (the immunity row is the lowest, 10 px text). */
export const HUD_ROWS_BOTTOM = IMMUNE_Y + 6;
const IMMUNE_COLOR = '#bfe6ff';
/** An absent player's column: dimmed rows and a label in the armed row. */
const AWAY_ALPHA = 0.4;
const AWAY_TEXT = 'abwesend';
const AWAY_COLOR = '#c8c8c8';
const PAD = 4;
const SYMBOL_W = 8;
const PIP = 5;
const PIP_GAP = 4;
/** 16 px are one metre. */
const PX_PER_M = 16;
const BLINK_MS = 250;
const SELF_COLOR = '#fff4a8';
const CARD: Record<ArmedAction, string> = { wind: 'Windstoß', fies: 'Fieser Klotz' };

const hex = (c: string) => {
  const n = Number.parseInt(c.replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0xffffff;
};

/** "windfest 7 s": a column that cannot get another Windstoß yet. */
export const immuneLabel = (ms: number): string => `windfest ${Math.ceil(ms / 1000)} s`;

/** "4,2 m" for a height in px. */
export const metres = (px: number): string => `${(px / PX_PER_M).toFixed(1).replace('.', ',')} m`;

type Column = {
  left: number;
  w: number;
  name: Phaser.GameObjects.Text;
  height: Phaser.GameObjects.Text;
  pips: Phaser.GameObjects.Graphics;
  immune: Phaser.GameObjects.Text;
  /** Name row (symbol and name), height and pips: dimmed while the player is away. */
  dim: { setAlpha(a: number): unknown }[];
  away: Phaser.GameObjects.Text;
  awayShown: boolean | null;
  color: number;
  pipsFor: number;
};

/**
 * Wackel-Turm HUD on the main camera: the time in the top band; per column the player's symbol and
 * name, the tower height in metres and the charge pips, and "windfest" while it is immune to the Windstoß;
 * an absent player's column is dimmed and marked "abwesend";
 * the own armed card blinks in the own column;
 * while armed a frame marks the column under the mouse.
 */
export class TowerHud {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly columns = new Map<PlayerKey, Column>();
  private readonly time: Phaser.GameObjects.Text;
  private readonly armed: Phaser.GameObjects.Text;
  private readonly frameG: Phaser.GameObjects.Graphics;
  private readonly frameColor: number;

  constructor(
    private readonly scene: Phaser.Scene,
    players: GamePlayer[],
    private readonly selfKey: PlayerKey,
    private readonly layout: TowerLayout,
    /** Screen x of simulation x 0, and the visible column band (top, height). */
    private readonly ox: number,
    private readonly top: number,
    private readonly bandH: number,
  ) {
    const { width } = CONFIG.view;
    this.objects.push(scene.add.rectangle(0, 0, width, BAND_H, INK_FILL).setOrigin(0).setDepth(HUD_DEPTH));
    this.time = txt(scene, width / 2, BAND_H / 2, '', 10).setDepth(HUD_DEPTH + 2);
    this.armed = txt(scene, 0, ARMED_Y, '', 10, SELF_COLOR).setDepth(HUD_DEPTH + 2).setVisible(false);
    this.frameG = scene.add.graphics().setDepth(HUD_DEPTH - 1);
    this.objects.push(this.time, this.armed, this.frameG);
    const self = players.find((p) => p.key === selfKey);
    this.frameColor = hex(self ? playerColor(scene, self.slot) : '#ffffff');
    // Players get plots in slot order (as the host does).
    const sorted = [...byKey(players).entries()].sort((a, b) => a[1].slot - b[1].slot);
    sorted.forEach(([key, p], i) => {
      const plot = layout.plots[i];
      if (!plot) return;
      const left = ox + plot.minX;
      const w = layout.pitch;
      const sym = playerSymbol(scene, p.slot, left + PAD + SYMBOL_W / 2, NAME_Y)?.setDepth(HUD_DEPTH + 1) ?? null;
      const name = txt(scene, left + PAD + SYMBOL_W + 3, NAME_Y, p.name, 10, key === selfKey ? SELF_COLOR : '#ffffff')
        .setOrigin(0, 0.5)
        .setDepth(HUD_DEPTH + 1);
      fitText(name, w - (PAD * 2 + SYMBOL_W + 3));
      const height = txt(scene, left + PAD, HEIGHT_Y, metres(0), 10).setOrigin(0, 0.5).setDepth(HUD_DEPTH + 1);
      const pips = scene.add.graphics().setDepth(HUD_DEPTH + 1);
      const immune = txt(scene, left + w / 2, IMMUNE_Y, '', 10, IMMUNE_COLOR).setDepth(HUD_DEPTH + 1).setVisible(false);
      const away = txt(scene, left + w / 2, ARMED_Y, AWAY_TEXT, 10, AWAY_COLOR).setDepth(HUD_DEPTH + 1).setVisible(false);
      this.objects.push(name, height, pips, immune, away, ...(sym ? [sym] : []));
      const dim = [name, height, pips, ...(sym ? [sym] : [])];
      this.columns.set(key, {
        left, w, name, height, pips, immune, dim, away, awayShown: null, color: hex(playerColor(scene, p.slot)), pipsFor: -1,
      });
      if (key === selfKey) this.armed.setX(left + w / 2);
    });
  }

  update(s: TowerState, armed: ArmedAction | null, aimCol: number | null): void {
    this.time.setText(`${Math.ceil(s.timeLeftMs / 1000)} s`);
    for (const [key, col] of this.columns) {
      const p = s.players[key];
      if (!p) continue;
      col.height.setText(metres(p.heightPx));
      col.immune.setText(p.windImmuneMs > 0 ? immuneLabel(p.windImmuneMs) : '').setVisible(p.windImmuneMs > 0);
      const away = !p.present;
      if (away !== col.awayShown) {
        col.awayShown = away;
        for (const o of col.dim) o.setAlpha(away ? AWAY_ALPHA : 1);
        col.away.setVisible(away);
      }
      if (p.charges !== col.pipsFor) {
        col.pipsFor = p.charges;
        drawPips(col, p.charges);
      }
    }
    const blinkOn = Math.floor(this.scene.time.now / BLINK_MS) % 2 === 0;
    this.armed.setText(armed ? CARD[armed] : '').setVisible(armed !== null && blinkOn);
    // Frame around the column under the mouse, while armed and only over another player's column.
    this.frameG.clear();
    const ownPlot = s.players[this.selfKey]?.plot;
    const target = aimCol !== null && aimCol !== ownPlot && Object.values(s.players).some((p) => p.plot === aimCol);
    if (armed && target) {
      const plot = this.layout.plots[aimCol];
      this.frameG.lineStyle(2, this.frameColor, 1).strokeRect(this.ox + plot.minX + 1, this.top + 1, this.layout.pitch - 2, this.bandH - 2);
    }
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.columns.clear();
  }
}

/** Shortens a text until it fits maxW (virtual px). */
function fitText(t: Phaser.GameObjects.Text, maxW: number): void {
  let s = t.text;
  while (s.length > 1 && t.width > maxW) {
    s = s.slice(0, -1);
    t.setText(s);
  }
}

/** Charge pips at the right of the height row: filled per charge, hollow up to the cap. */
function drawPips(col: Column, charges: number): void {
  const cap = CONFIG.wackelturm.chargeCap;
  const g = col.pips.clear();
  const x0 = col.left + col.w - PAD - cap * (PIP + PIP_GAP) + PIP_GAP;
  const y = HEIGHT_Y - Math.floor(PIP / 2);
  for (let i = 0; i < cap; i++) {
    const x = x0 + i * (PIP + PIP_GAP);
    g.fillStyle(INK_FILL, 1).fillRect(x - 1, y - 1, PIP + 2, PIP + 2);
    if (i < charges) g.fillStyle(col.color, 1).fillRect(x, y, PIP, PIP);
  }
}

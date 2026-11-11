import type Phaser from 'phaser';
import { CONFIG } from '../../config';
import { byKey, INK, playerSymbol, txt } from '../../game/ui';
import type { GamePlayer, PlayerKey } from '../types';
import type { SpudState } from './spudHost';

/** Parchment box like the Schneeball ammo box. */
const BOX_PANEL = 0xefdcb0;
const BOX_BORDER = 0x8a5a3a;
const BAR_READY = 0xe8a23a;
const BAR_COOL = 0xb59a78;
const BAR_TRACK = 0xd9c393;
const BOX_X = 3;
const BOX_W = 74;
const BOX_H = 17;
const BAR_X = 40;
const BAR_W = 32;
const BAR_H = 7;
/** Top bar: one entry per slot, this far apart. */
const ENTRY_X = 8;
const ENTRY_STEP = 105;
const NAME_MAX = 12;
const GHOST_ALPHA = 0.4;
/** Loss marks (2 players): small squares after the name. */
const MARK = 5;
const MARK_STEP = 7;
const MARK_LOST = 0xb8443a;
const MARK_OPEN = 0xfff4de;

type Entry = {
  sym: Phaser.GameObjects.Sprite | null;
  name: Phaser.GameObjects.Text;
  marks: Phaser.GameObjects.Graphics | null;
  ghost: boolean;
  losses: number;
};

const short = (s: string) => (s.length > NAME_MAX ? `${s.slice(0, NAME_MAX - 1)}.` : s);

/**
 * Heiße Kartoffel HUD: top bar with symbol + name per player (dimmed when out; with 2 players the
 * losses as small marks) and the own sprint state bottom-left.
 */
export class SpudHud {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly entries = new Map<PlayerKey, Entry>();
  private readonly box: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;
  /** Bar drawn for this state (redrawn only on change). */
  private barFor = '';

  constructor(scene: Phaser.Scene, players: GamePlayer[]) {
    const { width, height } = CONFIG.view;
    this.objects.push(scene.add.rectangle(0, 0, width, 16, 0x3b2418, 0.55).setOrigin(0).setDepth(1000));
    const bestOfTwo = players.length === 2;
    [...byKey(players).entries()].forEach(([key, p], i) => {
      const x = ENTRY_X + i * ENTRY_STEP;
      const sym = playerSymbol(scene, p.slot, x, 8)?.setDepth(1001) ?? null;
      const name = txt(scene, x + 8, 8, short(p.name), 10).setOrigin(0, 0.5).setDepth(1001);
      const marks = bestOfTwo ? scene.add.graphics().setPosition(Math.round(x + 11 + name.width), 8).setDepth(1001) : null;
      if (sym) this.objects.push(sym);
      this.objects.push(name, ...(marks ? [marks] : []));
      this.entries.set(key, { sym, name, marks, ghost: false, losses: -1 });
    });
    this.box = scene.add
      .rectangle(BOX_X, height - 19, BOX_W, BOX_H, BOX_PANEL)
      .setOrigin(0)
      .setStrokeStyle(2, BOX_BORDER)
      .setDepth(1000);
    this.label = txt(scene, BOX_X + 5, height - 10, 'Sprint', 10, INK).setOrigin(0, 0.5).setDepth(1001);
    this.bar = scene.add.graphics().setPosition(BOX_X + BAR_X, height - 10 - Math.floor(BAR_H / 2)).setDepth(1001);
    this.objects.push(this.box, this.label, this.bar);
  }

  update(s: SpudState, selfKey: PlayerKey): void {
    for (const [key, e] of this.entries) {
      const p = s.players[key];
      if (!p) continue;
      if (p.ghost !== e.ghost) {
        e.ghost = p.ghost;
        const a = p.ghost ? GHOST_ALPHA : 1;
        e.sym?.setAlpha(a);
        e.name.setAlpha(a);
        e.marks?.setAlpha(a);
      }
      if (e.marks && p.losses !== e.losses) {
        e.losses = p.losses;
        this.drawMarks(e.marks, p.losses);
      }
    }
    this.drawBar(s, selfKey);
  }

  /** One square per bang needed to lose: red = lost. */
  private drawMarks(g: Phaser.GameObjects.Graphics, losses: number): void {
    g.clear();
    const n = Math.ceil(CONFIG.kartoffel.bestOf / 2);
    for (let i = 0; i < n; i++) {
      const x = i * MARK_STEP;
      const y = -Math.ceil(MARK / 2);
      g.fillStyle(0x3b2418, 1).fillRect(x - 1, y - 1, MARK + 2, MARK + 2);
      g.fillStyle(i < losses ? MARK_LOST : MARK_OPEN, 1).fillRect(x, y, MARK, MARK);
    }
  }

  /** Full bar when the sprint is ready; during the cooldown a duller bar that empties. */
  private drawBar(s: SpudState, selfKey: PlayerKey): void {
    const me = s.players[selfKey];
    const cd = me?.sprintCdMs ?? 0;
    const ghost = !!me?.ghost;
    const fill = cd > 0 ? Math.round(BAR_W * Math.min(1, cd / CONFIG.kartoffel.sprintCooldownMs)) : BAR_W;
    const key = `${fill}|${cd > 0}|${ghost}`;
    if (key === this.barFor) return;
    this.barFor = key;
    const g = this.bar.clear();
    g.fillStyle(0x3b2418, 1).fillRect(-1, -1, BAR_W + 2, BAR_H + 2);
    g.fillStyle(BAR_TRACK, 1).fillRect(0, 0, BAR_W, BAR_H);
    if (fill > 0) g.fillStyle(cd > 0 ? BAR_COOL : BAR_READY, 1).fillRect(0, 0, fill, BAR_H);
    const a = ghost ? GHOST_ALPHA : 1;
    this.box.setAlpha(a);
    this.label.setAlpha(a);
    this.bar.setAlpha(a);
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.entries.clear();
  }
}

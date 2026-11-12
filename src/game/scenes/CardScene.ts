import Phaser from 'phaser';
import { sound } from '../../audio/sound';
import { CONFIG } from '../../config';
import { cardText, cardTitle, type CardId } from '../../flow/cards';
import type { EveningPhase } from '../../flow/evening';
import { findSprite } from '../../gfx/layerPlan';
import { cardSound, cardsHeader, revealLines } from '../cardText';
import type { SceneData, StageCtx } from '../stageCtx';
import { assetSprite, assetsOf, byKey, INK, txt } from '../ui';

const CARD_W = 64;
const CARD_H = 88;
const GAP = 16;
/** Card centres (y) while choosing and at the reveal. */
const CARDS_Y = 108;
const REVEAL_Y = 100;
/** Deal animation: per-card delay and flight time (ms). */
const DEAL_STEP_MS = 120;
const DEAL_MS = 260;
const KEYS = ['ONE', 'TWO', 'THREE'] as const;

type CardsPhase = Extract<EveningPhase, { kind: 'cards' }>;
type RevealPhase = Extract<EveningPhase, { kind: 'reveal' }>;

/**
 * Gemeinheit-Karten (phases `cards` and `reveal`; restarted on the switch, keeps the standings music).
 * The chooser sees three faces and picks with a click or keys 1–3; everyone else sees the backs.
 * The reveal flips the picked card for everyone.
 */
export class CardScene extends Phaser.Scene {
  constructor() {
    super('CardScene');
  }

  create({ phase, ctx }: SceneData<'cards'> | SceneData<'reveal'>): void {
    const { width: w, height: h } = CONFIG.view;
    this.add.rectangle(0, 0, w, h, 0x2b2b3d).setOrigin(0);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.removeAllListeners());
    const info = byKey(ctx.players());
    const name = (k: string) => info.get(k)?.name ?? k;
    if (phase.kind === 'cards') this.choose(phase, ctx, name);
    else this.reveal(phase, name);
  }

  /** Front of a card: frame, picture at anchor `bild`, title in the `text` field. Container centred on (x, y). */
  private face(id: CardId, x: number, y: number): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const frame = assetSprite(this, 'card.frame', 0, 0);
    if (!frame) c.add(this.add.rectangle(0, 0, CARD_W, CARD_H, 0xefdcb0).setStrokeStyle(2, 0xb8443a));
    else c.add(frame);
    const anchors = (findSprite(assetsOf(this), 'card.frame')?.def as { anchors?: Record<string, [number, number]> } | undefined)?.anchors;
    const [bx, by] = anchors?.bild ?? [4, 10];
    const [tx, ty] = anchors?.text ?? [7, 63];
    const pic = assetSprite(this, `card.bild.${id}`, bx - CARD_W / 2, by - CARD_H / 2);
    if (pic) c.add(pic.setOrigin(0));
    const title = txt(this, 0, ty - CARD_H / 2, cardTitle(id), 10, INK)
      .setOrigin(0.5, 0)
      .setWordWrapWidth(CARD_W - 2 * tx);
    c.add(title);
    return c;
  }

  private back(x: number, y: number): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const s = assetSprite(this, 'card.back', 0, 0);
    c.add(s ?? this.add.rectangle(0, 0, CARD_W, CARD_H, 0xb8443a).setStrokeStyle(2, 0x3b2418));
    return c;
  }

  private choose(phase: CardsPhase, ctx: StageCtx, name: (k: string) => string): void {
    const { width: w, height: h } = CONFIG.view;
    const self = ctx.selfKey();
    const head = cardsHeader(phase, self, name);
    txt(this, w / 2, 18, head.header, 12, '#ffd27a');
    txt(this, w / 2, 34, head.sub, 10);
    const mine = phase.chooser === self;
    const glow = mine ? assetSprite(this, 'card.glow', 0, 0)?.setVisible(false) ?? null : null;
    const hint = txt(this, w / 2, CARDS_Y + CARD_H / 2 + 18, '', 10).setWordWrapWidth(w - 60);
    let picked = false;
    let hovered = -1;
    const cards = phase.offer.map((id, i) => {
      const x = w / 2 + (i - (phase.offer.length - 1) / 2) * (CARD_W + GAP);
      const c = mine ? this.face(id, x, -CARD_H) : this.back(x, -CARD_H);
      this.tweens.add({ targets: c, y: CARDS_Y, delay: i * DEAL_STEP_MS, duration: DEAL_MS, ease: 'Back.easeOut' });
      return c;
    });
    sound.play('karte.karten_austeilen');
    if (mine) {
      const hover = (i: number) => {
        if (picked || i === hovered) return;
        hovered = i;
        const c = cards[i];
        glow?.setPosition(c.x, CARDS_Y).setVisible(true);
        hint.setText(cardText(phase.offer[i], phase.game));
        sound.play('karte.karte_hover');
      };
      const pick = (i: number) => {
        if (picked || i >= phase.offer.length) return;
        picked = true;
        hover(i);
        sound.play('karte.karte_waehlen');
        cards.forEach((c, j) => (j === i ? this.tweens.add({ targets: c, scale: 1.08, yoyo: true, duration: 140 }) : c.setAlpha(0.35)));
        ctx.pickCard(phase.offer[i]);
      };
      cards.forEach((c, i) => {
        const zone = this.add.zone(0, 0, CARD_W, CARD_H).setInteractive({ useHandCursor: true });
        zone.on('pointerover', () => hover(i));
        zone.on('pointerdown', () => pick(i));
        c.add(zone);
      });
      KEYS.forEach((k, i) => this.input.keyboard?.on(`keydown-${k}`, () => pick(i)));
      KEYS.forEach((k, i) => this.input.keyboard?.on(`keydown-NUMPAD_${k}`, () => pick(i)));
    }
    // Phases carry no clock: the countdown runs from the scene start.
    const end = this.time.now + ctx.timing.cardPickMs;
    const left = () => Math.max(0, Math.ceil((end - this.time.now) / 1000));
    const timer = txt(this, w / 2, h - 14, `${left()} s`, 10, '#ffd27a');
    this.time.addEvent({ delay: 250, loop: true, callback: () => timer.setText(`${left()} s`) });
  }

  private reveal(phase: RevealPhase, name: (k: string) => string): void {
    const { width: w } = CONFIG.view;
    const lines = revealLines(phase, name);
    txt(this, w / 2, 22, lines.top, 12);
    sound.play('karte.karte_enthuellen');
    const showFace = () => {
      this.face(phase.card, w / 2, REVEAL_Y);
      sound.play(cardSound(phase.card));
      const title = txt(this, w / 2, REVEAL_Y + CARD_H / 2 + 16, lines.title, 16, '#ffd27a');
      this.tweens.add({ targets: title, scale: { from: 0.6, to: 1 }, duration: 220, ease: 'Back.easeOut' });
      txt(this, w / 2, REVEAL_Y + CARD_H / 2 + 36, lines.effect, 10).setWordWrapWidth(w - 60);
      if (phase.card === 'punkte_klau') {
        const t = (k: string) => phase.totals[k] ?? 0;
        txt(this, w / 2, REVEAL_Y + CARD_H / 2 + 52, `${name(phase.victim)}: ${t(phase.victim)} · ${name(phase.chooser)}: ${t(phase.chooser)}`, 10, '#b8e0a0');
      }
    };
    // card.flip runs front -> back; played in reverse it turns the back to the front.
    const flip = assetSprite(this, 'card.flip', w / 2, REVEAL_Y);
    if (!flip) {
      showFace();
      return;
    }
    const key = flip.texture.key;
    flip.stop();
    flip.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      flip.destroy();
      showFace();
    });
    flip.playReverse(key);
  }
}

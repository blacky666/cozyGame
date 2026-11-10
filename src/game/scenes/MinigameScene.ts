import Phaser from 'phaser';
import { CONFIG } from '../../config';
import { SnapshotBuffer } from '../../net/interpolation';
import { neutralInput, type InputState } from '../../net/protocol';
import { getMinigame } from '../../minigames/registry';
import type { MiniGame, MiniGameView } from '../../minigames/types';
import type { SceneData, StageCtx } from '../stageCtx';
import { assetSprite, txt } from '../ui';

const stepLerp = <S>(a: S, b: S, t: number): S => (t < 0.5 ? a : b);
const sameInput = (a: InputState, b: InputState) =>
  a.up === b.up && a.down === b.down && a.left === b.left && a.right === b.right &&
  a.primary === b.primary && a.secondary === b.secondary && a.special === b.special && a.emote === b.emote;

/**
 * Renders the running minigame. Host: draws its authoritative snapshot directly (the simulation
 * itself runs on the worker ticker in EveningHost). Client: interpolates snapshots with
 * interpDelayMs and predicts the own player from local input.
 */
export class MinigameScene extends Phaser.Scene {
  private ctx!: StageCtx;
  private round = 0;
  private def: MiniGame | null = null;
  private view: MiniGameView<unknown> | null = null;
  private readonly buffer = new SnapshotBuffer<unknown>();
  private latest: unknown = null;
  private lastSent: InputState = neutralInput();
  private lastSentAt = 0;

  constructor() {
    super('MinigameScene');
  }

  create({ phase, ctx }: SceneData<'playing'>): void {
    this.ctx = ctx;
    this.round = phase.round;
    this.buffer.clear();
    this.latest = null;
    this.lastSentAt = 0;
    this.def = getMinigame(phase.game) ?? null;
    if (!this.def) {
      txt(this, CONFIG.view.width / 2, CONFIG.view.height / 2, `Unbekanntes Spiel: ${phase.game}`, 10);
      return;
    }
    this.view = this.def.createView(this, ctx.players(), ctx.selfKey());
    if (!ctx.isHost) {
      ctx.onSnap((tick, p, at) => {
        if (p.round !== this.round) return;
        this.buffer.push(tick, at, p.state);
        this.latest = p.state;
      });
    }
    const los = assetSprite(this, 'ui.countdown.los', CONFIG.view.width / 2, CONFIG.view.height / 2)
      ?? txt(this, CONFIG.view.width / 2, CONFIG.view.height / 2, 'LOS!', 40);
    los.setDepth(2000);
    this.tweens.add({ targets: los, alpha: 0, delay: 600, duration: 300, onComplete: () => los.destroy() });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (!ctx.isHost) {
        ctx.onSnap(null);
        ctx.sendInput?.(neutralInput());
      }
      this.view?.destroy();
      this.view = null;
    });
  }

  update(time: number, delta: number): void {
    const view = this.view;
    if (!view || !this.def) return;
    const self = this.ctx.selfKey();
    if (this.ctx.isHost) {
      const snap = this.ctx.hostSnapshot?.();
      if (snap && snap.round === this.round) view.render(snap.state, self);
      return;
    }
    const input = this.ctx.keyboard.state();
    if (!sameInput(input, this.lastSent) || time - this.lastSentAt >= CONFIG.net.inputHeartbeatMs) {
      this.ctx.sendInput?.(input);
      this.lastSent = input;
      this.lastSentAt = time;
    }
    view.predict?.(input, delta / 1000, this.latest);
    const s = this.buffer.sample(performance.now() - CONFIG.net.interpDelayMs, this.def.lerp ?? stepLerp);
    if (s !== null) view.render(s, self);
  }
}

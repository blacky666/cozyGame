import Phaser from 'phaser';
import { CONFIG } from '../../config';
import { SnapshotBuffer } from '../../net/interpolation';
import { neutralInput, type InputState } from '../../net/protocol';
import { getMinigame } from '../../minigames/registry';
import { playerKey, type GamePlayer, type MiniGame, type MiniGameView } from '../../minigames/types';
import type { SceneData, StageCtx } from '../stageCtx';
import { shouldSend } from '../inputSend';
import { assetSprite, txt } from '../ui';

const stepLerp = <S>(a: S, b: S, t: number): S => (t < 0.5 ? a : b);

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
  /** Host only: own buffer of per-tick states, sampled one tick behind for smooth motion. */
  private readonly hostBuffer = new SnapshotBuffer<unknown>();
  private latest: unknown = null;
  private lastSent: InputState = neutralInput();
  private lastSentAt = 0;
  private lastSentSeq = 0;
  private lastAimAt = 0;
  private acks: Record<string, number> = {};

  constructor() {
    super('MinigameScene');
  }

  create({ phase, ctx }: SceneData<'playing'>): void {
    this.ctx = ctx;
    this.round = phase.round;
    this.buffer.clear();
    this.hostBuffer.clear();
    this.latest = null;
    this.lastSentAt = 0;
    this.lastSentSeq = 0;
    this.lastAimAt = 0;
    this.acks = {};
    this.def = getMinigame(phase.game) ?? null;
    if (!this.def) {
      txt(this, CONFIG.view.width / 2, CONFIG.view.height / 2, `Unbekanntes Spiel: ${phase.game}`, 10);
      return;
    }
    this.view = this.def.createView(this, this.gamePlayers(), ctx.selfKey());
    const unwire = this.wirePointer();
    if (!ctx.isHost) {
      ctx.onSnap((tick, p, at) => {
        if (p.round !== this.round) return;
        this.buffer.push(tick, at, p.state);
        this.latest = p.state;
        this.acks = p.acks ?? {};
      });
    }
    const los = assetSprite(this, 'ui.countdown.los', CONFIG.view.width / 2, CONFIG.view.height / 2)
      ?? txt(this, CONFIG.view.width / 2, CONFIG.view.height / 2, 'LOS!', 40);
    los.setDepth(2000);
    this.tweens.add({ targets: los, alpha: 0, delay: 600, duration: 300, onComplete: () => los.destroy() });

    // game.destroy() fires DESTROY, not SHUTDOWN: hook both, the window listener must not leak.
    this.events.once(Phaser.Scenes.Events.DESTROY, unwire);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unwire();
      if (!ctx.isHost) {
        ctx.onSnap(null);
        // Released buttons, but the counters stay (a drop would make the next host re-base them).
        const b = ctx.pointer.button;
        ctx.sendInput?.({
          ...neutralInput(), shoves: ctx.keyboard.state().shoves, primaryTaps: b.taps, primaryCharge: b.charge,
        });
      }
      this.view?.destroy();
      this.view = null;
    });
  }

  /**
   * Left mouse button -> the shared ChargeButton (every game; games without aiming ignore it).
   * Window blur drops a held charge; the canvas context menu is suppressed; the cursor is a
   * crosshair while an aimed game runs. Returns the cleanup for shutdown.
   */
  private wirePointer(): () => void {
    const button = this.ctx.pointer.button;
    button.cancel();
    const down = (p: Phaser.Input.Pointer) => {
      if (p.button === 0) button.press(performance.now());
    };
    const up = (p: Phaser.Input.Pointer) => {
      if (p.button === 0) button.release(performance.now());
    };
    const blur = () => button.cancel();
    const noMenu = (e: Event) => e.preventDefault();
    const canvas = this.game.canvas;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, down);
    this.input.on(Phaser.Input.Events.POINTER_UP, up);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, up);
    window.addEventListener('blur', blur);
    canvas.addEventListener('contextmenu', noMenu);
    if (this.def?.aimOffset) this.input.setDefaultCursor('crosshair');
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.input.off(Phaser.Input.Events.POINTER_DOWN, down);
      this.input.off(Phaser.Input.Events.POINTER_UP, up);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, up);
      window.removeEventListener('blur', blur);
      canvas.removeEventListener('contextmenu', noMenu);
      this.input.setDefaultCursor('');
      button.cancel();
    };
  }

  /** Aim in the game's simulation coordinates (pointer world position minus the game's offset). */
  private updateAim(): void {
    const p = this.input.activePointer;
    // Via the camera so the aim is right after a resize without mouse movement.
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const off = this.def?.aimOffset ?? { x: 0, y: 0 };
    this.ctx.pointer.aimX = w.x - off.x;
    this.ctx.pointer.aimY = w.y - off.y;
  }

  private gamePlayers(): GamePlayer[] {
    const selfKey = this.ctx.selfKey();
    return this.ctx.players().map((p) => {
      const key = playerKey(p.slot);
      return { key, slot: p.slot, name: p.name, look: p.look, remote: !p.isBot && key !== selfKey };
    });
  }

  update(time: number, delta: number): void {
    const view = this.view;
    if (!view || !this.def) return;
    const self = this.ctx.selfKey();
    this.updateAim();
    const button = this.ctx.pointer.button;
    view.setCharge?.(button.held ? button.chargeAt(performance.now()) : null);
    if (this.ctx.isHost) {
      const snap = this.ctx.hostSnapshot?.();
      if (snap && snap.round === this.round) {
        this.hostBuffer.push(snap.tick, snap.at, snap.state);
        const s = this.hostBuffer.sample(performance.now() - 1000 / CONFIG.net.simHz, this.def.lerp ?? stepLerp);
        view.render(s ?? snap.state, self);
      }
      return;
    }
    const input = this.ctx.pointer.merge(this.ctx.keyboard.state());
    if (shouldSend(this.lastSent, input, time, this.lastSentAt, this.lastAimAt)) {
      const seq = this.ctx.sendInput?.(input) ?? 0;
      if (seq > 0) this.lastSentSeq = seq;
      this.lastSent = input;
      this.lastSentAt = time;
      this.lastAimAt = time;
    }
    view.predict?.(input, delta / 1000, this.latest, this.acks[self] ?? 0, this.lastSentSeq);
    const s = this.buffer.sample(performance.now() - CONFIG.net.interpDelayMs, this.def.lerp ?? stepLerp);
    if (s !== null) view.render(s, self);
  }
}

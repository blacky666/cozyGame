import Phaser from 'phaser';
import { sound } from '../../audio/sound';
import { CONFIG } from '../../config';
import type { RoundCard } from '../../flow/cards';
import { SnapshotBuffer } from '../../net/interpolation';
import { keepCounters, neutralInput, type InputState } from '../../net/protocol';
import { getMinigame } from '../../minigames/registry';
import { playerKey, type GamePlayer, type MiniGame, type MiniGameView } from '../../minigames/types';
import type { SceneData, StageCtx } from '../stageCtx';
import { shouldSend } from '../inputSend';
import { assetSprite, txt } from '../ui';
import { EmoteLayer } from '../../minigames/common/emoteLayer';
import type { EmoteShow } from '../../minigames/common/emotes';

/** Round-end jingle after the whistle. */
const ROUND_END_JINGLE_MS = 700;
const stepLerp = <S>(a: S, b: S, t: number): S => (t < 0.5 ? a : b);

/**
 * Renders the running minigame. Host: draws its authoritative snapshot directly (the simulation
 * itself runs on the worker ticker in EveningHost). Client: interpolates snapshots with
 * interpDelayMs and predicts the own player from local input.
 */
export class MinigameScene extends Phaser.Scene {
  private ctx!: StageCtx;
  private round = 0;
  /** Gemeinheit acting in this round (Peinlicher Hut is drawn here). */
  private card: RoundCard | null = null;
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
  private emoteLayer: EmoteLayer | null = null;
  /** Client: emote shows of the latest snapshot (not interpolated). */
  private emotes: EmoteShow[] = [];

  constructor() {
    super('MinigameScene');
  }

  create({ phase, ctx }: SceneData<'playing'>): void {
    this.ctx = ctx;
    this.round = phase.round;
    this.card = phase.card ?? null;
    this.buffer.clear();
    this.hostBuffer.clear();
    this.latest = null;
    this.lastSentAt = 0;
    this.lastSentSeq = 0;
    this.lastAimAt = 0;
    this.acks = {};
    this.emotes = [];
    this.def = getMinigame(phase.game) ?? null;
    if (!this.def) {
      txt(this, CONFIG.view.width / 2, CONFIG.view.height / 2, `Unbekanntes Spiel: ${phase.game}`, 10);
      return;
    }
    this.view = this.def.createView(this, this.gamePlayers(), ctx.selfKey());
    this.emoteLayer = new EmoteLayer(this);
    const unwirePointer = this.wirePointer();
    // Action counters only grow while this scene runs (not during intro/standings).
    ctx.keyboard.setCounting(true);
    ctx.pointer.setCounting(true);
    const unwire = () => {
      sound.setMusic(null);
      sound.stopLoops();
      ctx.keyboard.setCounting(false);
      ctx.pointer.setCounting(false);
      unwirePointer();
    };
    if (!ctx.isHost) {
      ctx.onSnap((tick, p, at) => {
        if (p.round !== this.round) return;
        this.buffer.push(tick, at, p.state);
        this.latest = p.state;
        this.acks = p.acks ?? {};
        this.emotes = Array.isArray(p.emotes) ? p.emotes : [];
      });
    }
    const los = assetSprite(this, 'ui.countdown.los', CONFIG.view.width / 2, CONFIG.view.height / 2)
      ?? txt(this, CONFIG.view.width / 2, CONFIG.view.height / 2, 'LOS!', 40);
    los.setDepth(2000);
    sound.playRound(this.def.sounds, 'countdown_los');
    this.tweens.add({ targets: los, alpha: 0, delay: 600, duration: 300, onComplete: () => los.destroy() });

    // game.destroy() fires DESTROY, not SHUTDOWN: hook both, the window listener must not leak.
    this.events.once(Phaser.Scenes.Events.DESTROY, unwire);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unwire();
      // Round over: whistle, then the jingle (the game's own sounds, else the shared ones).
      const pkg = this.def?.sounds;
      sound.playFirst([`${pkg}.zeit_um_pfiff`, 'ablauf.zeit_um']);
      sound.playRound(pkg, 'jingle_runde_ende', { delayMs: ROUND_END_JINGLE_MS });
      if (!ctx.isHost) {
        ctx.onSnap(null);
        // Released buttons, but the counters stay (a drop would make the next host re-base them).
        ctx.sendInput?.(keepCounters(ctx.pointer.merge(ctx.keyboard.state())));
      }
      this.emoteLayer?.destroy();
      this.emoteLayer = null;
      this.view?.destroy();
      this.view = null;
    });
  }

  /**
   * Left/right mouse button -> the shared PointerInput (every game; games without aiming ignore it).
   * Presses count on pointerdown; window blur releases the held flags; the canvas context menu is
   * suppressed (right click throws); the system cursor is hidden while an aimed game runs (the view
   * draws its own crosshair) unless the game keeps it (systemCursor). Returns the cleanup for shutdown.
   */
  private wirePointer(): () => void {
    const pointer = this.ctx.pointer;
    pointer.releaseAll();
    const down = (p: Phaser.Input.Pointer) => pointer.press(p.button);
    const up = (p: Phaser.Input.Pointer) => pointer.release(p.button);
    const wheel = (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => pointer.wheel(dy, this.time.now);
    const blur = () => {
      pointer.releaseAll();
      // Client: send the released keys through the tracked path, so the prediction knows their seq
      // (the keyboard already cleared its keys: its blur listener was registered first).
      if (this.ctx.isHost || !this.view) return;
      const input = pointer.merge(this.ctx.keyboard.state());
      const seq = this.ctx.sendInput?.(input) ?? 0;
      if (seq > 0) this.lastSentSeq = seq;
      this.lastSent = input;
      this.lastSentAt = this.time.now;
    };
    const noMenu = (e: Event) => e.preventDefault();
    const canvas = this.game.canvas;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, down);
    this.input.on(Phaser.Input.Events.POINTER_UP, up);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, up);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, wheel);
    window.addEventListener('blur', blur);
    canvas.addEventListener('contextmenu', noMenu);
    if (this.def?.aimOffset && !this.def.systemCursor) this.input.setDefaultCursor('none');
    let done = false;
    return () => {
      if (done) return;
      done = true;
      // Unconditional first: window/canvas listeners and held buttons must never leak or stick.
      window.removeEventListener('blur', blur);
      canvas.removeEventListener('contextmenu', noMenu);
      pointer.releaseAll();
      canvas.style.cursor = '';
      // On game.destroy() Phaser's InputPlugin has already run its own DESTROY handler (registered
      // before create()), so `this.input.manager` is null and any input call would throw.
      if (this.input?.manager) {
        this.input.off(Phaser.Input.Events.POINTER_DOWN, down);
        this.input.off(Phaser.Input.Events.POINTER_UP, up);
        this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, up);
        this.input.off(Phaser.Input.Events.POINTER_WHEEL, wheel);
        this.input.setDefaultCursor('');
      }
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
    // Peinlicher Hut: the victim wears the Gurken-Hut this round (local override, never saved or migrated).
    const hutFor = this.card?.id === 'peinlicher_hut' ? this.card.victim : null;
    return this.ctx.players().map((p) => {
      const key = playerKey(p.slot);
      const look = key === hutFor ? { ...p.look, hat: 'gurke' } : p.look;
      return { key, slot: p.slot, name: p.name, look, remote: !p.isBot && key !== selfKey };
    });
  }

  update(time: number, delta: number): void {
    const view = this.view;
    if (!view || !this.def) return;
    const self = this.ctx.selfKey();
    this.updateAim();
    view.frame?.();
    if (this.ctx.isHost) {
      const snap = this.ctx.hostSnapshot?.();
      if (snap && snap.round === this.round) {
        this.hostBuffer.push(snap.tick, snap.at, snap.state);
        const s = this.hostBuffer.sample(performance.now() - 1000 / CONFIG.net.simHz, this.def.lerp ?? stepLerp);
        view.render(s ?? snap.state, self);
        this.drawEmotes(snap.emotes);
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
    if (s !== null) {
      view.render(s, self);
      this.drawEmotes(this.emotes);
    }
  }

  /** Emote bubbles at the anchors the view reports (after render, so they follow the figures). */
  private drawEmotes(shows: EmoteShow[]): void {
    const view = this.view;
    if (!view || !this.emoteLayer) return;
    this.emoteLayer.update(shows, (k) => view.emoteAnchor?.(k) ?? null);
  }
}

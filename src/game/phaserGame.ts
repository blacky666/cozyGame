import Phaser from 'phaser';
import { CONFIG } from '../config';
import type { EveningPhase } from '../flow/evening';
import type { MsgData } from '../net/protocol';
import type { SnapPayload } from './eveningHost';
import { BootScene } from './scenes/BootScene';
import { EndedScene } from './scenes/EndedScene';
import { MinigameScene } from './scenes/MinigameScene';
import { PodiumScene } from './scenes/PodiumScene';
import { RoundIntroScene } from './scenes/RoundIntroScene';
import { StandingsScene } from './scenes/StandingsScene';
import type { StageCtx } from './stageCtx';
import { integerZoom } from './zoom';

const SCENE_OF: Record<Exclude<EveningPhase['kind'], 'lobby'>, string> = {
  intro: 'RoundIntroScene',
  playing: 'MinigameScene',
  standings: 'StandingsScene',
  podium: 'PodiumScene',
  ended: 'EndedScene',
};

const phaseId = (p: EveningPhase) => ('round' in p ? `${p.kind}:${p.round}` : p.kind);

/** Phaser stage of one evening: shows the scene for each incoming EveningPhase. */
export class Stage {
  private readonly game: Phaser.Game;
  private readonly ctx: StageCtx;
  private ready = false;
  private current: EveningPhase | null = null;
  private snapCb: ((tick: number, p: SnapPayload, at: number) => void) | null = null;
  private destroyed = false;
  private readonly onResize = () => this.game.scale.setZoom(integerZoom(window.innerWidth, window.innerHeight));

  constructor(ctx: Omit<StageCtx, 'onSnap'>) {
    this.ctx = { ...ctx, onSnap: (cb) => void (this.snapCb = cb) };
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      width: CONFIG.view.width,
      height: CONFIG.view.height,
      pixelArt: true,
      backgroundColor: '#2b2b3d',
      // Whole-number zoom only (crisp pixels): x3 at 1280x720 (CONFIG.view.zoom), recomputed on resize.
      zoom: integerZoom(window.innerWidth, window.innerHeight),
      // Centering comes from the #game flex container (index.html); Phaser margins would double it.
      scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
      scene: [
        new BootScene(() => this.booted()),
        RoundIntroScene,
        MinigameScene,
        StandingsScene,
        PodiumScene,
        EndedScene,
      ],
    });
    window.addEventListener('resize', this.onResize);
  }

  /** Show a phase; repeats of the current phase (re-sent after a reconnect) are ignored. */
  setPhase(p: EveningPhase): void {
    if (this.destroyed || p.kind === 'lobby') return;
    if (this.current && phaseId(this.current) === phaseId(p)) return;
    this.current = p;
    if (this.ready) this.show(p);
  }

  pushSnap(snap: MsgData<'snap'>): void {
    const p = snap.payload as SnapPayload | null;
    if (snap.phase !== 'playing' || !p || typeof p.round !== 'number') return;
    this.snapCb?.(snap.tick, p, performance.now());
  }

  hostLeft(): void {
    this.setPhase({ kind: 'ended', reason: 'host_left' });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.snapCb = null;
    window.removeEventListener('resize', this.onResize);
    this.ctx.keyboard.destroy();
    this.game.destroy(true);
  }

  private booted(): void {
    this.ready = true;
    if (this.current) this.show(this.current);
  }

  private show(p: EveningPhase): void {
    if (p.kind === 'lobby' || this.destroyed) return;
    const key = SCENE_OF[p.kind];
    for (const s of this.game.scene.getScenes(false)) {
      const k = s.scene.key;
      if (k !== 'BootScene' && k !== key && (s.scene.isActive() || s.scene.isPaused())) this.game.scene.stop(k);
    }
    this.game.scene.start(key, { phase: p, ctx: this.ctx });
  }
}

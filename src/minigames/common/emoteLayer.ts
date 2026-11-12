import type Phaser from 'phaser';
import { sound } from '../../audio/sound';
import { CONFIG } from '../../config';
import { assetSprite, nineSlice } from '../../game/ui';
import type { PlayerKey } from '../types';
import type { EmoteShow } from './emotes';

/**
 * Which emote shows are new (pure): each show (key + n) sounds exactly once for everyone, however
 * often snapshots repeat it. `seen` only grows (a few entries per evening).
 */
export function emoteCues(prev: ReadonlySet<string>, shows: EmoteShow[]): { sounds: string[]; seen: Set<string> } {
  const seen = new Set(prev);
  const sounds: string[] = [];
  for (const s of shows) {
    const id = `${s.key}:${s.n}`;
    if (seen.has(id)) continue;
    seen.add(id);
    sounds.push(`aktion.emote_${s.id}`);
  }
  return { sounds, seen };
}

const DEPTH = 3000;
const FADE_MS = 300;
/** Bubble box (virtual px) around the 16x16 emote. */
const BOX = 24;
/** The tail (ui.bubble.zipfel, 5 px high) overlaps the box by 1 px. */
const TAIL_H = 4;

type Bubble = { n: number; id: string; box: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.AlphaSingle; tail: Phaser.GameObjects.Sprite | null; icon: Phaser.GameObjects.Sprite | null };

/**
 * Speech bubbles with the emote above the figures (spec §5 "Allgemein", §7.3), shared by every
 * minigame: `update` with the host's current shows and the view's anchor (the main-camera point the
 * tail points at; null hides). Fades out over the last FADE_MS, stays inside the view.
 */
export class EmoteLayer {
  private readonly bubbles = new Map<PlayerKey, Bubble>();
  private seen = new Set<string>();

  constructor(private readonly scene: Phaser.Scene) {}

  update(shows: EmoteShow[], anchor: (key: PlayerKey) => { x: number; y: number } | null): void {
    const cues = emoteCues(this.seen, shows);
    this.seen = cues.seen;
    for (const id of cues.sounds) sound.play(id);

    const live = new Set<PlayerKey>();
    for (const s of shows) {
      const at = anchor(s.key);
      if (!at || s.leftMs <= 0) continue;
      live.add(s.key);
      let b = this.bubbles.get(s.key);
      if (b && (b.n !== s.n || b.id !== s.id)) {
        this.drop(s.key);
        b = undefined;
      }
      if (!b) b = this.make(s);
      this.place(b, at, Math.min(1, s.leftMs / FADE_MS));
    }
    for (const key of [...this.bubbles.keys()]) if (!live.has(key)) this.drop(key);
  }

  destroy(): void {
    for (const key of [...this.bubbles.keys()]) this.drop(key);
  }

  private make(s: EmoteShow): Bubble {
    const sc = this.scene;
    const box = nineSlice(sc, 'ui.bubble', 0, 0, BOX, BOX, 0xffffff).setDepth(DEPTH);
    const tail = assetSprite(sc, 'ui.bubble.zipfel', 0, 0)?.setDepth(DEPTH + 1) ?? null;
    tail?.setOrigin(0.5, 1);
    const icon = assetSprite(sc, `emote.${s.id}`, 0, 0)?.setDepth(DEPTH + 2) ?? null;
    const b: Bubble = { n: s.n, id: s.id, box, tail, icon };
    this.bubbles.set(s.key, b);
    return b;
  }

  private place(b: Bubble, at: { x: number; y: number }, alpha: number): void {
    const { width, height } = CONFIG.view;
    // Keep the whole bubble (box + tail) inside the view; the tail follows the clamped box.
    const x = Math.round(Math.min(width - BOX / 2, Math.max(BOX / 2, at.x)));
    const tipY = Math.round(Math.min(height, Math.max(BOX + TAIL_H, at.y)));
    const top = tipY - TAIL_H - BOX;
    b.box.setPosition(x - BOX / 2, top).setAlpha(alpha);
    b.tail?.setPosition(x, tipY).setAlpha(alpha);
    b.icon?.setPosition(x, top + BOX / 2).setAlpha(alpha);
  }

  private drop(key: PlayerKey): void {
    const b = this.bubbles.get(key);
    if (!b) return;
    b.box.destroy();
    b.tail?.destroy();
    b.icon?.destroy();
    this.bubbles.delete(key);
  }
}

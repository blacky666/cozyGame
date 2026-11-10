import Phaser from 'phaser';
import { CONFIG } from '../../config';
import { Character } from '../../gfx/character';
import { assetsOf, byKey, playerSymbol, txt } from '../../game/ui';
import type { PlayerInfo } from '../../net/roster';
import type { InputState, MiniGameView, PlayerKey } from '../types';
import { moveStep, SANDBOX, type Facing, type SandboxState } from './sandboxHost';

const GRASS = 0x86b45a;
const COIN = 0xf5d442;
const COIN_EDGE = 0xb7861d;

type Avatar = { char: Character; label: Phaser.GameObjects.Text; anim: string; dir: Facing };
type Pred = { x: number; y: number; dir: Facing; moving: boolean };

export class SandboxView implements MiniGameView<SandboxState> {
  private readonly avatars = new Map<PlayerKey, Avatar>();
  private readonly coins = new Map<number, Phaser.GameObjects.Rectangle>();
  private readonly scores = new Map<PlayerKey, Phaser.GameObjects.Text>();
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly time: Phaser.GameObjects.Text;
  private pred: Pred | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    players: PlayerInfo[],
    private readonly selfKey: PlayerKey,
  ) {
    const { width, height } = CONFIG.view;
    this.objects.push(scene.add.rectangle(0, 0, width, height, GRASS).setOrigin(0).setDepth(-1000));
    const assets = assetsOf(scene);
    const info = byKey(players);
    for (const [key, p] of info) {
      const char = new Character(scene, assets, p.look, p.slot);
      const label = txt(scene, 0, 0, p.name, 7, key === selfKey ? '#fff4a8' : '#ffffff');
      this.avatars.set(key, { char, label, anim: 'idle', dir: 'down' });
      this.objects.push(char, label);
    }
    // HUD: time in the middle, one score per player (symbol + number) in slot order.
    this.objects.push(scene.add.rectangle(0, 0, width, 14, 0x3b2418, 0.55).setOrigin(0).setDepth(1000));
    this.time = txt(scene, width / 2, 7, '', 9).setDepth(1001);
    [...info.entries()].forEach(([key, p], i) => {
      const x = i < 2 ? 14 + i * 50 : width - 86 + (i - 2) * 50;
      playerSymbol(scene, p.slot, x, 7)?.setDepth(1001);
      const t = txt(scene, x + 8, 7, '0', 9).setOrigin(0, 0.5).setDepth(1001);
      this.scores.set(key, t);
    });
  }

  predict(input: InputState, dt: number, latest: SandboxState | null): void {
    const server = latest?.players[this.selfKey];
    if (!server) return;
    if (!this.pred) this.pred = { x: server.x, y: server.y, dir: server.dir, moving: false };
    const p = this.pred;
    const m = moveStep(p, input, dt);
    p.x = m.x;
    p.y = m.y;
    p.moving = m.moving;
    if (m.dir) p.dir = m.dir;
    if (Math.hypot(server.x - p.x, server.y - p.y) > CONFIG.net.predictErrPx) {
      p.x += (server.x - p.x) * CONFIG.net.predictEase;
      p.y += (server.y - p.y) * CONFIG.net.predictEase;
    }
  }

  render(s: SandboxState, selfKey: PlayerKey): void {
    for (const [key, a] of this.avatars) {
      const sp = s.players[key];
      if (!sp) continue;
      const p = key === selfKey && this.pred ? { ...sp, ...this.pred } : sp;
      a.char.setPosition(Math.round(p.x), Math.round(p.y)).setDepth(p.y);
      a.label.setPosition(Math.round(p.x), Math.round(p.y) - 44).setDepth(p.y + 0.5);
      const anim = p.moving ? 'run' : 'idle';
      if (anim !== a.anim || p.dir !== a.dir) {
        a.anim = anim;
        a.dir = p.dir;
        a.char.play(anim, p.dir);
      }
      this.scores.get(key)?.setText(String(sp.score));
    }
    const alive = new Set(s.coins.map((c) => c.id));
    for (const [id, r] of this.coins) {
      if (!alive.has(id)) {
        r.destroy();
        this.coins.delete(id);
      }
    }
    for (const c of s.coins) {
      if (this.coins.has(c.id)) continue;
      const half = SANDBOX.coinSize / 2;
      const r = this.scene.add
        .rectangle(c.x, c.y - half, SANDBOX.coinSize, SANDBOX.coinSize, COIN)
        .setStrokeStyle(1, COIN_EDGE)
        .setDepth(c.y);
      this.coins.set(c.id, r);
    }
    this.time.setText(`${Math.ceil(s.timeLeftMs / 1000)} s`);
  }

  destroy(): void {
    for (const r of this.coins.values()) r.destroy();
    for (const o of this.objects) o.destroy();
    for (const t of this.scores.values()) t.destroy();
    this.coins.clear();
    this.avatars.clear();
  }
}

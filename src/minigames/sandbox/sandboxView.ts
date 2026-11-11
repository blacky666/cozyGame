import Phaser from 'phaser';
import { CONFIG } from '../../config';
import { Character } from '../../gfx/character';
import { assetsOf, byKey, playerSymbol, txt } from '../../game/ui';
import type { PlayerInfo } from '../../net/roster';
import { Reconciler } from '../../net/reconcile';
import type { InputState, MiniGameView, PlayerKey } from '../types';
import { moveStep, SANDBOX, type Facing, type SandboxState } from './sandboxHost';

const GRASS = 0x86b45a;
const COIN = 0xf5d442;
const COIN_EDGE = 0xb7861d;

type Avatar = { char: Character; label: Phaser.GameObjects.Text; anim: string; dir: Facing };
type Pred = { x: number; y: number; dir: Facing; moving: boolean };

const predStep = (p: Pred, input: InputState, dt: number): Pred => {
  const m = moveStep(p, input, dt);
  return { x: m.x, y: m.y, dir: m.dir ?? p.dir, moving: m.moving };
};

export class SandboxView implements MiniGameView<SandboxState> {
  private readonly avatars = new Map<PlayerKey, Avatar>();
  private readonly coins = new Map<number, Phaser.GameObjects.Rectangle>();
  private readonly scores = new Map<PlayerKey, Phaser.GameObjects.Text>();
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly time: Phaser.GameObjects.Text;
  /** Shove cooldown ring under the own figure. */
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly reconciler = new Reconciler<Pred>(predStep);
  /** Reconciled position (server state plus unacknowledged input), before visual easing. */
  private target: Pred | null = null;
  /** Visual error still to ease out (prediction shown so far minus the reconciled position). */
  private off = { x: 0, y: 0 };
  private lastLatest: SandboxState | null = null;
  private lastSentSeq = 0;
  private dir: Facing | null = null;
  /** What is drawn for the own figure. */
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
      const label = txt(scene, 0, 0, p.name, 10, key === selfKey ? '#fff4a8' : '#ffffff');
      this.avatars.set(key, { char, label, anim: 'idle', dir: 'down' });
      this.objects.push(char, label);
    }
    this.ring = scene.add.graphics();
    this.objects.push(this.ring);
    // HUD: time in the middle, one score per player (symbol + number) in slot order.
    this.objects.push(scene.add.rectangle(0, 0, width, 16, 0x3b2418, 0.55).setOrigin(0).setDepth(1000));
    this.time = txt(scene, width / 2, 8, '', 10).setDepth(1001);
    [...info.entries()].forEach(([key, p], i) => {
      const x = i < 2 ? 14 + i * 50 : width - 86 + (i - 2) * 50;
      playerSymbol(scene, p.slot, x, 8)?.setDepth(1001);
      const t = txt(scene, x + 8, 8, '0', 10).setOrigin(0, 0.5).setDepth(1001);
      this.scores.set(key, t);
    });
  }

  predict(input: InputState, dt: number, latest: SandboxState | null, ackSeq: number, sentSeq: number): void {
    // A lower seq means a new connection: the host restarted its ack counter.
    if (sentSeq < this.lastSentSeq) this.reconciler.clear();
    this.lastSentSeq = sentSeq;
    // An ack beyond what we sent belongs to the previous connection.
    const ack = ackSeq > sentSeq ? 0 : ackSeq;
    const server = latest?.players[this.selfKey];
    if (!server) return;
    const fresh = latest !== this.lastLatest;
    this.lastLatest = latest;
    if (server.stun) {
      // Being shoved: the host moves us, input does nothing.
      this.reconciler.clear();
      this.target = { x: server.x, y: server.y, dir: server.dir, moving: false };
      this.off = { x: 0, y: 0 };
      this.pred = { ...this.target };
      return;
    }
    this.reconciler.record(sentSeq, input, dt);
    if (!this.target) {
      this.target = { x: server.x, y: server.y, dir: server.dir, moving: false };
    } else {
      const advanced = predStep(this.target, input, dt);
      if (fresh) {
        const next = this.reconciler.reconcile({ x: server.x, y: server.y, dir: server.dir, moving: false }, ack);
        // Carry the shown position over: a reconcile without error leaves the offset untouched.
        this.off = { x: this.off.x + advanced.x - next.x, y: this.off.y + advanced.y - next.y };
        this.target = next;
      } else {
        this.target = advanced;
      }
    }
    // Facing and run state come from the current input, not from the replay base.
    const m = moveStep(this.target, input, 0);
    this.dir = m.dir ?? this.dir ?? server.dir;
    const keep = 1 - CONFIG.net.predictEase;
    this.off = { x: this.off.x * keep, y: this.off.y * keep };
    if (Math.abs(this.off.x) < 0.01 && Math.abs(this.off.y) < 0.01) this.off = { x: 0, y: 0 };
    this.pred = { x: this.target.x + this.off.x, y: this.target.y + this.off.y, dir: this.dir, moving: m.moving };
  }

  render(s: SandboxState, selfKey: PlayerKey): void {
    for (const [key, a] of this.avatars) {
      const sp = s.players[key];
      if (!sp) continue;
      const p = key === selfKey && this.pred ? { ...sp, ...this.pred } : sp;
      a.char.setPosition(Math.round(p.x), Math.round(p.y)).setDepth(p.y);
      a.label.setPosition(Math.round(p.x), Math.round(p.y) - 46).setDepth(p.y + 0.5);
      const anim = sp.stun ? 'stumble' : sp.swing ? 'throw' : p.moving ? 'run' : 'idle';
      if (anim !== a.anim || p.dir !== a.dir) {
        a.anim = anim;
        a.dir = p.dir;
        a.char.play(anim, p.dir);
      }
      this.scores.get(key)?.setText(String(sp.score));
      if (key === selfKey) this.drawRing(Math.round(p.x), Math.round(p.y), sp.shoveCdMs);
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

  /** Filling ellipse under the feet while the shove cools down; hidden when ready. */
  private drawRing(x: number, y: number, cdMs: number): void {
    const g = this.ring.clear();
    if (cdMs <= 0) return;
    const done = 1 - cdMs / CONFIG.shove.cooldownMs;
    g.setPosition(x, y + 1).setScale(1, 0.5).setDepth(y - 1);
    g.lineStyle(2, 0x3b2418, 0.35).strokeCircle(0, 0, 10);
    g.lineStyle(2, 0xfff4a8, 0.9).beginPath();
    g.arc(0, 0, 10, -Math.PI / 2, -Math.PI / 2 + done * Math.PI * 2, false).strokePath();
  }

  destroy(): void {
    for (const r of this.coins.values()) r.destroy();
    for (const o of this.objects) o.destroy();
    for (const t of this.scores.values()) t.destroy();
    this.coins.clear();
    this.avatars.clear();
  }
}

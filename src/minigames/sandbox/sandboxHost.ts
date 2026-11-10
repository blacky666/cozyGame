import { CONFIG } from '../../config';
import { neutralInput } from '../../net/protocol';
import { newShoveSlot, resolveShoves, stepShove, type Facing, type ShoveSlot } from '../common/shove';
import type { BotView, InputState, MiniGameHost, PlayerKey } from '../types';

export type { Facing } from '../common/shove';

export type SandboxPlayer = {
  x: number;
  y: number;
  dir: Facing;
  moving: boolean;
  score: number;
  /** Being shoved away right now (no steering). */
  stun: boolean;
  /** Playing the own shove animation. */
  swing: boolean;
  /** Remaining shove cooldown in ms (0 = ready). */
  shoveCdMs: number;
};
export type Coin = { id: number; x: number; y: number };
export type SandboxState = {
  timeLeftMs: number;
  players: Record<PlayerKey, SandboxPlayer>;
  coins: Coin[];
};

export const SANDBOX = {
  speed: CONFIG.sandbox.speed,
  spawnMs: CONFIG.sandbox.spawnMs,
  coinSize: CONFIG.sandbox.coinSize,
  /** Distance between the player's lower body and a coin centre that counts as a touch. */
  pickupRadius: CONFIG.sandbox.pickupRadius,
  maxCoins: CONFIG.sandbox.maxCoins,
  /** Walkable area for the player pivot (feet); the top keeps room for head + HUD. Derived from the view. */
  bounds: { minX: 8, maxX: CONFIG.view.width - 8, minY: 40, maxY: CONFIG.view.height - 4 },
} as const;

const START: ReadonlyArray<readonly [number, number]> = [
  [120, 100],
  [306, 100],
  [120, 190],
  [306, 190],
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One movement step (shared by host simulation and client prediction). */
export function moveStep(
  p: { x: number; y: number },
  input: InputState,
  dt: number,
): { x: number; y: number; dir: Facing | null; moving: boolean } {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx === 0 && dy === 0) return { x: p.x, y: p.y, dir: null, moving: false };
  const len = Math.hypot(dx, dy);
  const b = SANDBOX.bounds;
  const x = clamp(p.x + (dx / len) * SANDBOX.speed * dt, b.minX, b.maxX);
  const y = clamp(p.y + (dy / len) * SANDBOX.speed * dt, b.minY, b.maxY);
  const dir: Facing = dx > 0 ? 'side' : dx < 0 ? 'left' : dy < 0 ? 'up' : 'down';
  return { x, y, dir, moving: true };
}

/** Host simulation of the placeholder game "Münzjagd". dt in seconds. */
export function createSandboxHost(
  keys: PlayerKey[],
  rand: () => number,
  durationMs: number = CONFIG.sandbox.durationMs,
): MiniGameHost<SandboxState> {
  const players: Record<PlayerKey, SandboxPlayer> = {};
  const shove: Record<PlayerKey, ShoveSlot> = {};
  keys.forEach((k, i) => {
    const [x, y] = START[Number(k.slice(1))] ?? START[i % START.length];
    players[k] = { x, y, dir: 'down', moving: false, score: 0, stun: false, swing: false, shoveCdMs: 0 };
    shove[k] = newShoveSlot();
  });
  let coins: Coin[] = [];
  let elapsedMs = 0;
  let spawnMs = 0;
  let nextId = 1;

  const spawn = () => {
    if (coins.length >= SANDBOX.maxCoins) return;
    const b = SANDBOX.bounds;
    const x = Math.round(b.minX + 4 + rand() * (b.maxX - b.minX - 8));
    const y = Math.round(b.minY + rand() * (b.maxY - b.minY - 4));
    coins.push({ id: nextId++, x, y });
  };

  return {
    tick(dt, inputs) {
      if (elapsedMs >= durationMs) return;
      const ms = Math.min(dt * 1000, durationMs - elapsedMs);
      elapsedMs += ms;
      spawnMs += ms;
      while (spawnMs >= SANDBOX.spawnMs) {
        spawnMs -= SANDBOX.spawnMs;
        spawn();
      }
      // Shoving makes the victim drop a coin where they stood.
      for (const h of resolveShoves(keys, players, shove, inputs)) {
        const v = players[h.to];
        if (v.score <= 0) continue;
        v.score -= 1;
        coins.push({ id: nextId++, x: Math.round(v.x), y: Math.round(v.y - 4) });
      }
      for (const k of keys) {
        const p = players[k];
        const sh = shove[k];
        const stunned = sh.stunMs > 0;
        const slide = stepShove(sh, ms / 1000);
        if (stunned) {
          const b = SANDBOX.bounds;
          p.x = clamp(p.x + slide.dx, b.minX, b.maxX);
          p.y = clamp(p.y + slide.dy, b.minY, b.maxY);
          p.moving = false;
        } else {
          const m = moveStep(p, inputs[k] ?? neutralInput(), ms / 1000);
          p.x = m.x;
          p.y = m.y;
          p.moving = m.moving;
          if (m.dir) p.dir = m.dir;
        }
        p.stun = sh.stunMs > 0;
        p.swing = sh.swingMs > 0;
        p.shoveCdMs = Math.ceil(sh.cooldownMs);
        // No pickups while being shoved (the victim would catch their own coin) or while swinging
        // (the shover would grab it instantly instead of it visibly dropping).
        if (stunned || sh.swingMs > 0) continue;
        // Coins float slightly above the ground; compare against the lower body.
        const hit = coins.find((c) => Math.hypot(c.x - p.x, c.y - (p.y - 4)) <= SANDBOX.pickupRadius);
        if (hit) {
          p.score += 1;
          coins = coins.filter((c) => c !== hit);
        }
      }
    },
    snapshot() {
      const ps: Record<PlayerKey, SandboxPlayer> = {};
      for (const k of keys) ps[k] = { ...players[k] };
      return {
        timeLeftMs: Math.max(0, Math.ceil(durationMs - elapsedMs)),
        players: ps,
        coins: coins.map((c) => ({ ...c })),
      };
    },
    result() {
      if (elapsedMs < durationMs) return null;
      const scores = [...new Set(keys.map((k) => players[k].score))].sort((a, b) => b - a);
      return scores.map((s) => keys.filter((k) => players[k].score === s));
    },
  };
}

/** Interpolate positions; discrete fields (dir, moving, score, coins) come from the newer state. */
export function lerpSandbox(a: SandboxState, b: SandboxState, t: number): SandboxState {
  const players: Record<PlayerKey, SandboxPlayer> = {};
  for (const [k, pb] of Object.entries(b.players)) {
    const pa = a.players[k];
    players[k] = pa ? { ...pb, x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t } : { ...pb };
  }
  return { timeLeftMs: b.timeLeftMs, players, coins: b.coins };
}

/** What a bot needs to know about this game (targets are given as pivot positions). */
export function sandboxBotView(s: SandboxState, key: PlayerKey): BotView | null {
  const me = s.players[key];
  return me ? { self: { x: me.x, y: me.y }, targets: s.coins.map((c) => ({ x: c.x, y: c.y + 4 })) } : null;
}

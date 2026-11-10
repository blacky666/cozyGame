import { CONFIG } from '../config';
import type { Look } from '../save/profile';

export type Slot = 0 | 1 | 2 | 3;

export type PlayerInfo = {
  id: string;
  slot: Slot;
  name: string;
  look: Look;
  connected: boolean;
  ready: boolean;
  isBot: boolean;
  disconnectedAt?: number;
};

export type JoinResult =
  | { ok: true; player: PlayerInfo; reclaimed: boolean }
  | { ok: false; reason: 'full' | 'running' | 'name' };

const SLOTS: readonly Slot[] = [0, 1, 2, 3];
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Host-side player list: slot assignment, reconnect grace and readiness. */
export class Roster {
  private players: PlayerInfo[] = [];

  constructor(private readonly graceMs: number = CONFIG.net.reconnectGraceMs) {}

  join(id: string, name: string, look: Look, now: number, opts: { running: boolean; isBot?: boolean }): JoinResult {
    if (this.players.some((p) => p.connected && sameName(p.name, name))) return { ok: false, reason: 'name' };

    const old = this.players.find(
      (p) => !p.connected && sameName(p.name, name) && now - (p.disconnectedAt ?? now) <= this.graceMs,
    );
    if (old) {
      old.id = id;
      old.look = look;
      old.connected = true;
      delete old.disconnectedAt;
      return { ok: true, player: old, reclaimed: true };
    }
    if (opts.running) return { ok: false, reason: 'running' };

    const max = Math.min(CONFIG.players.max, SLOTS.length);
    const slot = SLOTS.slice(0, max).find((s) => !this.players.some((p) => p.slot === s));
    if (slot === undefined) return { ok: false, reason: 'full' };

    const player: PlayerInfo = { id, slot, name, look, connected: true, ready: false, isBot: opts.isBot ?? false };
    this.players.push(player);
    this.players.sort((a, b) => a.slot - b.slot);
    return { ok: true, player, reclaimed: false };
  }

  /** Mark a player as disconnected; the slot is kept for reconnectGraceMs. */
  leave(id: string, now: number): void {
    const p = this.get(id);
    if (!p || !p.connected) return;
    p.connected = false;
    p.ready = false;
    p.disconnectedAt = now;
  }

  /** Drop a player immediately (e.g. leaving the lobby). */
  remove(id: string): PlayerInfo | undefined {
    const p = this.get(id);
    if (p) this.players = this.players.filter((x) => x !== p);
    return p;
  }

  /** Remove disconnected players whose grace period has passed; returns them. */
  expire(now: number): PlayerInfo[] {
    const gone = this.players.filter((p) => !p.connected && now - (p.disconnectedAt ?? now) > this.graceMs);
    if (gone.length) this.players = this.players.filter((p) => !gone.includes(p));
    return gone;
  }

  setReady(id: string, ready: boolean): boolean {
    const p = this.get(id);
    if (!p || !p.connected || p.ready === ready) return false;
    p.ready = ready;
    return true;
  }

  get(id: string): PlayerInfo | undefined {
    return this.players.find((p) => p.id === id);
  }

  /** Copies, ordered by slot. */
  list(): PlayerInfo[] {
    return this.players.map((p) => ({ ...p }));
  }
}

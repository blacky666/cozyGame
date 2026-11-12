import { CONFIG } from '../config';
import { APP_VERSION } from '../version';
import { levelBadge as badge } from '../progress/levels';
import { migrate, type Look, type Profile } from '../save/profile';
import { INPUT_COUNTERS, keepCounters, neutralInput, parseInputState, type InputCounter, type InputState, type MsgData, type MsgType, type RejectReason } from './protocol';
import { Roster, type PlayerInfo } from './roster';
import type { Transport } from './transport';

/*
 * Handshake / host identification:
 * - A client sends `hello` to every peer it meets (onPeerJoin) until it knows its host.
 * - Only a host session listens for `hello`; plain clients never register a handler, so they ignore it.
 * - The host answers with `welcome` (or `reject`). The first peer that sends a client a `welcome`
 *   becomes its host; from then on host messages from any other peer are ignored and `onHostLost`
 *   fires when exactly that peer leaves.
 */

export const LOBBY = 'lobby';
const REJECT_REASONS: readonly RejectReason[] = ['full', 'running', 'version', 'name', 'kicked'];

type ProfileLike = Pick<Profile, 'name' | 'look' | 'xp'>;
type Snap = MsgData<'snap'>;
type PhaseMsg = MsgData<'phase'>;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const MAX_STARS = 9999;
/** Untrusted level/stars from the wire: integers in range, else 1 / 0. */
const cleanLevel = (x: unknown): number =>
  typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= CONFIG.progress.maxLevel ? x : 1;
const cleanStars = (x: unknown): number => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= MAX_STARS ? x : 0);
/** Add a listener; returns its unsubscribe function. */
const subscribe = <F>(list: F[], cb: F): (() => void) => {
  list.push(cb);
  return () => {
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  };
};
export type Unsubscribe = () => void;

/** Longest card id the host forwards (real ids are far shorter). */
const MAX_CARD_ID = 32;

const send = <T extends MsgType>(t: Transport, type: T, data: MsgData<T>, to?: string) => t.send(type, data, to);

export interface HostSession {
  readonly selfId: string;
  readonly roster: Roster;
  readonly phase: string;
  onInput(cb: (playerId: string, state: InputState, seq: number) => void): Unsubscribe;
  onRoster(cb: (players: PlayerInfo[]) => void): Unsubscribe;
  /** Card picks of connected remote players, phase `cards` only (the evening host checks chooser and offer). */
  onCard(cb: (playerId: string, card: string) => void): Unsubscribe;
  /** Latest input of a player (neutral if none, or if a remote input is older than CONFIG.net.inputStaleMs). */
  input(playerId: string): InputState;
  /** Seq of the last accepted input of a player (0 for local players and unknown ids). */
  lastSeq(playerId: string): number;
  /** Send a snapshot of the current phase to all connected clients. */
  broadcast(phase: string, payload: unknown): void;
  setPhase(phase: string, data?: unknown): void;
  /** Add a player without a transport peer (dev bots). Returns null if the roster refuses. */
  addLocalPlayer(name: string, look: Look, opts?: { isBot?: boolean }): PlayerInfo | null;
  /** Lobby look/level/stars of the host's own player or a local bot (broadcasts the roster on change). */
  setLocalProfile(id: string, look: Look, level: number, stars: number): void;
  /** Input for the host's own player (selfId) or a local bot. */
  setLocalInput(playerId: string, state: InputState): void;
  setLocalReady(playerId: string, ready: boolean): void;
  /** Back to the lobby after an evening: drop disconnected players, reset ready (bots stay ready). */
  resetForLobby(data?: unknown): void;
  /** Lobby only: remove a remote player; they cannot rejoin this room from the same connection. */
  kick(playerId: string): boolean;
  /** Says `bye` to all clients (so they notice at once), then leaves the room. */
  close(): void;
}

export function createHost(t: Transport, profile: ProfileLike, opts: { now?: () => number } = {}): HostSession {
  const now = opts.now ?? Date.now;
  const roster = new Roster();
  const inputs = new Map<string, InputState>();
  const lastSeq = new Map<string, number>();
  const inputAt = new Map<string, number>();
  /**
   * Per reclaimed player: what is subtracted from the client's counters. A rejoining client keeps its
   * keyboard counters (and may have pressed while away), so its first input after the rejoin is taken
   * as the new baseline: the host-visible counters continue from the last known values and no game
   * edge (shove, throw, prank, emote ...) fires on its own.
   */
  const offsets = new Map<string, Record<InputCounter, number>>();
  /** Reclaimed players whose next input sets their offset. */
  const rebase = new Set<string>();
  const forget = (id: string) => {
    inputs.delete(id);
    lastSeq.delete(id);
    inputAt.delete(id);
    offsets.delete(id);
    rebase.delete(id);
  };
  const local = new Set<string>([t.selfId]);
  const inputCbs: Array<(id: string, s: InputState, seq: number) => void> = [];
  const rosterCbs: Array<(players: PlayerInfo[]) => void> = [];
  const cardCbs: Array<(id: string, card: string) => void> = [];
  let phase = LOBBY;
  let tick = 0;
  let botCounter = 0;
  let localSeq = 0;
  /** Peers the host removed: their hellos are refused for the rest of the room. */
  const kicked = new Set<string>();

  roster.join(t.selfId, profile.name, profile.look, now(), { running: false, ...badge(profile.xp) });

  const remotes = () => roster.list().filter((p) => p.connected && !local.has(p.id)).map((p) => p.id);
  const toAll = <T extends MsgType>(type: T, data: MsgData<T>) => {
    for (const id of remotes()) send(t, type, data, id);
  };
  const rosterChanged = () => {
    const list = roster.list();
    toAll('roster', list);
    [...rosterCbs].forEach((cb) => cb(roster.list()));
  };
  const emitInput = (id: string, s: InputState, seq: number) => {
    inputs.set(id, s);
    inputAt.set(id, now());
    [...inputCbs].forEach((cb) => cb(id, s, seq));
  };

  t.on('hello', (data, from) => {
    if (!isObj(data) || typeof data.name !== 'string' || typeof data.version !== 'string') return;
    const name = data.name.trim();
    if (local.has(from)) return;
    if (kicked.has(from)) return send(t, 'reject', { reason: 'kicked' }, from);
    if (name.length === 0 || name.length > CONFIG.players.maxName) return send(t, 'reject', { reason: 'name' }, from);
    if (data.version !== APP_VERSION) return send(t, 'reject', { reason: 'version' }, from);

    const existing = roster.get(from);
    const away = roster.list().filter((p) => !p.connected);
    const res = existing?.connected
      ? { ok: true as const, player: existing }
      : roster.join(from, name, migrate({ look: data.look }).look, now(), {
          running: phase !== LOBBY,
          level: cleanLevel(data.level),
          stars: cleanStars(data.stars),
        });
    if (!res.ok) return send(t, 'reject', { reason: res.reason }, from);
    lastSeq.delete(from);
    if ('reclaimed' in res && res.reclaimed) {
      // The slot keeps its last known counters (buttons released) under the new peer id.
      const prevId = away.find((p) => p.slot === res.player.slot)?.id;
      const last = (prevId !== undefined ? inputs.get(prevId) : undefined) ?? neutralInput();
      if (prevId !== undefined) forget(prevId);
      inputs.set(from, keepCounters(last));
      inputAt.delete(from);
      offsets.delete(from);
      rebase.add(from);
    }
    send(t, 'welcome', { id: from, slot: res.player.slot, roster: roster.list(), phase }, from);
    rosterChanged();
  });

  t.on('input', (data, from) => {
    const p = roster.get(from);
    if (!p || !p.connected || local.has(from)) return;
    if (!isObj(data) || typeof data.seq !== 'number' || !Number.isFinite(data.seq)) return;
    if (data.seq <= (lastSeq.get(from) ?? 0)) return; // stale / reordered
    const state = parseInputState(data.state);
    if (!state) return;
    if (rebase.delete(from)) {
      const base = inputs.get(from) ?? neutralInput();
      const off = {} as Record<InputCounter, number>;
      for (const k of INPUT_COUNTERS) off[k] = state[k] - base[k];
      offsets.set(from, off);
    }
    const off = offsets.get(from);
    if (off) for (const k of INPUT_COUNTERS) state[k] = Math.max(0, state[k] - off[k]);
    lastSeq.set(from, data.seq);
    emitInput(from, state, data.seq);
  });

  t.on('ready', (data, from) => {
    if (phase !== LOBBY || local.has(from) || !isObj(data) || typeof data.ready !== 'boolean') return;
    if (roster.setReady(from, data.ready)) rosterChanged();
  });
  // `settings` are host-authoritative: client-sent settings are ignored on purpose.

  t.on('profile', (data, from) => {
    const p = roster.get(from);
    if (phase !== LOBBY || !p || !p.connected || local.has(from) || !isObj(data)) return;
    const look = migrate({ look: data.look }).look;
    if (roster.setProfile(from, look, cleanLevel(data.level), cleanStars(data.stars))) rosterChanged();
  });

  t.on('card', (data, from) => {
    const p = roster.get(from);
    if (phase !== 'cards' || !p || !p.connected || local.has(from) || !isObj(data)) return;
    const card = data.card;
    if (typeof card !== 'string' || card.length > MAX_CARD_ID) return;
    [...cardCbs].forEach((cb) => cb(from, card));
  });

  t.onPeerLeave((id) => {
    if (!roster.get(id) || local.has(id)) return;
    if (phase === LOBBY) {
      roster.remove(id);
      forget(id);
    } else {
      // Keep the counters (buttons released) so a rejoin under a new id continues from them.
      roster.leave(id, now());
      const last = inputs.get(id);
      forget(id);
      if (last) inputs.set(id, keepCounters(last));
    }
    rosterChanged();
  });

  return {
    selfId: t.selfId,
    roster,
    get phase() {
      return phase;
    },
    onInput: (cb) => subscribe(inputCbs, cb),
    onRoster: (cb) => subscribe(rosterCbs, cb),
    onCard: (cb) => subscribe(cardCbs, cb),
    input(id) {
      const s = inputs.get(id);
      if (!s) return neutralInput();
      // Remote input that stopped arriving (lost packets, frozen tab) must not keep a player running.
      if (!local.has(id) && now() - (inputAt.get(id) ?? 0) > CONFIG.net.inputStaleMs) {
        // Buttons are released, but the action counters stay so the host's edges do not re-fire.
        return keepCounters(s);
      }
      return s;
    },
    lastSeq: (id) => lastSeq.get(id) ?? 0,
    broadcast(ph, payload) {
      if (roster.expire(now()).length > 0) rosterChanged();
      toAll('snap', { tick: ++tick, phase: ph, payload });
    },
    setPhase(ph, data) {
      phase = ph;
      toAll('phase', data === undefined ? { phase: ph } : { phase: ph, data });
    },
    addLocalPlayer(name, look, o = {}) {
      const id = `bot-${++botCounter}`;
      const res = roster.join(id, name, look, now(), { running: phase !== LOBBY, isBot: o.isBot ?? false });
      if (!res.ok) return null;
      local.add(id);
      rosterChanged();
      return { ...res.player };
    },
    setLocalProfile(id, look, level, stars) {
      if (!local.has(id)) return;
      if (roster.setProfile(id, migrate({ look }).look, cleanLevel(level), cleanStars(stars))) rosterChanged();
    },
    setLocalInput(id, state) {
      if (local.has(id) && roster.get(id)) emitInput(id, { ...state }, ++localSeq);
    },
    setLocalReady(id, ready) {
      if (local.has(id) && roster.setReady(id, ready)) rosterChanged();
    },
    resetForLobby(data) {
      for (const p of roster.list()) {
        if (!p.connected) {
          roster.remove(p.id);
          forget(p.id);
        } else {
          roster.setReady(p.id, p.isBot);
        }
      }
      // Every client starts the next evening with a fresh keyboard (counters from 0): rejoin offsets
      // from this evening would swallow its first presses.
      offsets.clear();
      rebase.clear();
      phase = LOBBY;
      toAll('phase', data === undefined ? { phase: LOBBY } : { phase: LOBBY, data });
      rosterChanged();
    },
    kick(id) {
      const p = roster.get(id);
      if (phase !== LOBBY || !p || local.has(id)) return false;
      kicked.add(id);
      send(t, 'reject', { reason: 'kicked' }, id);
      roster.remove(id);
      forget(id);
      rosterChanged();
      return true;
    },
    close() {
      toAll('bye', {});
      t.leave();
    },
  };
}

export interface ClientSession {
  readonly selfId: string;
  readonly hostId: string | null;
  readonly playerId: string | null;
  readonly roster: PlayerInfo[];
  readonly phase: string;
  /** Returns the seq it sent (0 if nothing was sent). */
  sendInput(state: InputState): number;
  setReady(ready: boolean): void;
  /** Lobby only (the host ignores it otherwise): own look, level and stars changed. */
  sendProfile(look: Look, level: number, stars: number): void;
  /** Phase `cards`, chooser only (the host ignores it otherwise): the picked Gemeinheit card. */
  sendCard(card: string): void;
  onRoster(cb: (players: PlayerInfo[]) => void): Unsubscribe;
  onSnapshot(cb: (snap: Snap) => void): Unsubscribe;
  onPhase(cb: (phase: PhaseMsg) => void): Unsubscribe;
  onRejected(cb: (reason: RejectReason) => void): Unsubscribe;
  /** Host left: its `bye` arrived or its peer disconnected (whichever comes first). */
  onHostLost(cb: () => void): Unsubscribe;
  close(): void;
}

export function createClient(t: Transport, profile: ProfileLike, opts: { version?: string } = {}): ClientSession {
  const hello: MsgData<'hello'> = {
    name: profile.name, version: opts.version ?? APP_VERSION, look: profile.look, ...badge(profile.xp),
  };
  let hostId: string | null = null;
  let playerId: string | null = null;
  let roster: PlayerInfo[] = [];
  let phase = LOBBY;
  let seq = 0;
  let done = false; // rejected, host lost or closed: no more handshakes
  const rosterCbs: Array<(p: PlayerInfo[]) => void> = [];
  const snapCbs: Array<(s: Snap) => void> = [];
  const phaseCbs: Array<(p: PhaseMsg) => void> = [];
  const rejectCbs: Array<(r: RejectReason) => void> = [];
  const lostCbs: Array<() => void> = [];

  const fromHost = (from: string) => hostId !== null && from === hostId;
  const setRoster = (data: unknown) => {
    if (!Array.isArray(data)) return;
    roster = data as PlayerInfo[];
    [...rosterCbs].forEach((cb) => cb(roster));
  };

  t.onPeerJoin((id) => {
    if (!done && hostId === null) send(t, 'hello', hello, id);
  });

  t.on('welcome', (data, from) => {
    if (done || (hostId !== null && from !== hostId)) return;
    if (!isObj(data) || typeof data.id !== 'string' || typeof data.phase !== 'string') return;
    hostId = from;
    playerId = data.id;
    phase = data.phase;
    setRoster(data.roster);
  });

  t.on('reject', (data, from) => {
    if (done || !isObj(data)) return;
    const reason = data.reason as RejectReason;
    if (!REJECT_REASONS.includes(reason)) return;
    // Before the welcome any peer may reject us; afterwards only our host can, and only by kicking.
    if (hostId !== null && !(fromHost(from) && reason === 'kicked')) return;
    done = true;
    [...rejectCbs].forEach((cb) => cb(reason));
  });

  t.on('roster', (data, from) => {
    if (fromHost(from)) setRoster(data);
  });

  t.on('phase', (data, from) => {
    if (!fromHost(from) || !isObj(data) || typeof data.phase !== 'string') return;
    phase = data.phase;
    const msg = data as PhaseMsg;
    [...phaseCbs].forEach((cb) => cb(msg));
  });

  t.on('snap', (data, from) => {
    if (!fromHost(from) || !isObj(data) || typeof data.tick !== 'number' || typeof data.phase !== 'string') return;
    const snap = data as Snap;
    [...snapCbs].forEach((cb) => cb(snap));
  });

  const hostLost = () => {
    done = true;
    [...lostCbs].forEach((cb) => cb());
  };
  t.on('bye', (_data, from) => {
    if (!done && fromHost(from)) hostLost();
  });
  t.onPeerLeave((id) => {
    if (!done && id === hostId) hostLost();
  });

  return {
    selfId: t.selfId,
    get hostId() {
      return hostId;
    },
    get playerId() {
      return playerId;
    },
    get roster() {
      return roster;
    },
    get phase() {
      return phase;
    },
    sendInput(state) {
      if (done || !hostId) return 0;
      send(t, 'input', { seq: ++seq, state }, hostId);
      return seq;
    },
    setReady(ready) {
      if (!done && hostId) send(t, 'ready', { ready }, hostId);
    },
    sendProfile(look, level, stars) {
      // A reconnect's hello must carry the current profile too.
      hello.look = look;
      hello.level = level;
      hello.stars = stars;
      if (!done && hostId) send(t, 'profile', { look, level, stars }, hostId);
    },
    sendCard(card) {
      if (!done && hostId) send(t, 'card', { card }, hostId);
    },
    onRoster: (cb) => subscribe(rosterCbs, cb),
    onSnapshot: (cb) => subscribe(snapCbs, cb),
    onPhase: (cb) => subscribe(phaseCbs, cb),
    onRejected: (cb) => subscribe(rejectCbs, cb),
    onHostLost: (cb) => subscribe(lostCbs, cb),
    close() {
      done = true;
      t.leave();
    },
  };
}

/** Minimal Worker surface used by the ticker (injectable for tests). */
export interface TickWorker {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(m: unknown): void;
  terminate(): void;
}
export type TickWorkerCtor = new (url: URL, opts?: WorkerOptions) => TickWorker;

const MAX_DT = 0.25;

/** Drive the host simulation from a dedicated Worker so it keeps ticking in background tabs. */
export function startHostTicker(hz: number, onTick: (dt: number) => void, WorkerCtor?: TickWorkerCtor): () => void {
  // The literal `new Worker(new URL(...), ...)` form is required for Vite to bundle the worker.
  const worker: TickWorker = WorkerCtor
    ? new WorkerCtor(new URL('./tickWorker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('./tickWorker.ts', import.meta.url), { type: 'module' });
  let last = performance.now();
  worker.onmessage = () => {
    const t = performance.now();
    const dt = Math.min(Math.max((t - last) / 1000, 0), MAX_DT);
    last = t;
    onTick(dt);
  };
  worker.postMessage({ hz });
  return () => {
    worker.onmessage = null;
    worker.terminate();
  };
}

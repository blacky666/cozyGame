import { APP_VERSION } from '../version';
import { migrate, type Look, type Profile } from '../save/profile';
import { neutralInput, parseInputState, type InputState, type MsgData, type MsgType, type RejectReason } from './protocol';
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
const MAX_NAME = 24;
const REJECT_REASONS: readonly RejectReason[] = ['full', 'running', 'version', 'name'];

type ProfileLike = Pick<Profile, 'name' | 'look'>;
type Snap = MsgData<'snap'>;
type PhaseMsg = MsgData<'phase'>;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const send = <T extends MsgType>(t: Transport, type: T, data: MsgData<T>, to?: string) => t.send(type, data, to);

export interface HostSession {
  readonly selfId: string;
  readonly roster: Roster;
  readonly phase: string;
  onInput(cb: (playerId: string, state: InputState, seq: number) => void): void;
  onRoster(cb: (players: PlayerInfo[]) => void): void;
  /** Latest input of a player (neutral if none). */
  input(playerId: string): InputState;
  /** Send a snapshot of the current phase to all connected clients. */
  broadcast(phase: string, payload: unknown): void;
  setPhase(phase: string, data?: unknown): void;
  /** Add a player without a transport peer (dev bots). Returns null if the roster refuses. */
  addLocalPlayer(name: string, look: Look, opts?: { isBot?: boolean }): PlayerInfo | null;
  /** Input for the host's own player (selfId) or a local bot. */
  setLocalInput(playerId: string, state: InputState): void;
  setLocalReady(playerId: string, ready: boolean): void;
  /** Back to the lobby after an evening: drop disconnected players, reset ready (bots stay ready). */
  resetForLobby(data?: unknown): void;
  close(): void;
}

export function createHost(t: Transport, profile: ProfileLike, opts: { now?: () => number } = {}): HostSession {
  const now = opts.now ?? Date.now;
  const roster = new Roster();
  const inputs = new Map<string, InputState>();
  const lastSeq = new Map<string, number>();
  const local = new Set<string>([t.selfId]);
  const inputCbs: Array<(id: string, s: InputState, seq: number) => void> = [];
  const rosterCbs: Array<(players: PlayerInfo[]) => void> = [];
  let phase = LOBBY;
  let tick = 0;
  let botCounter = 0;
  let localSeq = 0;

  roster.join(t.selfId, profile.name, profile.look, now(), { running: false });

  const remotes = () => roster.list().filter((p) => p.connected && !local.has(p.id)).map((p) => p.id);
  const toAll = <T extends MsgType>(type: T, data: MsgData<T>) => {
    for (const id of remotes()) send(t, type, data, id);
  };
  const rosterChanged = () => {
    const list = roster.list();
    toAll('roster', list);
    rosterCbs.forEach((cb) => cb(roster.list()));
  };
  const emitInput = (id: string, s: InputState, seq: number) => {
    inputs.set(id, s);
    inputCbs.forEach((cb) => cb(id, s, seq));
  };

  t.on('hello', (data, from) => {
    if (!isObj(data) || typeof data.name !== 'string' || typeof data.version !== 'string') return;
    const name = data.name.trim();
    if (name.length === 0 || name.length > MAX_NAME || local.has(from)) return;
    if (data.version !== APP_VERSION) return send(t, 'reject', { reason: 'version' }, from);

    const existing = roster.get(from);
    const res = existing?.connected
      ? { ok: true as const, player: existing }
      : roster.join(from, name, migrate({ look: data.look }).look, now(), { running: phase !== LOBBY });
    if (!res.ok) return send(t, 'reject', { reason: res.reason }, from);
    lastSeq.delete(from);
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
    lastSeq.set(from, data.seq);
    emitInput(from, state, data.seq);
  });

  t.on('ready', (data, from) => {
    if (phase !== LOBBY || local.has(from) || !isObj(data) || typeof data.ready !== 'boolean') return;
    if (roster.setReady(from, data.ready)) rosterChanged();
  });
  // `settings` are host-authoritative: client-sent settings are ignored on purpose.

  t.onPeerLeave((id) => {
    if (!roster.get(id) || local.has(id)) return;
    if (phase === LOBBY) roster.remove(id);
    else roster.leave(id, now());
    inputs.delete(id);
    lastSeq.delete(id);
    rosterChanged();
  });

  return {
    selfId: t.selfId,
    roster,
    get phase() {
      return phase;
    },
    onInput: (cb) => void inputCbs.push(cb),
    onRoster: (cb) => void rosterCbs.push(cb),
    input: (id) => inputs.get(id) ?? neutralInput(),
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
          inputs.delete(p.id);
          lastSeq.delete(p.id);
        } else {
          roster.setReady(p.id, p.isBot);
        }
      }
      phase = LOBBY;
      toAll('phase', data === undefined ? { phase: LOBBY } : { phase: LOBBY, data });
      rosterChanged();
    },
    close: () => t.leave(),
  };
}

export interface ClientSession {
  readonly selfId: string;
  readonly hostId: string | null;
  readonly playerId: string | null;
  readonly roster: PlayerInfo[];
  readonly phase: string;
  sendInput(state: InputState): void;
  setReady(ready: boolean): void;
  onRoster(cb: (players: PlayerInfo[]) => void): void;
  onSnapshot(cb: (snap: Snap) => void): void;
  onPhase(cb: (phase: PhaseMsg) => void): void;
  onRejected(cb: (reason: RejectReason) => void): void;
  onHostLost(cb: () => void): void;
  close(): void;
}

export function createClient(t: Transport, profile: ProfileLike, opts: { version?: string } = {}): ClientSession {
  const hello: MsgData<'hello'> = { name: profile.name, version: opts.version ?? APP_VERSION, look: profile.look };
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
    rosterCbs.forEach((cb) => cb(roster));
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

  t.on('reject', (data) => {
    if (done || hostId !== null || !isObj(data)) return;
    const reason = data.reason as RejectReason;
    if (!REJECT_REASONS.includes(reason)) return;
    done = true;
    rejectCbs.forEach((cb) => cb(reason));
  });

  t.on('roster', (data, from) => {
    if (fromHost(from)) setRoster(data);
  });

  t.on('phase', (data, from) => {
    if (!fromHost(from) || !isObj(data) || typeof data.phase !== 'string') return;
    phase = data.phase;
    const msg = data as PhaseMsg;
    phaseCbs.forEach((cb) => cb(msg));
  });

  t.on('snap', (data, from) => {
    if (!fromHost(from) || !isObj(data) || typeof data.tick !== 'number' || typeof data.phase !== 'string') return;
    const snap = data as Snap;
    snapCbs.forEach((cb) => cb(snap));
  });

  t.onPeerLeave((id) => {
    if (done || id !== hostId) return;
    done = true;
    lostCbs.forEach((cb) => cb());
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
      if (!done && hostId) send(t, 'input', { seq: ++seq, state }, hostId);
    },
    setReady(ready) {
      if (!done && hostId) send(t, 'ready', { ready }, hostId);
    },
    onRoster: (cb) => void rosterCbs.push(cb),
    onSnapshot: (cb) => void snapCbs.push(cb),
    onPhase: (cb) => void phaseCbs.push(cb),
    onRejected: (cb) => void rejectCbs.push(cb),
    onHostLost: (cb) => void lostCbs.push(cb),
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

import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../save/profile';
import { neutralInput, type InputState, type RejectReason } from './protocol';
import { createClient, createHost, startHostTicker, type TickWorker } from './session';
import { createLocalHub } from './transport';

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
};
const prof = (name: string) => defaultProfile(name);

describe('session', () => {
  it('rejects a client with a wrong version', async () => {
    const hub = createLocalHub();
    createHost(hub.join(), prof('Host'));
    const client = createClient(hub.join(), prof('Gast'), { version: '9.9.9-wrong' });
    const reasons: RejectReason[] = [];
    client.onRejected((r) => reasons.push(r));
    await flush();
    expect(reasons).toEqual(['version']);
    expect(client.hostId).toBeNull();
  });

  it('welcomes a client, broadcasts the roster and delivers inputs with the player id', async () => {
    const hub = createLocalHub();
    const ht = hub.join();
    const host = createHost(ht, prof('Host'));
    const ct = hub.join();
    const client = createClient(ct, prof('Gast'));
    const rosters: string[][] = [];
    client.onRoster((r) => rosters.push(r.map((p) => p.name)));
    const got: Array<[string, InputState, number]> = [];
    host.onInput((id, state, seq) => got.push([id, state, seq]));
    await flush();
    expect(client.hostId).toBe(ht.selfId);
    expect(client.playerId).toBe(ct.selfId);
    expect(host.roster.list().map((p) => [p.slot, p.id])).toEqual([[0, ht.selfId], [1, ct.selfId]]);
    expect(rosters.at(-1)).toEqual(['Host', 'Gast']);

    const state = { ...neutralInput(), left: true, aimX: 0.5 };
    client.sendInput(state);
    ct.send('input', { seq: 'x', state: 42 }, ht.selfId); // malformed: ignored
    ct.send('input', { seq: 0, state }, ht.selfId); // stale seq: ignored
    await flush();
    expect(got).toEqual([[ct.selfId, state, 1]]);
    expect(host.input(ct.selfId)).toEqual(state);

    client.setReady(true);
    await flush();
    expect(host.roster.get(ct.selfId)?.ready).toBe(true);
    expect(client.roster.find((p) => p.id === ct.selfId)?.ready).toBe(true);
  });

  it('ignores input from peers outside the roster and malformed hellos', async () => {
    const hub = createLocalHub();
    const ht = hub.join();
    const host = createHost(ht, prof('Host'));
    const got: string[] = [];
    host.onInput((id) => got.push(id));
    const stranger = hub.join();
    await flush();
    stranger.send('hello', { name: 42 }, ht.selfId);
    stranger.send('hello', null, ht.selfId);
    stranger.send('input', { seq: 1, state: neutralInput() }, ht.selfId);
    await flush();
    expect(got).toEqual([]);
    expect(host.roster.list()).toHaveLength(1);
  });

  it('identifies the host by welcome when other clients are present', async () => {
    const hub = createLocalHub();
    const ht = hub.join();
    const host = createHost(ht, prof('Host'));
    const c1 = createClient(hub.join(), prof('Eins'));
    const c2 = createClient(hub.join(), prof('Zwei'));
    await flush();
    expect(c1.hostId).toBe(ht.selfId);
    expect(c2.hostId).toBe(ht.selfId);
    expect(host.roster.list().map((p) => p.name)).toEqual(['Host', 'Eins', 'Zwei']);
  });

  it('rejects new players while running', async () => {
    const hub = createLocalHub();
    const host = createHost(hub.join(), prof('Host'));
    host.setPhase('round');
    const client = createClient(hub.join(), prof('Spaet'));
    const reasons: RejectReason[] = [];
    client.onRejected((r) => reasons.push(r));
    await flush();
    expect(reasons).toEqual(['running']);
  });

  it('delivers phases and snapshots to the client', async () => {
    const hub = createLocalHub();
    const host = createHost(hub.join(), prof('Host'));
    const client = createClient(hub.join(), prof('Gast'));
    const phases: string[] = [];
    const snaps: Array<[number, string, unknown]> = [];
    client.onPhase((p) => phases.push(p.phase));
    client.onSnapshot((s) => snaps.push([s.tick, s.phase, s.payload]));
    await flush();
    host.setPhase('intro');
    host.broadcast('intro', { x: 1 });
    host.broadcast('intro', { x: 2 });
    await flush();
    expect(phases).toEqual(['intro']);
    expect(snaps).toEqual([[1, 'intro', { x: 1 }], [2, 'intro', { x: 2 }]]);
  });

  it('fires onHostLost only when the host leaves', async () => {
    const hub = createLocalHub();
    const ht = hub.join();
    createHost(ht, prof('Host'));
    const c1 = createClient(hub.join(), prof('Eins'));
    const ot = hub.join();
    createClient(ot, prof('Zwei'));
    let lost = 0;
    c1.onHostLost(() => lost++);
    await flush();
    ot.leave();
    await flush();
    expect(lost).toBe(0);
    ht.leave();
    await flush();
    expect(lost).toBe(1);
  });

  it('keeps a disconnected player slot while running and lets it be reclaimed', async () => {
    const hub = createLocalHub();
    const host = createHost(hub.join(), prof('Host'));
    const t1 = hub.join();
    createClient(t1, prof('Gast'));
    await flush();
    host.setPhase('round');
    t1.leave();
    await flush();
    expect(host.roster.list()[1]).toMatchObject({ name: 'Gast', connected: false });
    const t2 = hub.join();
    const again = createClient(t2, prof('Gast'));
    await flush();
    expect(again.playerId).toBe(t2.selfId);
    expect(host.roster.list()[1]).toMatchObject({ id: t2.selfId, slot: 1, connected: true });
  });

  it('frees a lobby slot immediately when a client leaves', async () => {
    const hub = createLocalHub();
    const host = createHost(hub.join(), prof('Host'));
    const t1 = hub.join();
    createClient(t1, prof('Gast'));
    await flush();
    expect(host.roster.list()).toHaveLength(2);
    t1.leave();
    await flush();
    expect(host.roster.list().map((p) => p.name)).toEqual(['Host']);
  });

  it('resetForLobby purges disconnected players, resets ready (bots stay ready) and announces the lobby', async () => {
    const hub = createLocalHub();
    const ht = hub.join();
    const host = createHost(ht, prof('Host'));
    const bot = host.addLocalPlayer('Bot Mo', prof('x').look, { isBot: true })!;
    host.setLocalReady(bot.id, true);
    host.setLocalReady(ht.selfId, true);
    const t1 = hub.join();
    const c1 = createClient(t1, prof('Eins'));
    const t2 = hub.join();
    createClient(t2, prof('Zwei'));
    await flush();
    c1.setReady(true);
    await flush();
    host.setPhase('podium');
    t2.leave();
    await flush();
    const phases: Array<[string, unknown]> = [];
    c1.onPhase((p) => phases.push([p.phase, p.data]));
    host.resetForLobby({ kind: 'lobby' });
    await flush();
    expect(host.phase).toBe('lobby');
    expect(phases).toEqual([['lobby', { kind: 'lobby' }]]);
    expect(host.roster.list().map((p) => [p.name, p.ready])).toEqual([
      ['Host', false],
      ['Bot Mo', true],
      ['Eins', false],
    ]);
    expect(c1.roster.map((p) => p.name)).toEqual(['Host', 'Bot Mo', 'Eins']);
    expect(c1.roster.every((p) => p.isBot || !p.ready)).toBe(true);
  });

  it('supports local bot players with local input', () => {
    const hub = createLocalHub();
    const ht = hub.join();
    const host = createHost(ht, prof('Host'));
    const bot = host.addLocalPlayer('Bot 1', prof('x').look, { isBot: true });
    expect(bot).toMatchObject({ slot: 1, isBot: true, connected: true });
    if (!bot) throw new Error('bot not added');
    const got: string[] = [];
    host.onInput((id) => got.push(id));
    const s = { ...neutralInput(), up: true };
    host.setLocalInput(bot.id, s);
    host.setLocalInput(ht.selfId, s);
    expect(got).toEqual([bot.id, ht.selfId]);
    expect(host.input(bot.id)).toEqual(s);
  });
});

describe('startHostTicker', () => {
  it('constructs a module worker for tickWorker.ts and forwards ticks as seconds', () => {
    const made: FakeWorker[] = [];
    class FakeWorker implements TickWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      posted: unknown[] = [];
      terminated = false;
      constructor(public url: URL | string, public opts?: WorkerOptions) {
        made.push(this);
      }
      postMessage(m: unknown): void {
        this.posted.push(m);
      }
      terminate(): void {
        this.terminated = true;
      }
    }
    const dts: number[] = [];
    const stop = startHostTicker(30, (dt) => dts.push(dt), FakeWorker);
    expect(made).toHaveLength(1);
    const w = made[0];
    expect(String(w.url)).toMatch(/tickWorker\.ts$/);
    expect(w.opts).toEqual({ type: 'module' });
    expect(w.posted).toEqual([{ hz: 30 }]);
    w.onmessage?.({ data: 0 } as MessageEvent);
    expect(dts).toHaveLength(1);
    expect(dts[0]).toBeGreaterThanOrEqual(0);
    expect(dts[0]).toBeLessThanOrEqual(0.25);
    stop();
    expect(w.terminated).toBe(true);
  });
});

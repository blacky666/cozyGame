import { describe, expect, it } from 'vitest';
import type { EveningPhase } from '../flow/evening';
import { mulberry32 } from '../flow/rng';
import { neutralInput, type InputState } from '../net/protocol';
import { createClient, createHost, type HostSession } from '../net/session';
import { createLocalHub } from '../net/transport';
import { createSandboxHost, type SandboxState } from '../minigames/sandbox/sandboxHost';
import type { GamePlayer, MiniGame } from '../minigames/types';
import { defaultProfile } from '../save/profile';
import { EveningHost } from './eveningHost';

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
};
const prof = (name: string) => defaultProfile(name);
const right: InputState = { ...neutralInput(), right: true };

const seen: GamePlayer[][] = [];

/** Headless test game: the sandbox host without a Phaser view. */
const game: MiniGame<SandboxState> = {
  id: 'muenzjagd',
  title: 'T',
  rule: 'R',
  controls: 'C',
  durationMs: 2000,
  createHost: (players, rand, o) => {
    seen.push(players);
    return createSandboxHost(players, rand, o?.durationMs ?? 2000);
  },
  createView: () => {
    throw new Error('no view in tests');
  },
  botView: (s, k) => (s.players[k] ? { self: s.players[k], targets: [] } : null),
};

function setup(games: MiniGame[] = [game as MiniGame]) {
  const hub = createLocalHub();
  const ht = hub.join();
  const session = createHost(ht, prof('Host'));
  let stopped = 0;
  let ticker: ((dt: number) => void) | null = null;
  let clock = 1000;
  const local: InputState[] = [];
  const phases: EveningPhase[] = [];
  const evening = new EveningHost({
    session,
    rounds: 5,
    games,
    rand: mulberry32(1),
    localInput: () => local[0] ?? neutralInput(),
    timing: { introMs: 1000, standingsMs: 1000, durationScale: 1 },
    now: () => clock,
    startTicker: (_hz, cb) => {
      ticker = cb;
      return () => void stopped++;
    },
    onPhase: (p) => phases.push(p),
  });
  const tick = (sec: number) => {
    for (let t = 0; t < sec; t += 0.05) ticker?.(0.05);
  };
  return { hub, ht, session, evening, phases, local, tick, now: () => clock, stopped: () => stopped };
}

describe('EveningHost', () => {
  it('passes the game feats into the standings XP lines', async () => {
    const featGame: MiniGame<SandboxState> = {
      ...game,
      id: 'featjagd',
      createHost: (players, rand, o) => ({
        ...createSandboxHost(players, rand, o?.durationMs ?? 2000),
        feats: () => ({ p0: ['schubser'] }),
      }),
    };
    const s = setup([featGame as MiniGame]);
    createClient(s.hub.join(), prof('Gast'));
    await flush();
    const sent: Array<[string, unknown]> = [];
    const orig = s.session.setPhase.bind(s.session);
    s.session.setPhase = (kind: string, data?: unknown) => {
      sent.push([kind, data]);
      orig(kind as never, data as never);
    };
    s.evening.start();
    for (let i = 0; i < 10 && s.evening.phase.kind !== 'standings'; i++) s.tick(1);
    const st = sent.find(([k]) => k === 'standings')?.[1] as Extract<EveningPhase, { kind: 'standings' }>;
    expect(st.xp.p0).toContainEqual({ kind: 'erfolg', round: 1, feat: 'schubser', xp: 5 });
    expect(st.xp.p1.some((l) => l.kind === 'erfolg')).toBe(false);
    expect(typeof st.eveningId).toBe('string');
  });


  it('start with fewer than 2 connected players throws and leaves the session recoverable', () => {
    const s = setup();
    expect(() => s.evening.start()).toThrow();
    expect(s.phases).toEqual([]);
    expect(s.evening.phase.kind).toBe('lobby');
    s.session.setPhase('starting'); // what startEvening does before loading
    s.session.resetForLobby({ kind: 'lobby' });
    expect(s.session.phase).toBe('lobby');
    expect(s.stopped()).toBe(0);
  });

  it('runs a full evening keyed by player slots and broadcasts every phase', async () => {
    const s = setup();
    const ct = s.hub.join();
    const client = createClient(ct, prof('Gast'));
    const got: string[] = [];
    client.onPhase((p) => got.push(p.phase));
    await flush();

    s.evening.start();
    expect(s.phases[0]).toMatchObject({ kind: 'intro', round: 1, game: 'muenzjagd', double: false });
    s.tick(1.1);
    expect(s.evening.phase.kind).toBe('playing');

    // Client input arrives by peer id and moves the slot-1 player.
    const x0 = (s.evening.latest as SandboxState).players.p1.x;
    client.sendInput(right);
    s.local[0] = right; // host's own keyboard -> p0
    await flush();
    s.tick(0.5);
    const st = s.evening.latest as SandboxState;
    expect(st.players.p1.x).toBeGreaterThan(x0 + 20);
    expect(st.players.p0.dir).toBe('side');

    for (let i = 0; i < 40 && s.evening.phase.kind !== 'podium'; i++) s.tick(1);
    expect(s.evening.phase.kind).toBe('podium');
    const kinds = s.phases.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'standings')).toHaveLength(4);
    expect(s.phases.find((p) => p.kind === 'intro' && p.round === 5)).toMatchObject({ double: true });
    const podium = s.evening.phase as Extract<EveningPhase, { kind: 'podium' }>;
    expect(Object.keys(podium.totals).sort()).toEqual(['p0', 'p1']);

    await flush();
    expect(got.slice(0, 3)).toEqual(['intro', 'playing', 'standings']);
    expect(got.at(-1)).toBe('podium');

    s.evening.backToLobby();
    await flush();
    expect(s.stopped()).toBe(1);
    expect(s.session.phase).toBe('lobby');
    expect(got.at(-1)).toBe('lobby');
  });

  it('keeps slot and score across a reconnect and re-sends the current phase', async () => {
    const s = setup();
    const t1 = s.hub.join();
    createClient(t1, prof('Gast'));
    await flush();
    s.evening.start();
    s.tick(1.1); // playing round 1
    t1.leave();
    await flush();
    s.tick(0.5);
    const t2 = s.hub.join();
    const again = createClient(t2, prof('Gast'));
    const got: Array<{ phase: string; data?: unknown }> = [];
    again.onPhase((p) => got.push(p));
    await flush();
    expect(s.session.roster.list()[1]).toMatchObject({ id: t2.selfId, slot: 1, connected: true });
    expect(got.at(-1)).toMatchObject({ phase: 'playing', data: { kind: 'playing', round: 1 } });

    again.sendInput(right);
    await flush();
    const before = (s.evening.latest as SandboxState).players.p1.x;
    s.tick(0.5);
    expect((s.evening.latest as SandboxState).players.p1.x).toBeGreaterThan(before + 20);
  });

  it('unsubscribes from the roster on stop/backToLobby (no stale listener per "Nochmal?")', () => {
    const hub = createLocalHub();
    const session = createHost(hub.join(), prof('Host'));
    session.addLocalPlayer('Bot Mo', prof('x').look, { isBot: true });
    let live = 0;
    const spy: HostSession = Object.create(session, {
      onRoster: {
        value: (cb: Parameters<HostSession['onRoster']>[0]) => {
          live++;
          const off = session.onRoster(cb);
          return () => {
            live--;
            off();
          };
        },
      },
    });
    for (let i = 0; i < 3; i++) {
      const ev = new EveningHost({
        session: spy, rounds: 5, games: [game as MiniGame], localInput: () => neutralInput(),
        startTicker: () => () => {},
      });
      ev.start();
      expect(live).toBe(1);
      ev.backToLobby();
      expect(live).toBe(0);
    }
  });

  it('hands GamePlayers with remote flags to the game and stamps snapshots with tick time', async () => {
    const s = setup();
    createClient(s.hub.join(), prof('Gast'));
    const bot = s.session.addLocalPlayer('Bot Mo', prof('x').look, { isBot: true })!;
    s.evening.addBot(bot.id, () => right);
    await flush();
    seen.length = 0;
    s.evening.start();
    s.tick(1.1);
    expect(seen).toHaveLength(1);
    expect(seen[0].map((p) => [p.key, p.slot, p.name, p.remote])).toEqual([
      ['p0', 0, 'Host', false],
      ['p1', 1, 'Bot Mo', false], // local bot joins before the peer's join arrives
      ['p2', 2, 'Gast', true],
    ]);
    expect(seen[0][2].look).toEqual(prof('Gast').look);
    const t0 = s.evening.latestTick;
    s.tick(0.1);
    expect(s.evening.latestTick).toBe(t0 + 2);
    expect(s.evening.latestAt).toBe(s.now());
  });

  it('drives dev bots through the game bot view', async () => {
    const s = setup();
    const bot = s.session.addLocalPlayer('Bot Mo', prof('x').look, { isBot: true })!;
    const seen: string[] = [];
    s.evening.addBot(bot.id, (v) => {
      seen.push(`${v.self.x}`);
      return right;
    });
    s.evening.start();
    s.tick(1.1);
    const x0 = (s.evening.latest as SandboxState).players.p1.x;
    s.tick(0.5);
    expect(seen.length).toBeGreaterThan(0);
    expect((s.evening.latest as SandboxState).players.p1.x).toBeGreaterThan(x0 + 20);
  });

  it('broadcasts minigame snapshots tagged with the round at the snapshot rate', async () => {
    const s = setup();
    const ct = s.hub.join();
    const client = createClient(ct, prof('Gast'));
    const snaps: unknown[] = [];
    client.onSnapshot((sn) => snaps.push(sn.payload));
    await flush();
    s.evening.start();
    s.tick(1.1);
    snaps.length = 0;
    await flush();
    snaps.length = 0;
    s.tick(1); // 20 ticks of 50 ms at 20 Hz snapshot rate
    await flush();
    expect(snaps.length).toBeGreaterThanOrEqual(19);
    expect(snaps.length).toBeLessThanOrEqual(21);
    expect(snaps[0]).toMatchObject({ round: 1 });
  });

  it('snapshots carry the last processed input seq per player key', async () => {
    const s = setup();
    const ct = s.hub.join();
    const client = createClient(ct, prof('Gast'));
    const snaps: Array<{ acks?: Record<string, number> }> = [];
    client.onSnapshot((sn) => snaps.push(sn.payload as { acks?: Record<string, number> }));
    await flush();
    s.evening.start();
    s.tick(1.1);
    client.sendInput(right);
    client.sendInput(right);
    await flush();
    snaps.length = 0;
    s.tick(0.2);
    await flush();
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.at(-1)?.acks).toEqual({ p0: 0, p1: 2 });
  });

  it('passes the evening leader to createHost', async () => {
    const leaders: (string[] | undefined)[] = [];
    const winP0: MiniGame = {
      ...(game as MiniGame),
      createHost: (players, rand, o) => {
        leaders.push(o?.leaders);
        const h = createSandboxHost(players, rand, 2000);
        return { tick: (dt, i) => h.tick(dt, i), snapshot: () => h.snapshot(), result: () => [['p0'], ['p1']] };
      },
    };
    const s = setup([winP0]);
    createClient(s.hub.join(), prof('Gast'));
    await flush();
    s.evening.start();
    s.tick(1.1); // intro -> round 1 playing (result is immediate)
    s.tick(1.1); // standings -> intro
    s.tick(1.1); // intro -> round 2 playing
    expect(leaders[0]).toEqual([]);
    expect(leaders[1]).toEqual(['p0']);
  });
});

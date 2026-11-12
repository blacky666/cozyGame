import { describe, expect, it } from 'vitest';
import { CARD_IDS, type CardId, type RoundCard } from '../flow/cards';
import type { EveningPhase } from '../flow/evening';
import { mulberry32 } from '../flow/rng';
import { neutralInput, type InputState } from '../net/protocol';
import { createClient, createHost, type HostSession } from '../net/session';
import { createLocalHub } from '../net/transport';
import { createSandboxHost, type SandboxState } from '../minigames/sandbox/sandboxHost';
import type { GamePlayer, MiniGame } from '../minigames/types';
import { defaultProfile } from '../save/profile';
import { EveningHost, type EveningHostOptions, type SnapPayload } from './eveningHost';

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

function setup(games: MiniGame[] = [game as MiniGame], extra: Partial<EveningHostOptions> = {}) {
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
    timing: { introMs: 1000, standingsMs: 1000, durationScale: 1, cardPickMs: 2000, botPickMs: 300, revealMs: 500 },
    now: () => clock,
    startTicker: (_hz, cb) => {
      ticker = cb;
      return () => void stopped++;
    },
    onPhase: (p) => phases.push(p),
    ...extra,
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

  it('broadcasts emotes in the snap payload and clears them when the next game starts', async () => {
    const s = setup();
    const client = createClient(s.hub.join(), prof('Gast'));
    const snaps: SnapPayload[] = [];
    client.onSnapshot((sn) => snaps.push(sn.payload as SnapPayload));
    await flush();
    s.evening.start();
    s.tick(1.1); // intro -> playing
    expect(s.evening.phase.kind).toBe('playing');
    s.local[0] = { ...neutralInput(), emotes: 0, emote: 0 };
    s.tick(1.4); // baseline, most of the round
    s.local[0] = { ...neutralInput(), emotes: 1, emote: 1 };
    s.tick(0.1);
    expect(s.evening.latestEmotes).toMatchObject([{ key: 'p0', id: 'winken', n: 1 }]);
    await flush();
    expect(snaps.at(-1)?.emotes).toMatchObject([{ key: 'p0', id: 'winken' }]);
    for (let i = 0; i < 200 && !(s.evening.phase.kind === 'playing' && s.evening.phase.round === 2); i++) s.tick(0.05);
    expect(s.evening.phase).toMatchObject({ kind: 'playing', round: 2 });
    expect(s.evening.latestEmotes).toEqual([]);
    await flush();
    snaps.length = 0;
    s.tick(0.1);
    await flush();
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.every((p) => p.round === 2 && p.emotes.length === 0)).toBe(true);
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
    s.tick(1.1); // standings -> cards (p1 last)
    s.tick(2.1); // no pick: random card -> reveal
    s.tick(0.6); // reveal -> intro
    s.tick(1.1); // intro -> round 2 playing
    expect(leaders[0]).toEqual([]);
    expect(leaders[1]).toEqual(['p0']);
  });
});

describe('EveningHost cards', () => {
  /** p0 always wins at once, so p1 (or the last slot) is the chooser after round 1. */
  const cardsSetup = async (opts: { bot?: boolean } = {}) => {
    const cards: (RoundCard | null | undefined)[] = [];
    const winP0: MiniGame = {
      ...(game as MiniGame),
      createHost: (players, rand, o) => {
        cards.push(o?.card);
        const h = createSandboxHost(players, rand, 2000);
        return { tick: (dt, i) => h.tick(dt, i), snapshot: () => h.snapshot(), result: () => [['p0'], ['p1']] };
      },
    };
    const s = setup([winP0]);
    let client: ReturnType<typeof createClient> | null = null;
    let ct: ReturnType<typeof s.hub.join> | null = null;
    if (opts.bot) {
      const bot = s.session.addLocalPlayer('Bot Mo', prof('x').look, { isBot: true })!;
      s.evening.addBot(bot.id, () => neutralInput());
    } else {
      ct = s.hub.join();
      client = createClient(ct, prof('Gast'));
    }
    await flush();
    const sent: Array<[string, unknown]> = [];
    const orig = s.session.setPhase.bind(s.session);
    s.session.setPhase = (kind: string, data?: unknown) => {
      sent.push([kind, data]);
      orig(kind as never, data as never);
    };
    s.evening.start();
    s.tick(1.1); // intro -> playing round 1 (result at once) -> standings
    s.tick(1.0); // standings -> cards
    return { ...s, cards, sent, client, ct };
  };
  const phaseOf = (s: { evening: EveningHost }) => s.evening.phase;

  it('the chooser picks a card; wrong picks are refused; the reveal follows on the next tick', async () => {
    const s = await cardsSetup();
    const ph = phaseOf(s);
    if (ph.kind !== 'cards') throw new Error(`expected cards, got ${ph.kind}`);
    expect(ph).toMatchObject({ chooser: 'p1', victim: 'p0' });
    expect(s.sent.some(([k]) => k === 'cards')).toBe(true);
    const notOffered = CARD_IDS.find((id) => !ph.offer.includes(id))!;
    expect(s.evening.pickCard('p0', ph.offer[0])).toBe(false);
    expect(s.evening.pickCard('p1', notOffered)).toBe(false);
    expect(s.evening.pickCard('p1', 'quatsch')).toBe(false);
    expect(s.evening.pickCard('p1', ph.offer[1])).toBe(true);
    expect(s.evening.pickCard('p1', ph.offer[0])).toBe(false);
    expect(phaseOf(s).kind).toBe('cards');
    s.tick(0.05);
    expect(phaseOf(s)).toMatchObject({ kind: 'reveal', card: ph.offer[1], random: false, chooser: 'p1', victim: 'p0' });
    expect(s.evening.pickCard('p1', ph.offer[0])).toBe(false);
    s.tick(0.3);
    expect(phaseOf(s).kind).toBe('reveal');
    s.tick(0.3);
    const card = { id: ph.offer[1], chooser: 'p1', victim: 'p0' };
    expect(phaseOf(s)).toMatchObject({ kind: 'intro', round: 2, card });
    s.tick(1.1);
    expect(phaseOf(s)).toMatchObject({ kind: 'standings', round: 2 });
    expect(s.cards).toEqual([null, card]);
  });

  it('no pick within cardPickMs gives a random card', async () => {
    const s = await cardsSetup();
    s.tick(1.9);
    expect(phaseOf(s).kind).toBe('cards');
    s.tick(0.15);
    expect(phaseOf(s)).toMatchObject({ kind: 'reveal', random: true });
  });

  it('a bot chooser picks after botPickMs', async () => {
    const s = await cardsSetup({ bot: true });
    expect(phaseOf(s)).toMatchObject({ kind: 'cards', chooser: 'p1' });
    s.tick(0.2);
    expect(phaseOf(s).kind).toBe('cards');
    s.tick(0.15);
    expect(phaseOf(s)).toMatchObject({ kind: 'reveal', random: false });
  });

  it('a disconnected chooser gets a random card after botPickMs', async () => {
    const s = await cardsSetup();
    expect(phaseOf(s).kind).toBe('cards');
    s.ct!.leave();
    await flush();
    s.tick(0.35);
    expect(phaseOf(s)).toMatchObject({ kind: 'reveal', random: true });
  });
});

describe('EveningHost pranks', () => {
  type Log = { round: number; inputs: Record<string, InputState> }[];
  /**
   * Fake game: records the (masked) inputs it gets, exposes prankBodies (p0 at x 100, p1 at 150, …),
   * ends with `order` after runMs(round).
   */
  const prankSetup = async (o: { order: string[][]; runMs: (round: number) => number; bots?: number; forceCard?: CardId }) => {
    const log: Log = [];
    let rounds = 0;
    const fake: MiniGame = {
      ...(game as MiniGame),
      botView: () => ({ self: { x: 0, y: 0 }, targets: [] }),
      createHost: (players) => {
        const round = ++rounds;
        let elapsed = 0;
        return {
          tick(dt, inputs) {
            elapsed += dt * 1000;
            log.push({ round, inputs: structuredClone(inputs) });
          },
          snapshot: () => ({}),
          result: () => (elapsed >= o.runMs(round) ? o.order : null),
          prankBodies: () => players.map((p, i) => ({ key: p.key, x: 100 + 50 * i, y: 100, affectable: true, out: false })),
        };
      },
    };
    const s = setup([fake], { forceCard: o.forceCard });
    const botUp = { ...neutralInput(), up: true };
    for (let i = 0; i < (o.bots ?? 1); i++) {
      const bot = s.session.addLocalPlayer('Bot ' + i, prof('x').look, { isBot: true })!;
      s.evening.addBot(bot.id, () => botUp);
    }
    await flush();
    const snaps: SnapPayload[] = [];
    const sent: Array<[string, unknown]> = [];
    const origB = s.session.broadcast.bind(s.session);
    s.session.broadcast = ((kind: string, data: unknown) => {
      if (kind === 'playing') snaps.push(data as SnapPayload);
      origB(kind as never, data as never);
    }) as typeof s.session.broadcast;
    const origP = s.session.setPhase.bind(s.session);
    s.session.setPhase = (kind: string, data?: unknown) => {
      sent.push([kind, data]);
      origP(kind as never, data as never);
    };
    const until = (kind: string, round: number) => {
      for (let i = 0; i < 400 && !(s.evening.phase.kind === kind && 'round' in s.evening.phase && s.evening.phase.round === round); i++) s.tick(0.05);
      expect(s.evening.phase).toMatchObject({ kind, round });
    };
    return { ...s, log, snaps, sent, until };
  };

  it('card falle freezes the victim for falleMs at the input layer; others move', async () => {
    // p1 wins round 1 -> victim p1, chooser p0 (host: timeout -> the forced card).
    const s = await prankSetup({ order: [['p1'], ['p0']], runMs: (r) => (r === 1 ? 0 : 5000), forceCard: 'falle' });
    s.local[0] = { ...neutralInput(), up: true };
    s.evening.start();
    s.until('playing', 2);
    expect(s.evening.phase).toMatchObject({ card: { id: 'falle', victim: 'p1', chooser: 'p0' } });
    expect(s.evening.latestPranks.fx).toMatchObject([{ key: 'p1', kind: 'frozen' }]);
    s.tick(4);
    const r2 = s.log.filter((e) => e.round === 2);
    expect(r2.length).toBeGreaterThan(70);
    for (const e of r2.slice(0, 55)) expect([e.inputs.p0.up, e.inputs.p1.up]).toEqual([true, false]);
    for (const e of r2.slice(62)) expect([e.inputs.p0.up, e.inputs.p1.up]).toEqual([true, true]);
    const first = s.snaps.find((p) => p.round === 2)!;
    expect(first.pranks.fx).toMatchObject([{ key: 'p1', kind: 'frozen' }]);
  });

  it('card doppelter_streich gives the chooser two uses', async () => {
    const s = await prankSetup({
      order: [['p1'], ['p0'], ['p2']], runMs: (r) => (r === 1 ? 0 : 5000), bots: 2, forceCard: 'doppelter_streich',
    });
    s.evening.start();
    s.until('playing', 2);
    expect(s.evening.phase).toMatchObject({ card: { id: 'doppelter_streich', chooser: 'p2' } });
    s.tick(0.2);
    expect(s.evening.latestPranks.left).toEqual({ p0: 1, p1: 1, p2: 2 });
  });

  it('a landed prank gives streich_gelandet; snapshots carry pranks; a new round has fresh uses', async () => {
    const s = await prankSetup({ order: [['p0'], ['p1']], runMs: () => 1500 });
    s.session.setLocalProfile(s.session.selfId, { ...prof('Host').look, prank: 'furzkissen' }, 1, 0);
    await flush();
    s.evening.start();
    s.until('playing', 1);
    expect(s.evening.latestPranks.left).toEqual({ p0: 1, p1: 1 });
    s.local[0] = { ...neutralInput(), aimX: 150, aimY: 100, pranks: 0 };
    s.tick(0.2);
    s.local[0] = { ...neutralInput(), aimX: 150, aimY: 100, pranks: 1 };
    s.tick(0.1);
    expect(s.evening.latestPranks).toMatchObject({ left: { p0: 0 }, fx: [{ key: 'p1', kind: 'stumble' }] });
    // Stumbling p1 sends up but the game sees nothing.
    expect(s.log.at(-1)!.inputs.p1.up).toBe(false);
    s.until('standings', 1);
    const st = s.sent.find(([k]) => k === 'standings')?.[1] as Extract<EveningPhase, { kind: 'standings' }>;
    expect(st.xp.p0).toContainEqual({ kind: 'erfolg', round: 1, feat: 'streich_gelandet', xp: 5 });
    expect(s.evening.latestPranks).toEqual({ fx: [], bananas: [], left: {}, cues: [] });
    s.until('playing', 2);
    s.tick(0.2);
    expect(s.evening.latestPranks.left.p0).toBe(1);
    expect(s.snaps.length).toBeGreaterThan(5);
    expect(s.snaps.every((p) => p.pranks && Array.isArray(p.pranks.fx))).toBe(true);
  });
});

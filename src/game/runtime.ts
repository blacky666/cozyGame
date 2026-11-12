import { CONFIG } from '../config';
import { createBotInputs } from '../dev/bots';
import { devFlags } from '../dev/devFlags';
import type { ClientSession, HostSession } from '../net/session';
import { MINIGAMES } from '../minigames/registry';
import { createEveningProgress } from '../progress/eveningProgress';
import { loadProfile, saveProfile } from '../save/storage';
import { playerKey, type PlayerKey } from '../minigames/types';
import { DEFAULT_TIMING, EveningHost, type EveningTiming } from './eveningHost';
import type { AssetFile } from '../gfx/assetTypes';
import { createKeyboard } from './keyboard';
import { createPlayerCache } from './playerCache';
import { Stage } from './phaserGame';
import { PointerInput } from './pointer';
import type { StageTiming } from './stageCtx';

/*
 * Lazy-loaded (with Phaser) when an evening starts; the default route's first bundle stays lean.
 */

function timings(): { host: EveningTiming; stage: StageTiming } {
  const scale = devFlags(location.search).timeScale;
  const stage: StageTiming = {
    ruleMs: CONFIG.intro.ruleMs * scale,
    countdownMs: CONFIG.intro.countdownMs * scale,
    standingsMs: CONFIG.standings.showMs * scale,
    cardPickMs: CONFIG.gemeinheit.pickMs * scale,
    revealMs: CONFIG.gemeinheit.revealMs * scale,
  };
  const host: EveningTiming = {
    introMs: stage.ruleMs + stage.countdownMs,
    standingsMs: stage.standingsMs,
    durationScale: DEFAULT_TIMING.durationScale * scale,
    cardPickMs: stage.cardPickMs,
    botPickMs: CONFIG.gemeinheit.botPickMs * scale,
    revealMs: stage.revealMs,
  };
  return { host, stage };
}

/** The lobby's game choice (all when empty or unknown); the dev flag `game=<id>` overrides it. */
const eveningGames = (chosen: readonly string[]) => {
  const only = devFlags(location.search).game;
  const dev = MINIGAMES.filter((g) => g.id === only);
  if (dev.length > 0) return dev;
  const picked = MINIGAMES.filter((g) => chosen.includes(g.id));
  return picked.length > 0 ? picked : MINIGAMES;
};

const keyFor = (players: { id: string; slot: 0 | 1 | 2 | 3 }[], id: string | null): PlayerKey => {
  const p = players.find((x) => x.id === id);
  return p ? playerKey(p.slot) : 'p?';
};

/**
 * Host: run the evening (simulation + own stage). `assets` are the menus' loaded asset files (the
 * games' host simulations build their arenas from them). `onLobby` fires after "Nochmal?".
 */
export function runHostEvening(
  session: HostSession,
  rounds: number,
  assets: Record<string, AssetFile>,
  onLobby: () => void,
  games: readonly string[] = [],
): void {
  const keyboard = createKeyboard();
  // Written by MinigameScene, read here every tick: the host's own player throws like a client.
  const pointer = new PointerInput();
  const t = timings();
  let stage: Stage | null = null;
  const host = new EveningHost({
    session,
    rounds,
    games: eveningGames(games),
    localInput: () => pointer.merge(keyboard.state()),
    assets,
    timing: t.host,
    onPhase: (p) => stage?.setPhase(p),
    forceCard: devFlags(location.search).card ?? undefined,
  });
  // The chooser's card message; the host checks phase, chooser and offer. Ends with the evening (playAgain).
  const offCard = session.onCard((id, card) => host.pickCard(keyFor(session.roster.list(), id), card));
  for (const p of session.roster.list()) {
    if (p.isBot) host.addBot(p.id, createBotInputs(1 + p.slot * 7919, p.look.emotes.flatMap((e, i) => (e ? [i + 1] : []))));
  }
  const selfKey = () => keyFor(session.roster.list(), session.selfId);
  stage = new Stage({
    isHost: true,
    players: createPlayerCache(() => session.roster.list()),
    selfKey,
    keyboard,
    pointer,
    timing: t.stage,
    progress: createEveningProgress({ selfKey, load: () => loadProfile(), save: (p) => saveProfile(p) }),
    pickCard: (card) => void host.pickCard(selfKey(), card),
    hostSnapshot: () =>
      host.phase.kind === 'playing'
        ? { round: host.phase.round, state: host.latest, acks: {}, emotes: host.latestEmotes, pranks: host.latestPranks, tick: host.latestTick, at: host.latestAt }
        : null,
    playAgain: () => {
      offCard();
      host.backToLobby();
      stage?.destroy();
      onLobby();
    },
    backToStart: () => {},
  });
  try {
    host.start();
  } catch (e) {
    // e.g. too few connected players: do not leave a stage or host behind.
    offCard();
    host.stop();
    stage.destroy();
    throw e;
  }
}

/** Client: render phases from the host. Returns the stage (driven by startEvening.ts). */
export function runClientEvening(session: ClientSession, backToStart: () => void): Stage {
  const pointer = new PointerInput();
  // Focus lost / tab hidden: send released keys at once (the host also expires stale input); counters stay.
  const keyboard = createKeyboard({
    onIdle: () => {
      pointer.releaseAll();
      session.sendInput(pointer.merge(keyboard.state()));
    },
  });
  const selfKey = () => keyFor(session.roster, session.playerId);
  const stage: Stage = new Stage({
    isHost: false,
    players: createPlayerCache(() => session.roster),
    selfKey,
    keyboard,
    pointer,
    timing: timings().stage,
    progress: createEveningProgress({ selfKey, load: () => loadProfile(), save: (p) => saveProfile(p) }),
    sendInput: (s) => session.sendInput(s),
    pickCard: (card) => session.sendCard(card),
    backToStart: () => {
      stage.destroy();
      backToStart();
    },
  });
  return stage;
}

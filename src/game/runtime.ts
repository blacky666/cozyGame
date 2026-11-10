import { CONFIG } from '../config';
import { createBotInputs } from '../dev/bots';
import { devFlags } from '../dev/devFlags';
import type { ClientSession, HostSession } from '../net/session';
import { MINIGAMES } from '../minigames/registry';
import { playerKey, type PlayerKey } from '../minigames/types';
import { DEFAULT_TIMING, EveningHost, type EveningTiming } from './eveningHost';
import { createKeyboard } from './keyboard';
import { createPlayerCache } from './playerCache';
import { neutralInput } from '../net/protocol';
import { Stage } from './phaserGame';
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
  };
  const host: EveningTiming = {
    introMs: stage.ruleMs + stage.countdownMs,
    standingsMs: stage.standingsMs,
    durationScale: DEFAULT_TIMING.durationScale * scale,
  };
  return { host, stage };
}

const keyFor = (players: { id: string; slot: 0 | 1 | 2 | 3 }[], id: string | null): PlayerKey => {
  const p = players.find((x) => x.id === id);
  return p ? playerKey(p.slot) : 'p?';
};

/** Host: run the evening (simulation + own stage). `onLobby` fires after "Nochmal?". */
export function runHostEvening(session: HostSession, rounds: number, onLobby: () => void): void {
  const keyboard = createKeyboard();
  const t = timings();
  let stage: Stage | null = null;
  const host = new EveningHost({
    session,
    rounds,
    games: MINIGAMES,
    localInput: () => keyboard.state(),
    timing: t.host,
    onPhase: (p) => stage?.setPhase(p),
  });
  for (const p of session.roster.list()) {
    if (p.isBot) host.addBot(p.id, createBotInputs(1 + p.slot * 7919));
  }
  stage = new Stage({
    isHost: true,
    players: createPlayerCache(() => session.roster.list()),
    selfKey: () => keyFor(session.roster.list(), session.selfId),
    keyboard,
    timing: t.stage,
    hostSnapshot: () => (host.phase.kind === 'playing' ? { round: host.phase.round, state: host.latest } : null),
    playAgain: () => {
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
    host.stop();
    stage.destroy();
    throw e;
  }
}

/** Client: render phases from the host. Returns the stage (driven by startEvening.ts). */
export function runClientEvening(session: ClientSession, backToStart: () => void): Stage {
  const stage: Stage = new Stage({
    isHost: false,
    players: createPlayerCache(() => session.roster),
    selfKey: () => keyFor(session.roster, session.playerId),
    // Focus lost / tab hidden: stop our player at once (the host also expires stale input).
    keyboard: createKeyboard({ onIdle: () => session.sendInput(neutralInput()) }),
    timing: timings().stage,
    sendInput: (s) => session.sendInput(s),
    backToStart: () => {
      stage.destroy();
      backToStart();
    },
  });
  return stage;
}

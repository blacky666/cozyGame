import { CONFIG } from '../config';
import type { AssetFile } from '../gfx/assetTypes';
import { loadAssets } from '../gfx/textures';
import { generateRoomCode, normalizeRoomCode } from '../net/roomCode';
import type { PlayerInfo } from '../net/roster';
import { createClient, createHost } from '../net/session';
import type { Transport } from '../net/transport';
import { joinTrysteroRoom } from '../net/trysteroTransport';
import type { RejectReason } from '../net/protocol';
import { loadProfile, saveProfile } from '../save/storage';
import type { Profile } from '../save/profile';
import { SOUND_PACKAGES } from '../audio/packages';
import { sound } from '../audio/sound';
import { mountSoundButton } from '../audio/soundButton';
import { mountFullscreenButton } from './fullscreenButton';
import { mountFocusHint } from './focusHint';
import { mountClickSounds, uiSound } from '../audio/uiSounds';
import { loadSelection, saveSelection } from '../minigames/catalog';
import { showLobby } from './lobbyScreen';
import { showProfile } from './profileScreen';
import { showConnecting, showStart } from './startScreen';
import { addDevBots } from '../dev/bots';
import { devFlags } from '../dev/devFlags';
import { attachClientEvening, onStartEvening, preloadRuntime } from './startEvening';

const NOT_FOUND = 'Kein Raum mit diesem Code gefunden.';
const REJECT_TEXT: Record<RejectReason, string> = {
  full: 'Der Raum ist voll.',
  running: 'Der Abend läuft bereits.',
  version: 'Versionen passen nicht – bitte beide Seiten neu laden.',
  kicked: 'Der Gastgeber hat dich aus dem Raum entfernt.',
  name: 'Dieser Name ist im Raum schon vergeben. Falls du gerade neu geladen hast: kurz warten und nochmal versuchen.',
};

let assetsPromise: Promise<Record<string, AssetFile> | null> | null = null;
const getAssets = () =>
  (assetsPromise ??= loadAssets().then(
    (a) => a,
    (e) => {
      console.warn('assets unavailable, lobby without previews', e);
      return null;
    },
  ));

/** Start the DOM menus (start -> lobby / profile) inside `root`. */
export function startMenus(root: HTMLElement): void {
  let profile: Profile = loadProfile();
  void getAssets();
  mountSoundButton();
  mountFullscreenButton();
  mountFocusHint();
  mountClickSounds();
  for (const p of SOUND_PACKAGES) void sound.loadPackage(p);

  // Create/Join wait for the assets first: a second click meanwhile must not open a second room.
  let starting = false;
  const once = (fn: () => Promise<void>) => () => {
    if (starting) return;
    starting = true;
    void fn();
  };

  const toStart = (message?: string): void => {
    starting = false;
    // An evening may have settled XP into storage meanwhile: never save a stale copy over it.
    profile = loadProfile();
    showStart(root, {
      name: profile.name,
      message,
      onName: (name) => {
        profile = { ...profile, name };
        saveProfile(profile);
      },
      onCreate: once(host),
      onJoin: (code) => once(() => join(code))(),
      onProfile: () =>
        showProfile(root, profile, (p) => {
          profile = p;
          toStart();
        }),
    });
  };

  const host = async (): Promise<void> => {
    const assets = await getAssets();
    const code = generateRoomCode();
    const transport = joinTrysteroRoom(code);
    const session = createHost(transport, profile);
    addDevBots(session, devFlags(location.search).bots);
    let rounds: number = CONFIG.rounds.default;
    let games = loadSelection();
    let alive = true;
    // Closing/reloading the tab: say `bye` so clients notice at once (not after the WebRTC timeout).
    const onPageHide = () => session.close();
    window.addEventListener('pagehide', onPageHide);
    const leave = () => {
      alive = false;
      window.removeEventListener('pagehide', onPageHide);
      session.close(); // sends `bye`
      toStart();
    };
    preloadRuntime();
    const update = showLobby(
      root,
      {
        code, selfId: session.selfId, isHost: true, rounds, assets,
        onReady: (r) => session.setLocalReady(session.selfId, r),
        onRounds: (n) => (rounds = n),
        games,
        onGames: (ids) => {
          games = ids;
          saveSelection(ids);
        },
        onStart: () => onStartEvening({ session, transport, profile, isHost: true, rounds, games, assets, root }),
        onLeave: leave,
        onKick: (id) => {
          uiSound('entfernt');
          void session.kick(id);
        },
      },
      session.roster.list(),
    );
    uiSound('raum_erstellt');
    session.onRoster((r) => void (alive && update(r)));
  };

  const join = async (rawCode: string): Promise<void> => {
    const assets = await getAssets();
    let transport: Transport;
    try {
      transport = joinTrysteroRoom(rawCode);
    } catch {
      toStart('Ungültiger Code – z. B. KAESE-42');
      return;
    }
    const session = createClient(transport, profile);
    let phase: 'connecting' | 'lobby' | 'over' = 'connecting';
    const abort = (message?: string) => {
      if (phase === 'over') return;
      phase = 'over';
      clearTimeout(timer);
      session.close();
      toStart(message);
    };
    const timer = setTimeout(() => phase === 'connecting' && abort(NOT_FOUND), CONFIG.net.joinTimeoutMs);
    showConnecting(root, () => abort());

    let update: ((r: PlayerInfo[]) => void) | null = null;
    const evening = attachClientEvening(session, root, () => abort());
    session.onRejected((reason) => (phase === 'connecting' || reason === 'kicked') && abort(REJECT_TEXT[reason]));
    session.onHostLost(() => {
      if (phase === 'connecting') abort(NOT_FOUND);
      else if (evening.running()) evening.hostLost(); // ended screen; its button calls abort()
      else abort('Der Gastgeber hat den Raum verlassen.');
    });
    session.onRoster((r) => {
      if (phase === 'over') return;
      if (phase === 'connecting') {
        phase = 'lobby';
        clearTimeout(timer);
        update = showLobby(
          root,
          {
            code: normalizeRoomCode(rawCode) ?? rawCode, selfId: session.playerId ?? session.selfId, isHost: false,
            rounds: CONFIG.rounds.default, assets,
            onReady: (ready) => session.setReady(ready),
            onRounds: () => {},
            onStart: () => {},
            onLeave: () => abort(),
          },
          r,
        );
        return;
      }
      update?.(r);
    });
  };

  toStart();
}

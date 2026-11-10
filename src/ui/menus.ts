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
import { setFavicon } from './favicon';
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
    (a) => {
      setFavicon(a);
      return a;
    },
    (e) => {
      console.warn('assets unavailable, lobby without previews', e);
      return null;
    },
  ));

/** Start the DOM menus (start -> lobby / profile) inside `root`. */
export function startMenus(root: HTMLElement): void {
  let profile: Profile = loadProfile();
  void getAssets();

  const toStart = (message?: string): void => {
    showStart(root, {
      name: profile.name,
      message,
      onName: (name) => {
        profile = { ...profile, name };
        saveProfile(profile);
      },
      onCreate: () => void host(),
      onJoin: (code) => void join(code),
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
        onStart: () => onStartEvening({ session, transport, profile, isHost: true, rounds, root }),
        onLeave: leave,
        onKick: (id) => void session.kick(id),
      },
      session.roster.list(),
    );
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

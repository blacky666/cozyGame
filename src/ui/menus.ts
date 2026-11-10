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
import { onStartEvening } from './startEvening';

const JOIN_TIMEOUT_MS = 15000;
const NOT_FOUND = 'Kein Raum mit diesem Code gefunden.';
const REJECT_TEXT: Record<RejectReason, string> = {
  full: 'Der Raum ist voll.',
  running: 'Der Abend läuft bereits.',
  version: 'Bitte Seite neu laden – deine Version ist veraltet.',
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
    let rounds: number = CONFIG.rounds.default;
    let alive = true;
    const leave = () => {
      alive = false;
      session.close();
      toStart();
    };
    const update = showLobby(
      root,
      {
        code, selfId: session.selfId, isHost: true, rounds, assets,
        onReady: (r) => session.setLocalReady(session.selfId, r),
        onRounds: (n) => (rounds = n),
        onStart: () => {
          alive = false;
          onStartEvening({ session, transport, profile, isHost: true, rounds });
        },
        onLeave: leave,
      },
      session.roster.list(),
    );
    session.onRoster((r) => alive && update(r));
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
    const timer = setTimeout(() => phase === 'connecting' && abort(NOT_FOUND), JOIN_TIMEOUT_MS);
    showConnecting(root, () => abort());

    let update: ((r: PlayerInfo[]) => void) | null = null;
    session.onRejected((reason) => phase === 'connecting' && abort(REJECT_TEXT[reason]));
    session.onHostLost(() => {
      if (phase === 'connecting') abort(NOT_FOUND);
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

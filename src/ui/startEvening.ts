import type { EveningPhase } from '../flow/evening';
import type { Stage } from '../game/phaserGame';
import type { AssetFile } from '../gfx/assetTypes';
import type { Transport } from '../net/transport';
import type { ClientSession, HostSession } from '../net/session';
import type { Profile } from '../save/profile';

/*
 * Hand-over between the DOM menus and the Phaser evening. Phaser and the game code are loaded
 * with a dynamic import on first use. The DOM overlay (#ui) is hidden while Phaser runs and comes
 * back on "Nochmal?" (lobby) or when leaving.
 */

export type EveningContext = {
  session: HostSession | ClientSession;
  transport: Transport;
  profile: Profile;
  isHost: boolean;
  rounds: number;
  /** Host: asset files loaded by the menus (null when loading failed). */
  assets?: Record<string, AssetFile> | null;
  /** DOM overlay root (the lobby stays rendered inside while hidden). */
  root: HTMLElement;
  /** Called after the evening returned to the lobby. */
  onLobby?(): void;
};

const STARTING = 'starting';
const loadRuntime = () => import('../game/runtime');
const setOverlay = (root: HTMLElement, visible: boolean) => void (root.style.display = visible ? '' : 'none');

/** Shown in the lobby when the host's start failed. */
export const START_ABORTED = 'Start abgebrochen – zu wenige Spieler.';
const NO_ASSETS = 'Grafiken konnten nicht geladen werden. Bitte Seite neu laden.';

/** Host pressed "Los geht's!". */
export function onStartEvening(ctx: EveningContext): void {
  if (!ctx.isHost) return;
  const session = ctx.session as HostSession;
  // Lock the room while the lazy chunk loads: new peers are told "running" instead of joining unready.
  session.setPhase(STARTING);
  setOverlay(ctx.root, false);
  const abort = (notice?: string) => {
    session.resetForLobby({ kind: 'lobby' });
    setOverlay(ctx.root, true);
    if (notice) {
      const hint = ctx.root.querySelector('.cg-hint');
      if (hint) hint.textContent = notice;
    }
  };
  const assets = ctx.assets;
  if (!assets) {
    // The host simulations need the arena maps from the assets.
    abort(NO_ASSETS);
    return;
  }
  void loadRuntime().then(
    ({ runHostEvening }) => {
      try {
        runHostEvening(session, ctx.rounds, assets, () => {
          setOverlay(ctx.root, true);
          ctx.onLobby?.();
        });
      } catch (e) {
        console.error('could not start the evening', e);
        abort(START_ABORTED);
      }
    },
    (e: unknown) => {
      console.error('could not load the game', e);
      abort();
    },
  );
}

/** Warm the lazy Phaser chunk (call when entering the lobby). */
export const preloadRuntime = (): void => void loadRuntime().catch(() => {});

const KINDS: ReadonlyArray<EveningPhase['kind']> = ['lobby', 'intro', 'playing', 'standings', 'podium', 'ended'];
const asPhase = (x: unknown): EveningPhase | null =>
  typeof x === 'object' && x !== null && KINDS.includes((x as { kind: EveningPhase['kind'] }).kind)
    ? (x as EveningPhase)
    : null;

export type ClientEvening = {
  /** True while the evening (Phaser) is shown or loading. */
  running(): boolean;
  /** Host vanished mid-evening: show the ended screen. */
  hostLost(): void;
};

/** Client: switch from the lobby DOM to Phaser on the first non-lobby phase the host sends. */
export function attachClientEvening(session: ClientSession, root: HTMLElement, backToStart: () => void): ClientEvening {
  let stage: Stage | null = null;
  let loading = false;
  let latest: EveningPhase | null = null;
  let over = false;

  const leave = () => {
    over = true;
    stage = null;
    setOverlay(root, true);
    backToStart();
  };

  session.onPhase((msg) => {
    const p = asPhase(msg.data);
    if (!p || over) return;
    if (p.kind === 'lobby') {
      latest = null;
      stage?.destroy();
      stage = null;
      setOverlay(root, true);
      return;
    }
    latest = p;
    if (stage) return stage.setPhase(p);
    if (loading) return;
    loading = true;
    setOverlay(root, false);
    void loadRuntime().then(
      ({ runClientEvening }) => {
        loading = false;
        if (over) return;
        if (!latest) return setOverlay(root, true); // back in the lobby while loading
        stage = runClientEvening(session, leave);
        stage.setPhase(latest);
      },
      (e: unknown) => {
        loading = false;
        console.error('could not load the game', e);
        setOverlay(root, true);
      },
    );
  });
  session.onSnapshot((snap) => stage?.pushSnap(snap));

  return {
    running: () => !over && (stage !== null || loading),
    hostLost() {
      latest = { kind: 'ended', reason: 'host_left' };
      stage?.hostLeft();
    },
  };
}

export { APP_VERSION } from './version';

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

interface GameConfig {
  rounds: { min: number; max: number; default: number };
  points: number[];
  lastRoundMultiplier: number;
  net: {
    simHz: number;
    snapshotHz: number;
    interpDelayMs: number;
    reconnectGraceMs: number;
    appId: string;
    /** Client prediction: ease toward the server position when the error exceeds this (px). */
    predictErrPx: number;
    /** Client prediction: fraction of the error corrected per frame. */
    predictEase: number;
    /** Clients re-send unchanged input at least this often. */
    inputHeartbeatMs: number;
    /** Host treats a remote input older than this as neutral. */
    inputStaleMs: number;
  };
  view: { width: number; height: number; zoom: number };
  players: { min: number; max: number };
  turn: { urls: string[]; username: string; credential: string };
  intro: { ruleMs: number; countdownMs: number };
  standings: { showMs: number };
  sandbox: { durationMs: number; speed: number; spawnMs: number; coinSize: number; pickupRadius: number; maxCoins: number };
}

function deepFreeze<T extends object>(obj: T): DeepReadonly<T> {
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj) as DeepReadonly<T>;
}

export const CONFIG = deepFreeze<GameConfig>({
  rounds: { min: 5, max: 8, default: 6 },
  points: [5, 3, 1, 0],
  lastRoundMultiplier: 2,
  net: {
    simHz: 30,
    snapshotHz: 20,
    interpDelayMs: 100,
    reconnectGraceMs: 60000,
    appId: 'cozygame-v1',
    predictErrPx: 4,
    predictEase: 0.3,
    inputHeartbeatMs: 200,
    inputStaleMs: 500,
  },
  view: { width: 426, height: 240, zoom: 3 },
  players: { min: 2, max: 4 },
  // Empty until the Metered TURN account exists.
  turn: { urls: [], username: '', credential: '' },
  intro: { ruleMs: 5000, countdownMs: 3000 },
  standings: { showMs: 8000 },
  // Placeholder minigame "Münzjagd" (speed in px/s, sizes in px).
  sandbox: { durationMs: 30000, speed: 60, spawnMs: 1500, coinSize: 8, pickupRadius: 9, maxCoins: 12 },
});

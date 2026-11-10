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
  net: { simHz: number; snapshotHz: number; interpDelayMs: number; reconnectGraceMs: number; appId: string };
  view: { width: number; height: number; zoom: number };
  players: { min: number; max: number };
  turn: { urls: string[]; username: string; credential: string };
  intro: { ruleMs: number; countdownMs: number };
  standings: { showMs: number };
  sandbox: { durationMs: number };
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
  net: { simHz: 30, snapshotHz: 20, interpDelayMs: 100, reconnectGraceMs: 60000, appId: 'cozygame-v1' },
  view: { width: 426, height: 240, zoom: 3 },
  players: { min: 2, max: 4 },
  // Empty until the Metered TURN account exists.
  turn: { urls: [], username: '', credential: '' },
  intro: { ruleMs: 5000, countdownMs: 3000 },
  standings: { showMs: 8000 },
  sandbox: { durationMs: 30000 },
});

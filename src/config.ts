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
    /** Client gives up joining a room after this long. */
    joinTimeoutMs: number;
    /** STUN servers for WebRTC. */
    stun: string[];
    /** Client prediction: fraction of the error corrected per frame. */
    predictEase: number;
    /** While a direction or the primary button is held, send at least this often so one seq covers about one host tick. */
    activeSendMs: number;
    /** Aim-only changes are sent at most this often (ms). */
    aimSendMs: number;
    /** Clients re-send unchanged input at least this often. */
    inputHeartbeatMs: number;
    /** Host treats a remote input older than this as neutral. */
    inputStaleMs: number;
    /** Host lag compensation: hits of remote throwers are tested against positions this long ago. */
    rewindMs: number;
  };
  view: { width: number; height: number; zoom: number };
  players: { min: number; max: number; maxName: number };
  turn: { urls: string[]; username: string; credential: string };
  intro: { ruleMs: number; countdownMs: number };
  standings: { showMs: number };
  sandbox: { durationMs: number; speed: number; spawnMs: number; coinSize: number; pickupRadius: number; maxCoins: number };
  snowball: {
    durationMs: number;
    maxBalls: number;
    reloadMs: number;
    /** Minimum time between two throws of one player. */
    throwGapMs: number;
    /** Left click: speed (px/s) and max flight distance (px). */
    normalSpeed: number;
    normalRange: number;
    /** Right click: faster and farther, then no throw at all for strongCooldownMs. */
    strongSpeed: number;
    strongRange: number;
    strongCooldownMs: number;
    ballRadius: number;
    bodyRadius: number;
    hitRadius: number;
    hitPoints: number;
    hitPenalty: number;
    /** After a hit the victim lies on the ground this long (no move, no throw, not shovable). */
    downMs: number;
    /** Total invulnerability after a hit (counted from the hit, includes downMs). */
    invulnMs: number;
    snowmanHits: number;
    snowmanRebuildMs: number;
    /** Length of the snowman's rebuild animation before it is solid again. */
    snowmanAufbauMs: number;
    walkSpeed: number;
    /** Pond: acceleration (px/s^2) and friction (fraction of speed lost per second). */
    iceAccel: number;
    iceFriction: number;
    spawnMs: number;
    maxPickups: number;
    bounces: number;
    giantSpeedFactor: number;
    giantHitRadius: number;
    extraThrows: number;
  };
  shove: {
    /** Max distance between two pivots for a shove to land (px). */
    reachPx: number;
    /** How far the victim slides in total (px). */
    pushPx: number;
    /** Victim cannot steer for this long; the slide happens in this time. */
    stunMs: number;
    cooldownMs: number;
    /** After being shoved, nobody can shove you again for this long. */
    immuneMs: number;
    /** Length of the shove arm animation. */
    swingMs: number;
  };
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
    joinTimeoutMs: 15000,
    stun: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'],
    predictEase: 0.3,
    activeSendMs: 33,
    aimSendMs: 50,
    inputHeartbeatMs: 200,
    inputStaleMs: 500,
    rewindMs: 150,
  },
  view: { width: 426, height: 240, zoom: 3 },
  players: { min: 2, max: 4, maxName: 16 },
  // Empty until the Metered TURN account exists.
  turn: { urls: [], username: '', credential: '' },
  intro: { ruleMs: 5000, countdownMs: 3000 },
  standings: { showMs: 8000 },
  // Placeholder minigame "Münzjagd" (speed in px/s, sizes in px).
  sandbox: { durationMs: 30000, speed: 60, spawnMs: 1500, coinSize: 8, pickupRadius: 9, maxCoins: 12 },
  // Schneeball-Schlacht (px, px/s, ms).
  snowball: {
    durationMs: 120000, maxBalls: 5, reloadMs: 600, throwGapMs: 250,
    normalSpeed: 160, normalRange: 150, strongSpeed: 240, strongRange: 240, strongCooldownMs: 800,
    ballRadius: 3, bodyRadius: 5, hitRadius: 7,
    hitPoints: 2, hitPenalty: 1, downMs: 900, invulnMs: 2500, snowmanHits: 3, snowmanRebuildMs: 15000, snowmanAufbauMs: 500,
    walkSpeed: 60, iceAccel: 140, iceFriction: 0.8, spawnMs: 12000, maxPickups: 2, bounces: 2,
    giantSpeedFactor: 0.7, giantHitRadius: 11, extraThrows: 3,
  },
  // Shove (Space) in all top-down games.
  shove: { reachPx: 18, pushPx: 28, stunMs: 400, cooldownMs: 4000, immuneMs: 1500, swingMs: 250 },
});

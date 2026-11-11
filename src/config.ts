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
    /** Radius of the player hit capsule (a vertical segment over the whole figure). */
    bodyHitRadius: number;
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
    /** Riesenschneeball: added to the hit reach. */
    giantExtraRadius: number;
    extraThrows: number;
  };
  kartoffel: {
    walkSpeed: number;
    bodyRadius: number;
    /** Max feet distance for a pass by touch (px). */
    touchPx: number;
    /** Left click: speed factor for sprintMs, then no sprint for sprintCooldownMs (counted from the click). */
    sprintFactor: number;
    sprintMs: number;
    sprintCooldownMs: number;
    /** After a pass the giver cannot get the potato back for this long. */
    noBackMs: number;
    /** "Kein Zurück!" fx at most this often per potato. */
    noBackFxMs: number;
    /** Real fuse, random in this range (host-only). */
    fuseMinMs: number;
    fuseMaxMs: number;
    /** Fraction of the fuse burnt at which heat becomes 1, 2, 3. */
    heatSteps: number[];
    /** Each heat step is shifted per potato by a random amount in +-heatJitter (fraction of the fuse), so heat does not reveal the fuse. */
    heatJitter: number;
    /** Pause after a bang before the next potato. */
    boomPauseMs: number;
    /** Kurze Lunte: the real fuse is cut to this much remaining time. */
    shortFuseMs: number;
    fakeFuseMinMs: number;
    fakeFuseMaxMs: number;
    /** Gießkanne: the holder is slower by slowFactor for slowMs. */
    slowMs: number;
    slowFactor: number;
    /** Speed factor of the evening leader while not holding a potato. */
    leaderFactor: number;
    pickupSpawnMs: number;
    maxPickups: number;
    /** A living player within this feet distance of a pickup takes it (px). */
    pickupTouchPx: number;
    /** Pickups spawn at least this far from every living player (px), after at most pickupTries tries. */
    pickupClearPx: number;
    pickupTries: number;
    /** Potato ids are random in 1..idRange (creation order stays hidden); idTries retries on a collision. */
    idRange: number;
    idTries: number;
    /** The round ends after this long at the latest (living players share first place). */
    safetyMs: number;
    /** Two players: bangs per round (best of), the first to lose a majority is out. */
    bestOf: number;
    /** How long fx stay in snapshots. */
    fxKeepMs: number;
    /** Garden map size in px (26x13 tiles of 16 px; a test checks it against the map file). */
    mapW: number;
    mapH: number;
    /** Bot targets stay this far inside the map edges (the fence). */
    botMarginPx: number;
  };
  farbkrieg: {
    durationMs: number;
    walkSpeed: number;
    bodyRadius: number;
    /** Left click: min time between paint blobs. */
    klecksCooldownMs: number;
    /** Blob flight: speed (px/s), max range (px), radius (px) and hit distance to a player (px). */
    blobSpeed: number;
    blobRange: number;
    blobRadius: number;
    blobHitPx: number;
    /** Paint disc radii on landing: normal blob and bomb (px). */
    klecksPaintR: number;
    bombPaintR: number;
    /** In the finale a Klecks paints a disc of klecksPaintR times this. */
    finaleKlecksFactor: number;
    /** A hit blob slows the victim by slowFactor for slowMs. */
    slowMs: number;
    slowFactor: number;
    /** Mopp pickup: duration of the effect (ms). */
    moppMs: number;
    /** Roller pickup: duration (ms) and speed factor. */
    rollMs: number;
    rollFactor: number;
    pickupSpawnMs: number;
    maxPickups: number;
    /** A living player within this feet distance of a pickup takes it (px). */
    pickupTouchPx: number;
    /** Pickups spawn at least this far from every living player (px), after at most pickupTries tries. */
    pickupClearPx: number;
    pickupTries: number;
    /** Finale: total length (ms), time one finale blob falls (ms) and its paint radius (px). */
    finaleMs: number;
    finaleFallMs: number;
    finalePaintR: number;
    /** How long fx stay in snapshots. */
    fxKeepMs: number;
    /** Map size in px (26x13 tiles of 16 px; a test checks it against the map file). */
    mapW: number;
    mapH: number;
    /** Bot targets stay this far inside the map edges. */
    botMarginPx: number;
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
    ballRadius: 3, bodyRadius: 5, bodyHitRadius: 5,
    hitPoints: 2, hitPenalty: 1, downMs: 900, invulnMs: 2500, snowmanHits: 3, snowmanRebuildMs: 15000, snowmanAufbauMs: 500,
    walkSpeed: 60, iceAccel: 140, iceFriction: 0.8, spawnMs: 12000, maxPickups: 2, bounces: 2,
    giantSpeedFactor: 0.7, giantExtraRadius: 4, extraThrows: 3,
  },
  // Heiße Kartoffel (px, px/s, ms).
  kartoffel: {
    walkSpeed: 64, bodyRadius: 5, touchPx: 13,
    sprintFactor: 1.8, sprintMs: 400, sprintCooldownMs: 3000,
    noBackMs: 1000, noBackFxMs: 500,
    fuseMinMs: 12000, fuseMaxMs: 20000, heatSteps: [0.5, 0.75, 0.9], heatJitter: 0.08, boomPauseMs: 1800,
    shortFuseMs: 3000, fakeFuseMinMs: 6000, fakeFuseMaxMs: 10000, slowMs: 2000, slowFactor: 0.6,
    leaderFactor: 0.95, pickupSpawnMs: 7000, maxPickups: 2, pickupTouchPx: 12, pickupClearPx: 24, pickupTries: 20, idRange: 1000000, idTries: 10, safetyMs: 180000, bestOf: 3, fxKeepMs: 500,
    mapW: 416, mapH: 208, botMarginPx: 24,
  },
  // Farbkrieg (px, px/s, ms).
  farbkrieg: {
    durationMs: 90000, walkSpeed: 64, bodyRadius: 5,
    klecksCooldownMs: 1500, blobSpeed: 180, blobRange: 140, blobRadius: 2, blobHitPx: 8,
    klecksPaintR: 24, bombPaintR: 48, finaleKlecksFactor: 2, slowMs: 500, slowFactor: 0.5,
    moppMs: 4000, rollMs: 4000, rollFactor: 1.5,
    pickupSpawnMs: 8000, maxPickups: 2, pickupTouchPx: 10, pickupClearPx: 24, pickupTries: 20,
    finaleMs: 15000, finaleFallMs: 2000, finalePaintR: 64, fxKeepMs: 500,
    mapW: 416, mapH: 208, botMarginPx: 24,
  },
  // Shove (Space) in all top-down games.
  shove: { reachPx: 18, pushPx: 28, stunMs: 400, cooldownMs: 4000, immuneMs: 1500, swingMs: 250 },
});

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
  input: {
    /** Mouse wheel: one turn per gesture; a gesture ends after wheelGapMs without events and turns at wheelStepPx. */
    wheelGapMs: number;
    wheelStepPx: number;
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
    /** Tiles around the feet tile in which the mopp turns foreign paint neutral (1 = the 3x3 block). */
    moppReach: number;
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
  wackelturm: {
    durationMs: number;
    /** A dropped block counts as placed (charges, height) after resting this long while still in its column. */
    restHoldMs: number;
    /** Fixed physics sub-step (ms); the host feeds dt into an accumulator and steps in whole stepMs. */
    stepMs: number;
    /** Matter gravity y (scale stays at Matter's default 0.001). */
    gravityY: number;
    /**
     * Anchored rest: a block that came to rest is anchored at its pose; it counts as still (restMs grows)
     * while its pivot stays within settleTolPx and its angle within settleTolRad of the anchor, so a jolt
     * that does not really move it no longer resets it.
     */
    settleTolPx: number;
    settleTolRad: number;
    /** fx 'hoehe' only for a new best at least this far above the last best (px). */
    hoeheStepPx: number;
    /** Block material. */
    friction: number;
    frictionStatic: number;
    restitution: number;
    density: number;
    /** A block is at rest below this speed (px/step) and angular speed (rad/step). */
    restSpeed: number;
    restAngSpeed: number;
    /** Crane: sideways speed (px/s), rise speed (px/s) and clearance above the highest landed block (px). */
    craneSpeed: number;
    craneRiseSpeed: number;
    craneClearPx: number;
    /**
     * Matter solver iterations per sub-step. Matter's defaults (6 / 4) let tall stacks sink and drift apart:
     * 12 flat lang blocks fell over within 4 s. With 8 velocity iterations an awake stack still shears
     * layer against layer (always towards +x), so an 11-layer lang tower fell in any rightward gust down to
     * windAccel 60; 16 removes the shear (a test pins the Windstoß balance).
     */
    positionIterations: number;
    velocityIterations: number;
    /**
     * Sleeping keeps settled stacks from creeping apart: Matter's motion threshold for sleep (set once,
     * module-wide, in towerPhysics; Matter's default is 0.08) and the collision slop of blocks and
     * foundation (Matter's default 0.05 let stacks sink about 0.6 px per layer).
     */
    sleepMotion: number;
    slop: number;
    /** Defensive cap on physics sub-steps per stepWorld call; time beyond it is dropped (dt is already clamped to 0.25 s = 15 steps). */
    maxStepsPerTick: number;
    /** Gap after a drop before the next block hangs. */
    dropCooldownMs: number;
    /** A block whose centre is below surfaceY + fallMarginPx (or outside its column) is removed. */
    fallMarginPx: number;
    /**
     * Goal height above the foundation (px). The asset's crane marker sits only 107 px (~6.7 cells) above
     * the foundation, too easy for two minutes. readLayout still reports the asset's goalY/goalPx, but the
     * host uses this value and the view draws the goal marker at surfaceY - goalPx. 150: ten flat lang
     * (about 155 px after sinking) reach it.
     */
    goalPx: number;
    /** The block reaching goalPx must be at rest and stay at or above goalPx this long before the round ends. */
    goalHoldMs: number;
    /** One Ärger-Aktion charge per chargeEvery placed blocks, at most chargeCap. */
    chargeEvery: number;
    chargeCap: number;
    /** Windstoß: duration (ms) and push (px/s², force = mass * windAccel / 1e6 per step). */
    windMs: number;
    windAccel: number;
    /** A tower hit by a Windstoß cannot be hit by another one for this long (a blocked attempt keeps the charge). */
    windImmuneMs: number;
    /** No Ärger-Aktion can be armed or fired in the last aergerLockMs of the round; arming clears. */
    aergerLockMs: number;
    /** Wobble sound: a block faster than wobbleSpeed (px/step), at most once per wobbleGapMs. */
    wobbleSpeed: number;
    wobbleGapMs: number;
    /** A height drop this large within collapseWindowMs gives fx 'einsturz' (px, ms). */
    collapseDropPx: number;
    collapseWindowMs: number;
    /** Finale music in the last finaleMs or once anyone is within finaleNearPx of the goal. */
    finaleMs: number;
    finaleNearPx: number;
    /** How long fx stay in snapshots. */
    fxKeepMs: number;
  };
  progress: {
    /** XP for taking part in an evening (once at least one round finished). */
    participationXp: number;
    /** XP per round place, indexed by the start index of the tie group (as roundPoints). */
    placeXp: number[];
    /** XP for overall place 1 / 2 at the end of the evening (same tie rule). */
    finalXp: number[];
    /** XP for the first evening of the local day (added client-side). */
    dayBonusXp: number;
    /** XP from level n to n+1 = levelBase + levelStep * n; no level beyond maxLevel. */
    levelBase: number;
    levelStep: number;
    maxLevel: number;
    /** After maxLevel: one surprise box (and star) per boxEveryXp. */
    boxEveryXp: number;
    /** XP per achievement (feat id -> XP). */
    featXp: Record<string, number>;
    /** Achievement thresholds: counts per round, last-second pass window (ms), area fraction, tower blocks. */
    feats: {
      serie: number;
      passes: number;
      tuencher: number;
      shoves: number;
      lastSecondMs: number;
      areaFrac: number;
      towerBlocks: number;
    };
    /** Emote bubble show time and cooldown (counted from the press), ms. */
    emote: { showMs: number; cooldownMs: number };
    /** Podium XP panel timing (ms): start delay, per item row, per level bar segment, per unlock card. */
    podium: { startMs: number; itemMs: number; barMs: number; unlockMs: number };
    /** Level reward table: level -> item id ('<category>.<name>'). */
    rewards: Record<number, string>;
    /** Surprise box pool (items without a level); order is the pick order base. */
    boxPool: string[];
  };
  /** Gemeinheit-Karten (spec §6): the overall last place picks a card for the next round. */
  gemeinheit: {
    /** Cards offered to the chooser. */
    offer: number;
    /** Time the chooser has to pick (ms; scaled by the dev flag `fast`). */
    pickMs: number;
    /** Bots pick, and a disconnected chooser falls to a random card, after this (ms). */
    botPickMs: number;
    /** Reveal animation shown to everyone (ms). */
    revealMs: number;
    /** Falle stellen: the first place starts frozen this long (ms). */
    falleMs: number;
    /** Turbo-Start in Heiße Kartoffel: no sprint cooldown during the first turboSprintMs (ms). */
    turboSprintMs: number;
  };
  /** Streiche (spec §7.2): one prank per player and round on key F. */
  pranks: {
    /** Prank uses per round; doubleUses for the chooser of the card Doppelter Streich. */
    uses: number;
    doubleUses: number;
    /** Verkehrte Welt: controls reversed this long (ms). */
    reverseMs: number;
    /** Furzkissen (top-down): the victim stumbles (no input) this long (ms). */
    stumbleMs: number;
    /** Bananenschale: the victim slips (input forced in his move direction) this long (ms). */
    slipMs: number;
    /** Tintenklecks / Konfetti-Kanone: victim's screen effect (ms). */
    inkMs: number;
    confettiMs: number;
    /** One-shot cues stay this long in snapshots, so every client sees them (ms). */
    cueMs: number;
    /** Banana: armed after bananaArmMs, gone after bananaLifeMs, trips a player within bananaTriggerPx (ms, ms, px). */
    bananaArmMs: number;
    bananaLifeMs: number;
    bananaTriggerPx: number;
    /** Quietsche-Hammer (top-down): every affectable opponent within this radius is knocked away (px). */
    hammerRadiusPx: number;
    tower: {
      /** Slippery block (Bananenschale): friction and frictionStatic times this factor. */
      slickFactor: number;
      /** Furzkissen tower jolt: upward speed and sideways speed added to every block (matter velocity units). */
      bumpSpeed: number;
      bumpSide: number;
    };
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
  input: { wheelGapMs: 120, wheelStepPx: 8 },
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
    moppMs: 4000, moppReach: 1, rollMs: 4000, rollFactor: 1.5,
    pickupSpawnMs: 8000, maxPickups: 2, pickupTouchPx: 10, pickupClearPx: 24, pickupTries: 20,
    finaleMs: 15000, finaleFallMs: 2000, finalePaintR: 48, fxKeepMs: 500,
    mapW: 416, mapH: 208, botMarginPx: 24,
  },
  // Wackel-Turm (px, px/s, ms; Matter units per 1000/60 ms step where noted).
  wackelturm: {
    durationMs: 120000, restHoldMs: 2000, settleTolPx: 2, settleTolRad: 0.05, hoeheStepPx: 4, stepMs: 1000 / 60, gravityY: 1,
    friction: 0.6, frictionStatic: 0.9, restitution: 0.02, density: 0.001,
    restSpeed: 0.08, restAngSpeed: 0.004, maxStepsPerTick: 20, positionIterations: 12, velocityIterations: 16,
    sleepMotion: 0.03, slop: 0.02,
    craneSpeed: 64, craneRiseSpeed: 48, craneClearPx: 64, dropCooldownMs: 600, fallMarginPx: 16,
    // Overrides the asset marker (107 px), see the interface comment. Calibrated in the playtest.
    goalPx: 150, goalHoldMs: 400,
    chargeEvery: 3, chargeCap: 2, windMs: 1500, windAccel: 120, windImmuneMs: 8000, aergerLockMs: 5000,
    wobbleSpeed: 0.6, wobbleGapMs: 400, collapseDropPx: 32, collapseWindowMs: 400, finaleMs: 20000, finaleNearPx: 32, fxKeepMs: 500,
  },
  // Progress: XP, levels, rewards (spec §7.4).
  progress: {
    participationXp: 50,
    placeXp: [25, 15, 10, 5],
    finalXp: [40, 20],
    dayBonusXp: 50,
    levelBase: 80,
    levelStep: 40,
    maxLevel: 30,
    boxEveryXp: 1000,
    featXp: {
      schubser: 5,
      schnee_serie: 10,
      schnee_erster: 5,
      schnee_schneemann: 5,
      kartoffel_knapp: 10,
      kartoffel_pass: 5,
      farb_tuencher: 5,
      farb_flaeche: 10,
      turm_zehn: 10,
      turm_aerger: 5,
      turm_ziel: 10,
    },
    feats: { serie: 3, passes: 3, tuencher: 3, shoves: 3, lastSecondMs: 1500, areaFrac: 1 / 3, towerBlocks: 10 },
    emote: { showMs: 2000, cooldownMs: 3000 },
    podium: { startMs: 4200, itemMs: 600, barMs: 900, unlockMs: 1600 },
    rewards: {
      2: 'emote.zunge', 3: 'hat.zylinder', 4: 'face.rundbrille', 5: 'prank.furzkissen',
      6: 'emote.tanzen', 7: 'cape.umhang_rot', 8: 'hat.strohhut', 9: 'outfit.streifenpulli',
      10: 'cape.sternenumhang', 11: 'emote.herz', 12: 'face.sonnenbrille', 13: 'hat.piratenhut',
      14: 'prank.verkehrte_welt', 15: 'outfit.ruestung', 16: 'emote.weinen', 17: 'cape.heldencape',
      18: 'hat.propellermuetze', 19: 'face.schnurrbart', 20: 'prank.tintenklecks', 21: 'emote.gg',
      22: 'outfit.maleroverall', 23: 'hat.wikingerhelm', 24: 'face.clownsnase', 25: 'cape.engelsfluegel',
      26: 'emote.daumen_runter', 27: 'hat.ritterhelm', 28: 'prank.quietsche_hammer', 29: 'emote.wut',
      30: 'hat.krone_glitzer',
    },
    boxPool: [
      'emote.schnarchen', 'hat.bauhelm', 'hat.kochmuetze', 'hat.blumenkranz', 'face.augenklappe',
      'face.taucherbrille', 'cape.blaetterumhang', 'cape.rucksack', 'outfit.wintermantel',
    ],
  },
  // Gemeinheit-Karten (ms).
  gemeinheit: { offer: 3, pickMs: 10000, botPickMs: 1500, revealMs: 4000, falleMs: 3000, turboSprintMs: 15000 },
  // Streiche (ms, px).
  pranks: {
    uses: 1, doubleUses: 2, reverseMs: 3000, stumbleMs: 500, slipMs: 1000, inkMs: 3000, confettiMs: 2000, cueMs: 1200,
    bananaArmMs: 600, bananaLifeMs: 20000, bananaTriggerPx: 7, hammerRadiusPx: 36,
    tower: { slickFactor: 0.1, bumpSpeed: 2.5, bumpSide: 1.0 },
  },
  // Shove (Space) in all top-down games.
  shove: { reachPx: 18, pushPx: 28, stunMs: 400, cooldownMs: 4000, immuneMs: 1500, swingMs: 250 },
});

/**
 * Names of the minigames for the menus (the lobby's game choice). Kept apart from the registry so
 * the menu chunk does not pull in Phaser; a test checks both lists match.
 */
export const GAME_CATALOG: ReadonlyArray<{ id: string; title: string }> = [
  { id: 'schneeball', title: 'Schneeball-Schlacht' },
  { id: 'kartoffel', title: 'Heiße Kartoffel' },
  { id: 'farbkrieg', title: 'Farbkrieg' },
  { id: 'wackelturm', title: 'Wackel-Turm' },
];

/** Old key (until plan 5): the chosen ids. Read once to migrate, then removed. */
export const GAMES_KEY = 'cozygame.games';
/**
 * The host's DESELECTED ids. Storing what is off (not what is on) means a game added to the catalog
 * later is on by default for hosts who saved a choice before it existed.
 */
export const GAMES_OFF_KEY = 'cozygame.gamesOff';
/** The catalog as it was while GAMES_KEY was written; ids beyond it were never offered there. */
export const LEGACY_IDS: readonly string[] = ['schneeball', 'kartoffel', 'farbkrieg'];

const allIds = (): string[] => GAME_CATALOG.map((g) => g.id);

/** Ids that exist in the catalog, in catalog order; nothing valid left = all games. */
export function cleanSelection(ids: readonly string[]): string[] {
  const want = new Set(ids);
  const out = GAME_CATALOG.filter((g) => want.has(g.id)).map((g) => g.id);
  return out.length > 0 ? out : allIds();
}

/** A JSON string array stored under key, or null (missing, broken, not an array). */
function readIds(storage: Storage, key: string): string[] | null {
  try {
    const raw: unknown = JSON.parse(storage.getItem(key) ?? 'null');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

const withoutOff = (off: readonly string[]): string[] => cleanSelection(allIds().filter((id) => !off.includes(id)));

/** Writes the deselected ids and drops the old key (best effort: private mode keeps it for this page). */
function writeOff(storage: Storage, off: readonly string[]): void {
  try {
    storage.setItem(GAMES_OFF_KEY, JSON.stringify(off));
    storage.removeItem(GAMES_KEY);
  } catch {
    // blocked storage
  }
}

/** The host's last choice: all games minus the deselected ones (all games when nothing usable is stored). */
export function loadSelection(storage?: Storage): string[] {
  let s: Storage;
  try {
    s = storage ?? globalThis.localStorage;
  } catch {
    return allIds();
  }
  const off = readIds(s, GAMES_OFF_KEY);
  if (off) return withoutOff(off);
  const old = readIds(s, GAMES_KEY);
  if (old) {
    // An old choice without a valid id meant all games.
    const valid = LEGACY_IDS.some((id) => old.includes(id));
    const migrated = valid ? LEGACY_IDS.filter((id) => !old.includes(id)) : [];
    writeOff(s, migrated);
    return withoutOff(migrated);
  }
  return allIds();
}

/** Stores the deselected ids (the catalog minus ids). */
export function saveSelection(ids: readonly string[], storage?: Storage): void {
  try {
    writeOff(storage ?? globalThis.localStorage, allIds().filter((id) => !ids.includes(id)));
  } catch {
    // private mode: the choice lasts for this page only
  }
}

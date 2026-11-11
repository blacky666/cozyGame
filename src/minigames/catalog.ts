/**
 * Names of the minigames for the menus (the lobby's game choice). Kept apart from the registry so
 * the menu chunk does not pull in Phaser; a test checks both lists match.
 */
export const GAME_CATALOG: ReadonlyArray<{ id: string; title: string }> = [
  { id: 'schneeball', title: 'Schneeball-Schlacht' },
  { id: 'kartoffel', title: 'Heiße Kartoffel' },
  { id: 'farbkrieg', title: 'Farbkrieg' },
];

export const GAMES_KEY = 'cozygame.games';

/** Ids that exist in the catalog, in catalog order; nothing valid left = all games. */
export function cleanSelection(ids: readonly string[]): string[] {
  const want = new Set(ids);
  const out = GAME_CATALOG.filter((g) => want.has(g.id)).map((g) => g.id);
  return out.length > 0 ? out : GAME_CATALOG.map((g) => g.id);
}

/** The host's last choice (all games when none is stored or it is broken). */
export function loadSelection(storage?: Storage): string[] {
  try {
    const raw: unknown = JSON.parse((storage ?? globalThis.localStorage).getItem(GAMES_KEY) ?? 'null');
    if (Array.isArray(raw)) return cleanSelection(raw.filter((x): x is string => typeof x === 'string'));
  } catch {
    // blocked storage or broken JSON
  }
  return cleanSelection([]);
}

export function saveSelection(ids: readonly string[], storage?: Storage): void {
  try {
    (storage ?? globalThis.localStorage).setItem(GAMES_KEY, JSON.stringify(ids));
  } catch {
    // private mode: the choice lasts for this page only
  }
}

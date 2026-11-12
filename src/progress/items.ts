import { CONFIG } from '../config';
import { levelInfo, xpToReach } from './levels';

export type Category = 'outfit' | 'hat' | 'face' | 'cape' | 'emote' | 'prank';
/** '<category>.<name>'; the look keeps the bare name. */
export type ItemId = string;
export type Item = { id: ItemId; cat: Category; name: string; label: string };

const P = CONFIG.progress;

// Catalog order is the display order in the look editor.
const CATALOG: Record<Category, [string, string][]> = {
  outfit: [
    ['tunika', 'Tunika'], ['latzhose', 'Latzhose'], ['streifenpulli', 'Streifenpulli'],
    ['maleroverall', 'Maler-Overall'], ['wintermantel', 'Wintermantel'], ['ruestung', 'Rüstung'],
  ],
  hat: [
    ['bommelmuetze', 'Bommelmütze'], ['zylinder', 'Zylinder'], ['strohhut', 'Strohhut'], ['bauhelm', 'Bauhelm'],
    ['kochmuetze', 'Kochmütze'], ['piratenhut', 'Piratenhut'], ['ritterhelm', 'Ritterhelm'],
    ['propellermuetze', 'Propellermütze'], ['krone_glitzer', 'Glitzerkrone'], ['wikingerhelm', 'Wikingerhelm'],
    ['blumenkranz', 'Blumenkranz'],
  ],
  face: [
    ['rundbrille', 'Rundbrille'], ['sonnenbrille', 'Sonnenbrille'], ['augenklappe', 'Augenklappe'],
    ['schnurrbart', 'Schnurrbart'], ['clownsnase', 'Clownsnase'], ['taucherbrille', 'Taucherbrille'],
  ],
  cape: [
    ['umhang_rot', 'Roter Umhang'], ['heldencape', 'Heldencape'], ['blaetterumhang', 'Blätterumhang'],
    ['rucksack', 'Rucksack'], ['sternenumhang', 'Sternenumhang'], ['engelsfluegel', 'Engelsflügel'],
  ],
  emote: [
    ['winken', 'Winken'], ['lachen', 'Lachen'], ['zunge', 'Zunge rausstrecken'], ['weinen', 'Weinen'],
    ['tanzen', 'Tanzen'], ['daumen_runter', 'Daumen runter'], ['herz', 'Herz'], ['wut', 'Wut'],
    ['schnarchen', 'Schnarchen'], ['gg', 'GG'],
  ],
  prank: [
    ['bananenschale', 'Bananenschale'], ['konfetti_kanone', 'Konfetti-Kanone'], ['furzkissen', 'Furzkissen'],
    ['verkehrte_welt', 'Verkehrte Welt'], ['tintenklecks', 'Tintenklecks'], ['quietsche_hammer', 'Quietsche-Hammer'],
  ],
};

export const ITEMS: readonly Item[] = (Object.keys(CATALOG) as Category[]).flatMap((cat) =>
  CATALOG[cat].map(([name, label]) => ({ id: `${cat}.${name}`, cat, name, label })),
);
const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

/** Free from the start (spec §7.5); hairstyles, hair colours, skins and "Ohne" are always free too. */
export const FREE_ITEMS: ReadonlySet<ItemId> = new Set([
  'outfit.tunika', 'outfit.latzhose', 'hat.bommelmuetze', 'emote.winken', 'emote.lachen',
  'prank.bananenschale', 'prank.konfetti_kanone',
]);

export const HAIRS: readonly { name: string; label: string }[] = [
  { name: 'kurz', label: 'Kurz' }, { name: 'wuschel', label: 'Wuschelkopf' }, { name: 'zopf', label: 'Zopf' },
  { name: 'glatze_mit_straehne', label: 'Glatze mit Strähne' }, { name: 'locken', label: 'Locken' },
  { name: 'iro', label: 'Irokese' },
];
/** Labels for char-head.ramps.hair[i] (same order). */
export const HAIR_COLORS: readonly string[] = ['Braun', 'Rot', 'Blond', 'Schwarz', 'Grau', 'Grün'];
export const SKIN_COUNT = 4;
export const NONE_LABEL = 'Ohne';

const REWARD_LEVEL = new Map<ItemId, number>(
  Object.entries(P.rewards).map(([level, id]) => [id, Number(level)]),
);
const BOX_POOL: ReadonlySet<ItemId> = new Set(P.boxPool);

export function findItem(id: ItemId): Item | undefined {
  return BY_ID.get(id);
}

export function rewardLevel(id: ItemId): number | null {
  return REWARD_LEVEL.get(id) ?? null;
}

export function isBoxItem(id: ItemId): boolean {
  return BOX_POOL.has(id);
}

/** Free items, every level reward up to the current level and the box items in `unlocked`. */
export function ownedItems(xp: number, unlocked: readonly string[]): Set<ItemId> {
  const owned = new Set<ItemId>(FREE_ITEMS);
  const { level } = levelInfo(xp);
  for (const [id, l] of REWARD_LEVEL) if (l <= level) owned.add(id);
  for (const id of unlocked) if (BOX_POOL.has(id)) owned.add(id);
  return owned;
}

/** The next level reward, or after maxLevel the next surprise box. */
export function nextReward(xp: number): { level: number | null; item: ItemId | 'box'; xpLeft: number } {
  const info = levelInfo(xp);
  const x = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  for (let l = info.level + 1; l <= P.maxLevel; l++) {
    const item = P.rewards[l];
    if (item) return { level: l, item, xpLeft: xpToReach(l) - x };
  }
  return { level: null, item: 'box', xpLeft: info.need - info.into };
}

export function itemLabel(id: ItemId): string {
  return BY_ID.get(id)?.label ?? id;
}

/** Preview sprite of an item. */
export function itemSprite(id: ItemId): string {
  const [cat, name] = id.split('.', 2);
  switch (cat) {
    case 'outfit':
      return name === 'tunika' ? 'char.body.down.idle' : `outfit.${name}.down.idle`;
    case 'emote':
      return `emote.${name}`;
    case 'prank':
      return `streich.${name}.icon`;
    default:
      return `${cat}.${name}.down`;
  }
}

import {
  HAIR_COLORS, HAIRS, isBoxItem, itemLabel, ITEMS, nextReward, NONE_LABEL, ownedItems, rewardLevel, SKIN_COUNT,
  type Category,
} from '../progress/items';
import type { Look, Profile } from '../save/profile';

/** Look editor tabs (spec §7.5). */
export type Tab = 'outfit' | 'hair' | 'hairColor' | 'skin' | 'hat' | 'face' | 'cape' | 'emotes' | 'prank';
export const TAB_TITLES: Record<Tab, string> = {
  outfit: 'Outfit', hair: 'Frisur', hairColor: 'Haarfarbe', skin: 'Haut', hat: 'Hut', face: 'Gesicht', cape: 'Rücken',
  emotes: 'Emotes', prank: 'Streich',
};
export const TABS = Object.keys(TAB_TITLES) as Tab[];

/** One tile of a tab; locked tiles are shown (greyed, with lockText) but cannot be chosen. */
export type Option = { value: string | number | null; label: string; locked: boolean; lockText: string | null; selected: boolean };

const CAT: Partial<Record<Tab, Category>> = { outfit: 'outfit', hat: 'hat', face: 'face', cape: 'cape', emotes: 'emote', prank: 'prank' };
/** Look field each item tab writes. */
const FIELD = { outfit: 'outfit', hat: 'hat', face: 'glasses', cape: 'back', prank: 'prank' } as const;
const OPTIONAL: ReadonlySet<Tab> = new Set(['hat', 'face', 'cape']);

function lockText(id: string): string | null {
  const l = rewardLevel(id);
  if (l !== null) return `ab Level ${l}`;
  return isBoxItem(id) ? 'Überraschungskiste' : null;
}

/** Every option of a tab in catalog order, locked ones included; hat/face/cape start with "Ohne". */
export function lookOptions(p: Profile, tab: Tab): Option[] {
  const look = p.look;
  const open = (value: string | number | null, label: string, selected: boolean): Option =>
    ({ value, label, locked: false, lockText: null, selected });
  if (tab === 'hair') return HAIRS.map((x) => open(x.name, x.label, look.hair === x.name));
  if (tab === 'hairColor') return HAIR_COLORS.map((label, i) => open(i, label, look.hairColor === i));
  if (tab === 'skin') return Array.from({ length: SKIN_COUNT }, (_, i) => open(i, `Hautton ${i + 1}`, look.skin === i));

  const owned = ownedItems(p.xp, p.unlocked);
  const current = (name: string | null): boolean => {
    if (tab === 'emotes') return name !== null && look.emotes.includes(name);
    return look[FIELD[tab as keyof typeof FIELD]] === name;
  };
  const out: Option[] = OPTIONAL.has(tab) ? [open(null, NONE_LABEL, current(null))] : [];
  for (const it of ITEMS) {
    if (it.cat !== CAT[tab]) continue;
    const locked = !owned.has(it.id);
    out.push({ value: it.name, label: it.label, locked, lockText: locked ? lockText(it.id) : null, selected: current(it.name) });
  }
  return out;
}

/** The look with one option of a tab applied (emotes go through assignEmote). */
export function applyOption(look: Look, tab: Exclude<Tab, 'emotes'>, value: string | number | null): Look {
  switch (tab) {
    case 'hairColor':
    case 'skin':
      return typeof value === 'number' ? { ...look, [tab]: value } : look;
    case 'hair':
      return typeof value === 'string' ? { ...look, hair: value } : look;
    case 'outfit':
    case 'prank':
      return typeof value === 'string' ? { ...look, [FIELD[tab]]: value } : look;
    default:
      return typeof value === 'string' || value === null ? { ...look, [FIELD[tab]]: value } : look;
  }
}

/** Put an emote (or nothing) into a slot; if it already sits in another slot, the two slots swap. */
export function assignEmote(slots: readonly (string | null)[], slot: 0 | 1 | 2 | 3, id: string | null): (string | null)[] {
  const out = [...slots];
  const at = id === null ? -1 : out.indexOf(id);
  if (at >= 0 && at !== slot) out[at] = out[slot];
  out[slot] = id;
  return out;
}

/** "Nächste Belohnung: <item> (noch N XP)"; after the max level the next surprise box. */
export function nextRewardText(xp: number): string {
  const r = nextReward(xp);
  const label = r.item === 'box' ? 'Überraschungskiste' : itemLabel(r.item);
  return `Nächste Belohnung: ${label} (noch ${r.xpLeft} XP)`;
}

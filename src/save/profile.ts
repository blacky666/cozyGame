import { CONFIG } from '../config';
import { HAIR_COLORS, HAIRS, isBoxItem, ITEMS, SKIN_COUNT, type Category } from '../progress/items';

/** Current profile format; migrate() reads every version up to this one. */
export const PROFILE_VERSION = 2;
/** Emote slots (slot i = key i + 1). */
export const EMOTE_SLOTS = 4;

export type Look = {
  outfit: string;
  hair: string;
  hairColor: number;
  skin: number;
  hat: string | null;
  glasses: string | null;
  back: string | null;
  /** Always EMOTE_SLOTS long; slot i is key i + 1. */
  emotes: (string | null)[];
  prank: string;
};

export type Profile = {
  v: 2;
  name: string;
  xp: number;
  unlocked: string[];
  look: Look;
  /** Sound sliders as of the last save (live values: src/audio/settings.ts). */
  settings: { music: number; sfx: number; muted: boolean };
  createdAt: string;
  /** Evening whose XP was applied last (settles each evening once). */
  lastEveningId: string | null;
  /** Local day (YYYY-MM-DD) of the last settled evening (day bonus). */
  lastPlayDay: string | null;
};

export function defaultProfile(name = ''): Profile {
  return {
    v: PROFILE_VERSION,
    name,
    xp: 0,
    unlocked: [],
    look: {
      outfit: 'tunika',
      hair: 'kurz',
      hairColor: 0,
      skin: 0,
      hat: 'bommelmuetze',
      glasses: null,
      back: null,
      emotes: ['winken', 'lachen', null, null],
      prank: 'bananenschale',
    },
    settings: { music: 0.6, sfx: 0.8, muted: false },
    createdAt: new Date().toISOString(),
    lastEveningId: null,
    lastPlayDay: null,
  };
}

/** Local calendar day as YYYY-MM-DD. */
export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, d: string): string => (typeof x === 'string' ? x : d);
const strOrNull = (x: unknown, d: string | null): string | null =>
  x === null ? null : typeof x === 'string' ? x : d;
const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const names = (cat: Category): ReadonlySet<string> => new Set(ITEMS.filter((i) => i.cat === cat).map((i) => i.name));
const KNOWN = {
  outfit: names('outfit'), hat: names('hat'), face: names('face'), cape: names('cape'), emote: names('emote'), prank: names('prank'),
  hair: new Set(HAIRS.map((h) => h.name)),
};
/** A known name, else the default. */
const known = (set: ReadonlySet<string>, x: unknown, d: string): string => (typeof x === 'string' && set.has(x) ? x : d);
/** A known name or null, else the default. */
const knownOrNull = (set: ReadonlySet<string>, x: unknown, d: string | null): string | null =>
  x === null ? null : typeof x === 'string' && set.has(x) ? x : d;
const intIn = (x: unknown, d: number, max: number): number => Math.min(max, Math.max(0, Math.round(num(x, d))));

/** Exactly EMOTE_SLOTS slots; unknown ids become null, a repeated id keeps only its first slot. */
function emoteSlots(x: unknown, d: (string | null)[]): (string | null)[] {
  if (!Array.isArray(x)) return [...d];
  const seen = new Set<string>();
  const out: (string | null)[] = [];
  for (let i = 0; i < EMOTE_SLOTS; i++) {
    const e: unknown = x[i];
    if (typeof e === 'string' && KNOWN.emote.has(e) && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    } else out.push(null);
  }
  return out;
}

/**
 * Coerce arbitrary data (any version up to PROFILE_VERSION) into a valid current Profile, filling gaps
 * with defaults. Ids are checked against the catalog but not against ownership: the host also runs this
 * on remote looks, which come without XP.
 */
export function migrate(raw: unknown): Profile {
  const d = defaultProfile();
  if (!isObj(raw)) return d;
  const l = isObj(raw.look) ? raw.look : {};
  const s = isObj(raw.settings) ? raw.settings : {};
  return {
    v: PROFILE_VERSION,
    name: str(raw.name, d.name).trim().slice(0, CONFIG.players.maxName) || d.name,
    xp: Math.max(0, num(raw.xp, d.xp)),
    unlocked: Array.isArray(raw.unlocked)
      ? [...new Set(raw.unlocked.filter((e): e is string => typeof e === 'string' && isBoxItem(e)))]
      : d.unlocked,
    look: {
      outfit: known(KNOWN.outfit, l.outfit, d.look.outfit),
      hair: known(KNOWN.hair, l.hair, d.look.hair),
      hairColor: intIn(l.hairColor, d.look.hairColor, HAIR_COLORS.length - 1),
      skin: intIn(l.skin, d.look.skin, SKIN_COUNT - 1),
      hat: knownOrNull(KNOWN.hat, l.hat, d.look.hat),
      glasses: knownOrNull(KNOWN.face, l.glasses, d.look.glasses),
      back: knownOrNull(KNOWN.cape, l.back, d.look.back),
      emotes: emoteSlots(l.emotes, d.look.emotes),
      prank: known(KNOWN.prank, l.prank, d.look.prank),
    },
    settings: {
      music: Math.min(1, Math.max(0, num(s.music, d.settings.music))),
      sfx: Math.min(1, Math.max(0, num(s.sfx, d.settings.sfx))),
      muted: typeof s.muted === 'boolean' ? s.muted : d.settings.muted,
    },
    createdAt: str(raw.createdAt, d.createdAt),
    lastEveningId: strOrNull(raw.lastEveningId, null),
    lastPlayDay: strOrNull(raw.lastPlayDay, null),
  };
}

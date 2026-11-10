export type Look = {
  outfit: string;
  hair: string;
  hairColor: number;
  skin: number;
  hat: string | null;
  glasses: string | null;
  back: string | null;
  emotes: string[];
  prank: string | null;
};

export type Profile = {
  v: 1;
  name: string;
  xp: number;
  unlocked: string[];
  look: Look;
  settings: { music: number; sfx: number };
  createdAt: string;
};

export function defaultProfile(name = ''): Profile {
  return {
    v: 1,
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
      emotes: ['winken', 'lachen'],
      prank: null,
    },
    settings: { music: 0.6, sfx: 0.8 },
    createdAt: new Date().toISOString(),
  };
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, d: string): string => (typeof x === 'string' ? x : d);
const strOrNull = (x: unknown, d: string | null): string | null =>
  x === null ? null : typeof x === 'string' ? x : d;
const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const strArr = (x: unknown, d: string[]): string[] =>
  Array.isArray(x) && x.every((e) => typeof e === 'string') ? (x as string[]) : d;

/** Coerce arbitrary data into a valid Profile, filling gaps with defaults. */
export function migrate(raw: unknown): Profile {
  const d = defaultProfile();
  if (!isObj(raw)) return d;
  const l = isObj(raw.look) ? raw.look : {};
  const s = isObj(raw.settings) ? raw.settings : {};
  return {
    v: 1,
    name: str(raw.name, d.name),
    xp: Math.max(0, num(raw.xp, d.xp)),
    unlocked: strArr(raw.unlocked, d.unlocked),
    look: {
      outfit: str(l.outfit, d.look.outfit),
      hair: str(l.hair, d.look.hair),
      hairColor: num(l.hairColor, d.look.hairColor),
      skin: num(l.skin, d.look.skin),
      hat: strOrNull(l.hat, d.look.hat),
      glasses: strOrNull(l.glasses, d.look.glasses),
      back: strOrNull(l.back, d.look.back),
      emotes: strArr(l.emotes, d.look.emotes),
      prank: strOrNull(l.prank, d.look.prank),
    },
    settings: {
      music: Math.min(1, Math.max(0, num(s.music, d.settings.music))),
      sfx: Math.min(1, Math.max(0, num(s.sfx, d.settings.sfx))),
    },
    createdAt: str(raw.createdAt, d.createdAt),
  };
}

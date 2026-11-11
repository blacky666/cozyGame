/** Bus a sound plays on: music has its own slider, effects and jingles share the effects slider. */
export type SoundKind = 'effekt' | 'jingle' | 'musik';

export type SoundDef = {
  /** "<paket>.<name>", e.g. "schneeball.wurf". */
  id: string;
  /** Variant files relative to the site root (one is picked at random per play). */
  files: string[];
  kind: SoundKind;
  loop: boolean;
  /** Base volume 0..1 from the manifest. */
  volume: number;
};

const KINDS: readonly SoundKind[] = ['effekt', 'jingle', 'musik'];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Relative audio paths only: no scheme, no parent dirs, no leading slash. */
const SAFE_PATH = /^audio\/[a-z0-9_]+\/[a-z0-9_.-]+\.mp3$/;

/**
 * Parse a package's sounds.json (format from work-files/claude-design-sounds-prompt.md). Entries
 * that do not fit are skipped with a warning; one broken entry never drops the whole package.
 */
export function parseManifest(raw: unknown, warn: (msg: string) => void = () => {}): SoundDef[] {
  if (!isObj(raw) || !Array.isArray(raw.toene)) {
    warn('sounds.json: missing "toene" list');
    return [];
  }
  const out: SoundDef[] = [];
  const seen = new Set<string>();
  for (const e of raw.toene) {
    if (!isObj(e) || typeof e.id !== 'string' || !e.id.includes('.')) {
      warn(`sounds.json: entry without a valid id skipped`);
      continue;
    }
    const files = (Array.isArray(e.datei) ? e.datei : [e.datei]).filter(
      (f): f is string => typeof f === 'string' && SAFE_PATH.test(f),
    );
    if (files.length === 0) {
      warn(`sounds.json: ${e.id} has no usable file`);
      continue;
    }
    if (seen.has(e.id)) {
      warn(`sounds.json: duplicate id ${e.id} skipped`);
      continue;
    }
    seen.add(e.id);
    const kind = KINDS.includes(e.art as SoundKind) ? (e.art as SoundKind) : 'effekt';
    const vol = typeof e.lautstaerke === 'number' && Number.isFinite(e.lautstaerke) ? e.lautstaerke : 1;
    out.push({ id: e.id, files, kind, loop: e.schleife === true, volume: Math.min(1, Math.max(0, vol)) });
  }
  return out;
}

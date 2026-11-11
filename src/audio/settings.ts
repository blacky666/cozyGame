import { loadProfile } from '../save/storage';

export type SoundSettings = { music: number; sfx: number; muted: boolean };

export const SOUND_KEY = 'cozygame.sound';
export const DEFAULT_SOUND: SoundSettings = { music: 0.6, sfx: 0.8, muted: false };

const clamp01 = (x: unknown, d: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d;

/** Coerce anything into valid settings (gaps from `base`). */
export function coerceSound(raw: unknown, base: SoundSettings = DEFAULT_SOUND): SoundSettings {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    music: clamp01(o.music, base.music),
    sfx: clamp01(o.sfx, base.sfx),
    muted: typeof o.muted === 'boolean' ? o.muted : base.muted,
  };
}

/**
 * Own storage key (not the profile object): the menus hold profile copies in memory and save them
 * whole, which would overwrite a slider change made meanwhile. The save file still carries the
 * settings (profile.settings, filled from here when saving). First run: taken from the profile.
 */
export function loadSound(storage?: Storage): SoundSettings {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(SOUND_KEY);
    if (raw !== null) return coerceSound(JSON.parse(raw));
  } catch {
    // storage blocked or broken JSON: fall through to the profile
  }
  return coerceSound(loadProfile(storage).settings);
}

export function saveSound(s: SoundSettings, storage?: Storage): void {
  try {
    (storage ?? globalThis.localStorage).setItem(SOUND_KEY, JSON.stringify(s));
  } catch {
    // private mode etc.: settings only last for this page
  }
}

/** Effective gain of a bus (0 when muted). */
export function busGain(s: SoundSettings, bus: 'music' | 'sfx'): number {
  return s.muted ? 0 : s[bus];
}

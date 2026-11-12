import { defaultProfile, migrate, PROFILE_VERSION, type Profile } from './profile';

export const PROFILE_KEY = 'cozygame.profile';
export const BROKEN_KEY = 'cozygame.profile.broken';

let warned = false;
function warnOnce(e: unknown): void {
  if (warned) return;
  warned = true;
  console.warn('cozygame: profile storage unavailable', e);
}

/** Versions 1..PROFILE_VERSION are migrated; anything else is backed up first. */
const isKnownVersion = (v: unknown): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= PROFILE_VERSION;

export function loadProfile(storage?: Storage): Profile {
  let store: Storage;
  let raw: string | null;
  try {
    store = storage ?? globalThis.localStorage;
    raw = store.getItem(PROFILE_KEY);
  } catch (e) {
    warnOnce(e);
    return defaultProfile();
  }
  if (raw === null) return defaultProfile();
  let parsed: unknown;
  let valid = false;
  try {
    parsed = JSON.parse(raw);
    valid =
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      isKnownVersion((parsed as { v?: unknown }).v);
  } catch {
    valid = false;
  }
  if (!valid) {
    // keep the original value so a broken or foreign profile is never lost silently
    try {
      store.setItem(BROKEN_KEY, raw);
    } catch (e) {
      warnOnce(e);
    }
  }
  return valid ? migrate(parsed) : migrate(parsed === undefined ? null : parsed);
}

export function saveProfile(p: Profile, storage?: Storage): void {
  try {
    (storage ?? globalThis.localStorage).setItem(PROFILE_KEY, JSON.stringify(p));
  } catch (e) {
    warnOnce(e);
  }
}

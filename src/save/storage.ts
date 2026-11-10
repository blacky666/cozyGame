import { defaultProfile, migrate, type Profile } from './profile';

export const PROFILE_KEY = 'cozygame.profile';
export const BROKEN_KEY = 'cozygame.profile.broken';

export function loadProfile(storage: Storage = globalThis.localStorage): Profile {
  let raw: string | null = null;
  try {
    raw = storage.getItem(PROFILE_KEY);
  } catch {
    return defaultProfile();
  }
  if (raw === null) return defaultProfile();
  try {
    return migrate(JSON.parse(raw));
  } catch {
    try {
      storage.setItem(BROKEN_KEY, raw);
    } catch {
      /* storage unavailable or full */
    }
    return defaultProfile();
  }
}

export function saveProfile(p: Profile, storage: Storage = globalThis.localStorage): void {
  storage.setItem(PROFILE_KEY, JSON.stringify(p));
}

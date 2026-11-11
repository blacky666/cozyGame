declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

// Injected by Vite `define` from package.json; falls back outside Vite (e.g. tsx).
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

/** Build time as ISO string (empty outside Vite). */
export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

/** "Version 0.2.0 · 11.11.2026 10:45" in the player's local time zone. */
export function versionLabel(version = APP_VERSION, buildTime = BUILD_TIME): string {
  const d = new Date(buildTime);
  if (!buildTime || Number.isNaN(d.getTime())) return `Version ${version}`;
  const p = (n: number) => String(n).padStart(2, '0');
  return `Version ${version} · ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

declare const __APP_VERSION__: string;

// Injected by Vite `define` from package.json; falls back outside Vite (e.g. tsx).
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

import { describe, expect, it } from 'vitest';
import { versionLabel } from './version';

describe('versionLabel', () => {
  it('shows version and local build date/time', () => {
    const iso = new Date(2026, 10, 11, 9, 5).toISOString();
    expect(versionLabel('0.2.0', iso)).toBe('Version 0.2.0 · 11.11.2026 09:05');
  });
  it('falls back to the version alone without a valid build time', () => {
    expect(versionLabel('0.2.0', '')).toBe('Version 0.2.0');
    expect(versionLabel('0.2.0', 'kaputt')).toBe('Version 0.2.0');
  });
});

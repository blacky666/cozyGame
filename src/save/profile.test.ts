import { describe, it, expect, vi } from 'vitest';
import { defaultProfile, migrate } from './profile';
import { loadProfile, saveProfile } from './storage';

function stub(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  };
}

describe('migrate', () => {
  it('returns defaults for null', () => {
    const a = migrate(null);
    const b = defaultProfile();
    expect({ ...a, createdAt: '' }).toEqual({ ...b, createdAt: '' });
  });
  it('trims and limits the name to CONFIG.players.maxName', () => {
    expect(migrate({ name: '  ' + 'x'.repeat(40) }).name).toBe('x'.repeat(16));
  });
  it('keeps string name and resets invalid xp', () => {
    const p = migrate({ name: 'Mo', xp: 'x' });
    expect(p.name).toBe('Mo');
    expect(p.xp).toBe(0);
  });
  it('has the specified defaults', () => {
    const p = defaultProfile('A');
    expect(p.look).toEqual({ outfit: 'tunika', hair: 'kurz', hairColor: 0, skin: 0, hat: 'bommelmuetze', glasses: null, back: null, emotes: ['winken', 'lachen'], prank: null });
    expect(p.settings).toEqual({ music: 0.6, sfx: 0.8, muted: false });
  });
});

describe('storage', () => {
  it('falls back to defaults and backs up broken raw value', () => {
    const s = stub({ 'cozygame.profile': '{broken' });
    const p = loadProfile(s);
    expect(p.v).toBe(1);
    expect(s.getItem('cozygame.profile.broken')).toBe('{broken');
  });
  it('round trips through save/load', () => {
    const s = stub();
    const p = defaultProfile('Lu');
    saveProfile(p, s);
    expect(loadProfile(s)).toEqual(p);
  });
  it('returns defaults when nothing stored', () => {
    expect(loadProfile(stub()).v).toBe(1);
  });

  it('does not throw when storage methods throw', () => {
    const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } } as unknown as Storage;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadProfile(bad).v).toBe(1);
    expect(() => saveProfile(defaultProfile('A'), bad)).not.toThrow();
  });
  it('does not throw when localStorage getter throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    try {
      expect(loadProfile().v).toBe(1);
      expect(() => saveProfile(defaultProfile('A'))).not.toThrow();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
      vi.unstubAllGlobals();
    }
  });
  it.each(['null', '[]', '5', '{"v":2,"name":"Z"}', '{"name":"Z"}'])('backs up valid-JSON non-v1 value %s', (raw) => {
    const s = stub({ 'cozygame.profile': raw });
    expect(loadProfile(s).v).toBe(1);
    expect(s.getItem('cozygame.profile.broken')).toBe(raw);
  });
  it('does not back up a valid v1 profile', () => {
    const s = stub();
    saveProfile(defaultProfile('Q'), s);
    loadProfile(s);
    expect(s.getItem('cozygame.profile.broken')).toBeNull();
  });
});

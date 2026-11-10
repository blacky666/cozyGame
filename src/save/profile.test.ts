import { describe, it, expect } from 'vitest';
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
  it('keeps string name and resets invalid xp', () => {
    const p = migrate({ name: 'Mo', xp: 'x' });
    expect(p.name).toBe('Mo');
    expect(p.xp).toBe(0);
  });
  it('has the specified defaults', () => {
    const p = defaultProfile('A');
    expect(p.look).toEqual({ outfit: 'tunika', hair: 'kurz', hairColor: 0, skin: 0, hat: 'bommelmuetze', glasses: null, back: null, emotes: ['winken', 'lachen'], prank: null });
    expect(p.settings).toEqual({ music: 0.6, sfx: 0.8 });
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
});

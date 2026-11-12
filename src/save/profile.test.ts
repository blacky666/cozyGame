import { describe, it, expect, vi } from 'vitest';
import { defaultProfile, localDay, migrate, PROFILE_VERSION } from './profile';
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
    expect(p.look).toEqual({ outfit: 'tunika', hair: 'kurz', hairColor: 0, skin: 0, hat: 'bommelmuetze', glasses: null, back: null, emotes: ['winken', 'lachen', null, null], prank: 'bananenschale' });
    expect(p.v).toBe(2);
    expect(PROFILE_VERSION).toBe(2);
    expect([p.lastEveningId, p.lastPlayDay]).toEqual([null, null]);
    expect(p.settings).toEqual({ music: 0.6, sfx: 0.8, muted: false });
  });
});

const V1 = {
  v: 1, name: 'Mo', xp: 300, unlocked: [],
  look: { outfit: 'tunika', hair: 'kurz', hairColor: 0, skin: 0, hat: 'bommelmuetze', glasses: null, back: null, emotes: ['winken', 'lachen'], prank: null },
  settings: { music: 0.6, sfx: 0.8, muted: false }, createdAt: '2026-11-01T00:00:00.000Z',
};

describe('migrate v1 -> v2', () => {
  it('migrates a v1 profile', () => {
    const p = migrate(V1);
    expect(p.v).toBe(2);
    expect(p.xp).toBe(300);
    expect(p.look.emotes).toEqual(['winken', 'lachen', null, null]);
    expect(p.look.prank).toBe('bananenschale');
    expect(p.lastEveningId).toBeNull();
    expect(p.lastPlayDay).toBeNull();
    expect(p.createdAt).toBe(V1.createdAt);
  });
  it('sanitizes a remote look', () => {
    const l = migrate({ look: { hat: 'gurke', glasses: 'x', emotes: ['herz', 'herz', 'nope', 'gg', 'wut'], hairColor: 9, skin: -1 } }).look;
    expect(l.hat).toBe('bommelmuetze');
    expect(l.glasses).toBeNull();
    expect(l.emotes).toEqual(['herz', null, null, 'gg']);
    expect(l.hairColor).toBe(5);
    expect(l.skin).toBe(0);
  });
  it('keeps known ids, null accessories and rounds colours to integers', () => {
    const l = migrate({ look: { outfit: 'ruestung', hair: 'iro', hat: null, back: 'cape.rucksack', glasses: 'sonnenbrille', prank: 'furzkissen', hairColor: 2.6, skin: 2 } }).look;
    expect(l).toMatchObject({ outfit: 'ruestung', hair: 'iro', hat: null, back: null, glasses: 'sonnenbrille', prank: 'furzkissen', hairColor: 3, skin: 2 });
  });
  it('falls back to the default for unknown outfit, hair and prank', () => {
    const l = migrate({ look: { outfit: 'bikini', hair: 'glatze', prank: 'bombe', back: 'rucksack', emotes: 'winken' } }).look;
    expect(l).toMatchObject({ outfit: 'tunika', hair: 'kurz', prank: 'bananenschale', back: 'rucksack' });
    expect(l.emotes).toEqual(['winken', 'lachen', null, null]);
  });
  it('keeps only box pool items in unlocked and string markers', () => {
    const p = migrate({ v: 2, unlocked: ['hat.bauhelm', 'hat.zylinder', 'foo', 'hat.bauhelm'], lastEveningId: 'abc', lastPlayDay: 7 });
    expect(p.unlocked).toEqual(['hat.bauhelm']);
    expect(p.lastEveningId).toBe('abc');
    expect(p.lastPlayDay).toBeNull();
  });
});

describe('localDay', () => {
  it('formats the local date', () => {
    expect(localDay(new Date(2026, 10, 12, 23, 59))).toBe('2026-11-12');
    expect(localDay(new Date(2026, 0, 3, 0, 0))).toBe('2026-01-03');
  });
});

describe('storage', () => {
  it('keeps a v1 profile and does not back it up', () => {
    const s = stub({ 'cozygame.profile': JSON.stringify(V1) });
    const p = loadProfile(s);
    expect(p.v).toBe(2);
    expect(p.xp).toBe(300);
    expect(p.name).toBe('Mo');
    expect(s.getItem('cozygame.profile.broken')).toBeNull();
  });
  it('falls back to defaults and backs up broken raw value', () => {
    const s = stub({ 'cozygame.profile': '{broken' });
    const p = loadProfile(s);
    expect(p.v).toBe(2);
    expect(s.getItem('cozygame.profile.broken')).toBe('{broken');
  });
  it('round trips through save/load', () => {
    const s = stub();
    const p = defaultProfile('Lu');
    saveProfile(p, s);
    expect(loadProfile(s)).toEqual(p);
  });
  it('returns defaults when nothing stored', () => {
    expect(loadProfile(stub()).v).toBe(2);
  });

  it('does not throw when storage methods throw', () => {
    const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } } as unknown as Storage;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadProfile(bad).v).toBe(2);
    expect(() => saveProfile(defaultProfile('A'), bad)).not.toThrow();
  });
  it('does not throw when localStorage getter throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    try {
      expect(loadProfile().v).toBe(2);
      expect(() => saveProfile(defaultProfile('A'))).not.toThrow();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
      vi.unstubAllGlobals();
    }
  });
  it.each(['null', '[]', '5', '{"v":3,"name":"Z"}', '{"name":"Z"}'])('backs up valid-JSON unknown-version value %s', (raw) => {
    const s = stub({ 'cozygame.profile': raw });
    expect(loadProfile(s).v).toBe(2);
    expect(s.getItem('cozygame.profile.broken')).toBe(raw);
  });
  it('does not back up a valid current profile', () => {
    const s = stub();
    saveProfile(defaultProfile('Q'), s);
    loadProfile(s);
    expect(s.getItem('cozygame.profile.broken')).toBeNull();
  });
});

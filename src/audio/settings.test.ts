import { describe, expect, it } from 'vitest';
import { PROFILE_KEY } from '../save/storage';
import { busGain, coerceSound, DEFAULT_SOUND, loadSound, saveSound, SOUND_KEY } from './settings';

const memory = (init: Record<string, string> = {}): Storage => {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
};

describe('sound settings', () => {
  it('clamps and fills gaps', () => {
    expect(coerceSound({ music: 3, sfx: -1, muted: 'ja' })).toEqual({ music: 1, sfx: 0, muted: false });
    expect(coerceSound(null)).toEqual(DEFAULT_SOUND);
  });

  it('first run takes the profile sliders, afterwards its own key', () => {
    const st = memory({ [PROFILE_KEY]: JSON.stringify({ v: 1, settings: { music: 0.2, sfx: 0.3 } }) });
    expect(loadSound(st)).toEqual({ music: 0.2, sfx: 0.3, muted: false });
    saveSound({ music: 0.9, sfx: 0.1, muted: true }, st);
    expect(JSON.parse(st.getItem(SOUND_KEY)!)).toEqual({ music: 0.9, sfx: 0.1, muted: true });
    expect(loadSound(st)).toEqual({ music: 0.9, sfx: 0.1, muted: true });
  });

  it('survives broken JSON in its key', () => {
    expect(loadSound(memory({ [SOUND_KEY]: '{oops' }))).toEqual(DEFAULT_SOUND);
  });

  it('mute zeroes both buses', () => {
    const s = { music: 0.5, sfx: 0.7, muted: false };
    expect(busGain(s, 'music')).toBe(0.5);
    expect(busGain(s, 'sfx')).toBe(0.7);
    expect(busGain({ ...s, muted: true }, 'sfx')).toBe(0);
  });
});

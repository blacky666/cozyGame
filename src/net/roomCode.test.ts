import { describe, expect, it } from 'vitest';
import { generateRoomCode, normalizeRoomCode, ROOM_WORDS } from './roomCode';

describe('normalizeRoomCode', () => {
  it('handles decomposed umlauts (NFD)', () => {
    expect(normalizeRoomCode('käse 42')).toBe('KAESE-42');
  });
  it('maps umlauts and spaces', () => {
    expect(normalizeRoomCode('käse 42')).toBe('KAESE-42');
  });
  it('accepts en/em dashes as separator', () => {
    expect(normalizeRoomCode('kaese–42')).toBe('KAESE-42');
    expect(normalizeRoomCode('kaese—42')).toBe('KAESE-42');
  });
  it('accepts a missing separator before the 2 digits', () => {
    expect(normalizeRoomCode('kaese42')).toBe('KAESE-42');
    expect(normalizeRoomCode('käse42')).toBe('KAESE-42');
  });
  it('trims and uppercases', () => {
    expect(normalizeRoomCode(' kaese-42 ')).toBe('KAESE-42');
  });
  it('handles sz, underscores and repeated dashes', () => {
    expect(normalizeRoomCode('fuß__--12')).toBe('FUSS-12');
  });
  it('rejects invalid input', () => {
    expect(normalizeRoomCode('x')).toBeNull();
    expect(normalizeRoomCode('kaese-4')).toBeNull();
    expect(normalizeRoomCode('')).toBeNull();
  });
});

describe('generateRoomCode', () => {
  it('has a big enough ASCII word list', () => {
    expect(ROOM_WORDS.length).toBeGreaterThanOrEqual(40);
    for (const w of ROOM_WORDS) expect(w, w).toMatch(/^[A-Z]{3,12}$/);
  });
  it('always yields normalized codes', () => {
    for (let i = 0; i < 1000; i++) {
      const c = generateRoomCode();
      expect(normalizeRoomCode(c)).toBe(c);
    }
  });
  it('covers number edges with custom rand', () => {
    expect(generateRoomCode(() => 0)).toMatch(/-10$/);
    expect(generateRoomCode(() => 0.999999)).toMatch(/-99$/);
  });
});

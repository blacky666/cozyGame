import { describe, expect, it } from 'vitest';
import { isMobile } from './mobile';

describe('isMobile', () => {
  it('detects a phone', () => {
    expect(isMobile({ maxTouchPoints: 5, userAgent: 'iPhone' }, 390)).toBe(true);
  });
  it('detects a desktop', () => {
    expect(isMobile({ maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 1920)).toBe(false);
  });
  it('treats a narrow touch device as mobile', () => {
    expect(isMobile({ maxTouchPoints: 2, userAgent: 'Mozilla/5.0' }, 800)).toBe(true);
  });
  it('keeps a wide touch laptop as desktop', () => {
    expect(isMobile({ maxTouchPoints: 10, userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, 1366)).toBe(false);
  });
  it('detects a mobile UA at any width', () => {
    expect(isMobile({ maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Linux; Android 14)' }, 1200)).toBe(true);
  });
});

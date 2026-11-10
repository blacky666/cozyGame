import { describe, it, expect, vi } from 'vitest';
import { defaultProfile } from './profile';
import { encodeSave, decodeSave, saveFileName } from './saveFile';

describe('saveFile', () => {
  it('round trips', async () => {
    const p = { ...defaultProfile('Mo'), xp: 42 };
    const r = await decodeSave(await encodeSave(p));
    expect(r).toEqual({ ok: true, profile: p });
  });
  it('detects tampered payload', async () => {
    const t = await encodeSave(defaultProfile('Mo'));
    const [h, payload, sum] = t.split('.');
    const flipped = (payload[0] === 'A' ? 'B' : 'A') + payload.slice(1);
    expect(await decodeSave([h, flipped, sum].join('.'))).toEqual({ ok: false, reason: 'checksum' });
  });
  it('detects wrong checksum for unchanged payload', async () => {
    const t = await encodeSave(defaultProfile('Mo'));
    const [h, payload, sum] = t.split('.');
    const bad = (sum[0] === 'a' ? 'b' : 'a') + sum.slice(1);
    expect(await decodeSave([h, payload, bad].join('.'))).toEqual({ ok: false, reason: 'checksum' });
  });
  it('rejects a checksum from a different secret', async () => {
    const t = await encodeSave(defaultProfile('Mo'));
    const [h, payload] = t.split('.');
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    );
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('other-secret|1|' + json));
    const hex = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await decodeSave([h, payload, hex].join('.'))).toEqual({ ok: false, reason: 'checksum' });
  });
  it('rejects garbage as format', async () => {
    expect(await decodeSave('hello')).toEqual({ ok: false, reason: 'format' });
  });
  it('rejects other versions', async () => {
    const t = await encodeSave(defaultProfile('Mo'));
    expect(await decodeSave(t.replace('COZYSAVE1.', 'COZYSAVE9.'))).toEqual({ ok: false, reason: 'version' });
  });
  it('does not contain the name in plain text', async () => {
    expect(await encodeSave(defaultProfile('Zebulon'))).not.toContain('Zebulon');
  });
  it('keeps umlauts', async () => {
    const r = await decodeSave(await encodeSave(defaultProfile('Jörg')));
    expect(r.ok && r.profile.name).toBe('Jörg');
  });
  it('runs a validly signed non-profile object through migrate', async () => {
    // build a valid save around a non-profile JSON via encode of a hacked object
    const t = await encodeSave({ foo: 1, name: 'X' } as never);
    const r = await decodeSave(t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profile.name).toBe('X');
      expect(r.profile.look.outfit).toBe('tunika');
      expect(r.profile.v).toBe(1);
    }
  });
  it('builds a sanitized file name', () => {
    expect(saveFileName(defaultProfile('Jörg M!'), new Date(2026, 10, 9))).toBe('cozyGame-J_rg_M_-2026-11-09.cozysave');
  });
  it('returns format when crypto.subtle is unavailable', async () => {
    const t = await encodeSave(defaultProfile('Mo'));
    vi.stubGlobal('crypto', {});
    try {
      expect(await decodeSave(t)).toEqual({ ok: false, reason: 'format' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

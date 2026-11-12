import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../save/profile';
import { Roster } from './roster';

const look = defaultProfile().look;
const lobby = { running: false };
const running = { running: true };

function fill(r: Roster, n: number): void {
  for (let i = 0; i < n; i++) r.join(`p${i}`, `N${i}`, look, 0, lobby);
}

describe('Roster', () => {
  it('fills slots 0-3 and rejects the 5th as full', () => {
    const r = new Roster();
    const slots = ['A', 'B', 'C', 'D'].map((n) => {
      const res = r.join(n.toLowerCase(), n, look, 0, lobby);
      if (!res.ok) throw new Error('join failed');
      return res.player.slot;
    });
    expect(slots).toEqual([0, 1, 2, 3]);
    expect(r.join('e', 'E', look, 0, lobby)).toEqual({ ok: false, reason: 'full' });
  });

  it('rejects the same name as a connected player', () => {
    const r = new Roster();
    r.join('a', 'Anna', look, 0, lobby);
    expect(r.join('b', 'Anna', look, 0, lobby)).toEqual({ ok: false, reason: 'name' });
  });

  it('reclaims a disconnected slot by name within the grace period while running', () => {
    const r = new Roster();
    fill(r, 1);
    r.join('b', 'Bert', look, 0, lobby);
    r.join('c', 'Cleo', look, 0, lobby);
    r.leave('b', 0);
    expect(r.list().find((p) => p.name === 'Bert')).toMatchObject({ connected: false, disconnectedAt: 0 });
    const res = r.join('b2', 'Bert', look, 59000, running);
    expect(res).toMatchObject({ ok: true, reclaimed: true, player: { id: 'b2', slot: 1, connected: true } });
    if (res.ok) expect(res.player.disconnectedAt).toBeUndefined();
  });

  it('refuses reclaiming after the grace period with running', () => {
    const r = new Roster();
    fill(r, 1);
    r.join('b', 'Bert', look, 0, lobby);
    r.leave('b', 0);
    expect(r.join('b2', 'Bert', look, 61000, running)).toEqual({ ok: false, reason: 'running' });
  });

  it('refuses a new name while running', () => {
    const r = new Roster();
    fill(r, 2);
    expect(r.join('x', 'Neu', look, 0, running)).toEqual({ ok: false, reason: 'running' });
  });

  it('expire returns players past the grace period and frees their slot', () => {
    const r = new Roster();
    fill(r, 1);
    r.join('b', 'Bert', look, 0, lobby);
    r.leave('b', 0);
    expect(r.expire(59000)).toEqual([]);
    const gone = r.expire(61000);
    expect(gone.map((p) => p.name)).toEqual(['Bert']);
    expect(r.list().map((p) => p.name)).toEqual(['N0']);
    const res = r.join('c', 'Cleo', look, 61000, lobby);
    expect(res).toMatchObject({ ok: true, player: { slot: 1 } });
  });

  it('stores level and stars (default 1 / 0) and setProfile reports changes', () => {
    const r = new Roster();
    r.join('a', 'Anna', look, 0, { running: false, level: 7, stars: 2 });
    r.join('b', 'Bert', look, 0, lobby);
    expect(r.get('a')).toMatchObject({ level: 7, stars: 2 });
    expect(r.get('b')).toMatchObject({ level: 1, stars: 0 });
    const hatless = { ...look, hat: null };
    expect(r.setProfile('b', hatless, 3, 0)).toBe(true);
    expect(r.get('b')).toMatchObject({ level: 3, stars: 0, look: { hat: null } });
    expect(r.setProfile('b', { ...hatless, emotes: [...hatless.emotes] }, 3, 0)).toBe(false);
    expect(r.setProfile('nobody', look, 3, 0)).toBe(false);
  });

  it('a reclaimed slot takes the new level and stars', () => {
    const r = new Roster();
    r.join('a', 'Anna', look, 0, lobby);
    r.leave('a', 0);
    r.join('a2', 'Anna', look, 10, { running: true, level: 4, stars: 1 });
    expect(r.get('a2')).toMatchObject({ level: 4, stars: 1 });
  });

  it('remove frees a slot immediately and setReady toggles readiness', () => {
    const r = new Roster();
    fill(r, 2);
    expect(r.setReady('p1', true)).toBe(true);
    expect(r.get('p1')?.ready).toBe(true);
    r.remove('p0');
    expect(r.list().map((p) => p.slot)).toEqual([1]);
    expect(r.join('z', 'Zoe', look, 0, lobby)).toMatchObject({ ok: true, player: { slot: 0 } });
  });
});

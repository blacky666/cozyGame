import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../save/profile';
import type { PlayerInfo, Slot } from '../net/roster';
import { lobbyModel } from './lobbyModel';

const p = (slot: Slot, ready: boolean, connected = true): PlayerInfo => ({
  id: `id${slot}`,
  slot,
  name: `P${slot}`,
  look: defaultProfile().look,
  connected,
  ready,
  isBot: false,
  level: 1,
  stars: 0,
});

describe('lobbyModel', () => {
  it('waits for players when alone', () => {
    const m = lobbyModel([p(0, true)], 'id0', true, 6);
    expect(m.canStart).toBe(false);
    expect(m.startHint).toBe('Warte auf Mitspieler …');
  });
  it('waits for ready when one is not ready', () => {
    const m = lobbyModel([p(0, true), p(1, false)], 'id0', true, 6);
    expect(m.canStart).toBe(false);
    expect(m.startHint).toBe('Warte, bis alle bereit sind …');
  });
  it('allows the host to start when all are ready', () => {
    const m = lobbyModel([p(0, true), p(1, true)], 'id0', true, 6);
    expect(m.canStart).toBe(true);
    expect(m.startHint).toBe('');
  });
  it('never lets a non-host start', () => {
    expect(lobbyModel([p(0, true), p(1, true)], 'id1', false, 6).canStart).toBe(false);
  });
  it('ignores disconnected players and fills 4 slots', () => {
    const m = lobbyModel([p(0, true), p(2, false, false)], 'id0', true, 6);
    expect(m.slots).toHaveLength(4);
    expect(m.slots[1]).toBeNull();
    expect(m.slots[2]?.connected).toBe(false);
    expect(m.slots[0]?.isSelf).toBe(true);
    expect(m.startHint).toBe('Warte auf Mitspieler …');
  });
});

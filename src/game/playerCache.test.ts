import { describe, expect, it } from 'vitest';
import type { PlayerInfo } from '../net/roster';
import { defaultProfile } from '../save/profile';
import { createPlayerCache } from './playerCache';

const p = (slot: 0 | 1 | 2 | 3, name: string, connected = true): PlayerInfo => ({
  id: `id-${name}`, slot, name, look: defaultProfile().look, connected, ready: true, isBot: false, level: 1, stars: 0,
});

describe('createPlayerCache', () => {
  it('keeps players (by PlayerKey) after they vanish from the roster', () => {
    let roster = [p(0, 'Anna'), p(1, 'Ben'), p(2, 'Cleo')];
    const players = createPlayerCache(() => roster);
    expect(players().map((x) => x.name)).toEqual(['Anna', 'Ben', 'Cleo']);
    roster = [p(0, 'Anna'), p(2, 'Cleo')]; // Ben's grace expired
    expect(players().map((x) => x.name)).toEqual(['Anna', 'Ben', 'Cleo']);
    expect(players()[1]).toMatchObject({ slot: 1, connected: false });
  });

  it('updates entries from the live roster (e.g. new peer id after a reconnect)', () => {
    let roster = [p(0, 'Anna'), p(1, 'Ben')];
    const players = createPlayerCache(() => roster);
    players();
    roster = [p(0, 'Anna'), { ...p(1, 'Ben'), id: 'new-id' }];
    expect(players()[1].id).toBe('new-id');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { emoteCues } from './emoteLayer';
import type { EmoteShow } from './emotes';

// The layer module also holds the Phaser drawing part, which needs a browser.
vi.mock('phaser', () => ({ default: {} }));

const show = (key: string, id: string, n: number): EmoteShow => ({ key, id, n, leftMs: 2000 });

describe('emoteCues', () => {
  it('a new show sounds once, the same show again does not, the next show of that player does', () => {
    const a = emoteCues(new Set(), [show('p0', 'winken', 1)]);
    expect(a.sounds).toEqual(['aktion.emote_winken']);
    const b = emoteCues(a.seen, [show('p0', 'winken', 1)]);
    expect(b.sounds).toEqual([]);
    const c = emoteCues(b.seen, [show('p0', 'winken', 2), show('p1', 'herz', 1)]);
    expect(c.sounds).toEqual(['aktion.emote_winken', 'aktion.emote_herz']);
    // A show that ended and comes back with the same n (repeated snapshot) stays silent.
    expect(emoteCues(emoteCues(c.seen, []).seen, [show('p1', 'herz', 1)]).sounds).toEqual([]);
  });
});

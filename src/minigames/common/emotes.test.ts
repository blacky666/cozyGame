import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../config';
import { neutralInput, type InputState } from '../../net/protocol';
import { EmoteHost } from './emotes';

const E = CONFIG.progress.emote;
const SLOTS = ['winken', 'lachen', null, 'kaputt'];
const press = (emotes: number, emote: 0 | 1 | 2 | 3 | 4): InputState => ({ ...neutralInput(), emotes, emote });

describe('EmoteHost', () => {
  it('first tick is a baseline; a press shows, cooldown drops presses, the show ends after showMs', () => {
    const h = new EmoteHost();
    const slots = () => SLOTS;
    h.tick(33, { p0: press(5, 2) }, slots); // baseline: counter already at 5
    expect(h.shows()).toEqual([]);
    h.tick(33, { p0: press(6, 1) }, slots);
    expect(h.shows()).toEqual([{ key: 'p0', id: 'winken', n: 1, leftMs: E.showMs }]);
    h.tick(1000, { p0: press(7, 2) }, slots); // during the cooldown: dropped
    expect(h.shows()).toEqual([{ key: 'p0', id: 'winken', n: 1, leftMs: E.showMs - 1000 }]);
    h.tick(1000, { p0: press(7, 2) }, slots);
    expect(h.shows()).toEqual([]);
    h.tick(999, { p0: press(7, 2) }, slots); // 2999 ms after the press
    h.tick(1, { p0: press(8, 2) }, slots); // 3000 ms: cooldown over
    expect(h.shows()).toEqual([{ key: 'p0', id: 'lachen', n: 2, leftMs: E.showMs }]);
  });

  it('an empty slot or an unknown id shows nothing and starts no cooldown', () => {
    const h = new EmoteHost();
    const slots = () => SLOTS;
    h.tick(33, { p0: press(0, 0) }, slots);
    h.tick(33, { p0: press(1, 3) }, slots); // empty slot 3
    expect(h.shows()).toEqual([]);
    h.tick(33, { p0: press(2, 4) }, slots); // unknown id in slot 4
    expect(h.shows()).toEqual([]);
    h.tick(33, { p0: press(3, 1) }, slots); // immediately afterwards: works
    expect(h.shows()).toMatchObject([{ id: 'winken', n: 1 }]);
  });

  it('a dropped counter (reconnect) re-bases without a show; players are independent', () => {
    const h = new EmoteHost();
    const slots = () => SLOTS;
    h.tick(33, { p0: press(10, 1), p1: press(0, 0) }, slots);
    h.tick(33, { p0: press(2, 1), p1: press(1, 2) }, slots);
    expect(h.shows()).toEqual([{ key: 'p1', id: 'lachen', n: 1, leftMs: E.showMs }]);
    h.tick(33, { p0: press(3, 1), p1: press(1, 2) }, slots);
    expect(h.shows().map((s) => s.key).sort()).toEqual(['p0', 'p1']);
  });

  it('clear() drops the shows but keeps edges and cooldowns', () => {
    const h = new EmoteHost();
    const slots = () => SLOTS;
    h.tick(33, { p0: press(0, 0) }, slots);
    h.tick(33, { p0: press(1, 1) }, slots);
    h.clear();
    expect(h.shows()).toEqual([]);
    h.tick(33, { p0: press(1, 1) }, slots); // no new press: the edge kept its baseline
    expect(h.shows()).toEqual([]);
    h.tick(33, { p0: press(2, 2) }, slots); // still cooling down
    expect(h.shows()).toEqual([]);
  });

  it('uses the slots of the pressing player', () => {
    const h = new EmoteHost();
    const slotsOf = (k: string) => (k === 'p1' ? ['herz', null, null, null] : SLOTS);
    h.tick(33, { p1: press(0, 0) }, slotsOf);
    h.tick(33, { p1: press(1, 1) }, slotsOf);
    expect(h.shows()).toMatchObject([{ key: 'p1', id: 'herz' }]);
  });
});

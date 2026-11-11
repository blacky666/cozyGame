import { describe, expect, it } from 'vitest';
import { rosterChange } from './uiSounds';

describe('rosterChange', () => {
  it('counts joins and leaves', () => {
    expect(rosterChange(['a', 'b'], ['b', 'c', 'd'])).toEqual({ joined: 2, left: 1 });
    expect(rosterChange(['a'], ['a'])).toEqual({ joined: 0, left: 0 });
  });
});

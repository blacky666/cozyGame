import { describe, expect, it } from 'vitest';
import { countShoves, FeatTracker } from './feats';

describe('FeatTracker', () => {
  it('counts per player and feat', () => {
    const t = new FeatTracker();
    expect(t.count('p0', 'schubser')).toBe(1);
    expect(t.count('p0', 'schubser')).toBe(2);
    expect(t.count('p1', 'schubser')).toBe(1);
    expect(t.count('p0', 'schubser')).toBe(3);
    expect(t.count('p0', 'kartoffel_pass', 2)).toBe(2);
  });
  it('awards a feat once and lists in award order', () => {
    const t = new FeatTracker();
    t.award('p0', 'turm_ziel');
    t.award('p0', 'turm_zehn');
    t.award('p0', 'turm_ziel');
    t.award('p1', 'schubser');
    expect(t.result()).toEqual({ p0: ['turm_ziel', 'turm_zehn'], p1: ['schubser'] });
  });
  it('countShoves awards schubser at the third landed shove only', () => {
    const t = new FeatTracker();
    countShoves(t, [{ from: 'p0', to: 'p1' }, { from: 'p1', to: 'p0' }]);
    countShoves(t, [{ from: 'p0', to: 'p2' }]);
    expect(t.result()).toEqual({});
    countShoves(t, [{ from: 'p0', to: 'p1' }]);
    expect(t.result()).toEqual({ p0: ['schubser'] });
  });
});

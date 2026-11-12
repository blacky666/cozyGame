import { describe, expect, it } from 'vitest';
import { CARD_IDS, cardText, cardTitle, eligibleCards, isCardId, offerCards } from './cards';
import { mulberry32 } from './rng';

describe('cards', () => {
  it('offers the first three of a Fisher-Yates shuffle', () => {
    expect(offerCards('schneeball', () => 0)).toEqual(['peinlicher_hut', 'punkte_klau', 'turbo_start']);
  });

  it('never offers rollentausch before Wackel-Turm, always 3 distinct ids', () => {
    for (let s = 1; s <= 200; s++) {
      const offer = offerCards('wackelturm', mulberry32(s));
      expect(offer).not.toContain('rollentausch');
      expect(offer).toHaveLength(3);
      expect(new Set(offer).size).toBe(3);
    }
    expect(eligibleCards('wackelturm')).not.toContain('rollentausch');
    expect(eligibleCards('schneeball')).toEqual([...CARD_IDS]);
  });

  it('puts a forced card first', () => {
    expect(offerCards('kartoffel', () => 0, 'falle')).toEqual(['falle', 'peinlicher_hut', 'punkte_klau']);
    expect(offerCards('wackelturm', () => 0, 'rollentausch')).toEqual(offerCards('wackelturm', () => 0));
  });

  it('has titles and per-game texts', () => {
    expect(cardTitle('falle')).toBe('Falle stellen');
    expect(cardText('turbo_start', 'farbkrieg')).toBe('Du startest mit einer Farbbombe.');
    expect(cardText('turbo_start', 'muenzjagd')).toBe('Du startest mit einem Extra.');
    expect(cardText('rollentausch', 'kartoffel')).toContain('Kartoffel');
    expect(cardText('rollentausch', 'schneeball')).toBe('Du tauschst mit dem Ersten die Startplätze.');
  });

  it('recognises card ids', () => {
    expect(isCardId('falle')).toBe(true);
    expect(isCardId('x')).toBe(false);
    expect(isCardId(3)).toBe(false);
  });
});

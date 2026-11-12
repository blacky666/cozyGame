import { describe, expect, it } from 'vitest';
import { defaultProfile, type Profile } from '../save/profile';
import { applyOption, assignEmote, lookOptions, nextRewardText, TAB_TITLES } from './lookModel';

const prof = (o: Partial<Profile> = {}): Profile => ({ ...defaultProfile('Mo'), ...o });

describe('lookModel', () => {
  it('has the nine tab titles', () => {
    expect(Object.values(TAB_TITLES)).toEqual(['Outfit', 'Frisur', 'Haarfarbe', 'Haut', 'Hut', 'Gesicht', 'Rücken', 'Emotes', 'Streich']);
  });

  it('hats at 0 XP: Ohne and Bommelmütze open, Zylinder from level 3, Bauhelm from a box, no Gurke', () => {
    const o = lookOptions(prof({ xp: 0 }), 'hat');
    expect(o[0]).toMatchObject({ value: null, label: 'Ohne', locked: false, lockText: null, selected: false });
    expect(o.find((x) => x.label === 'Bommelmütze')).toMatchObject({ value: 'bommelmuetze', locked: false, selected: true });
    expect(o.find((x) => x.label === 'Zylinder')).toMatchObject({ locked: true, lockText: 'ab Level 3', selected: false });
    expect(o.find((x) => x.label === 'Bauhelm')).toMatchObject({ locked: true, lockText: 'Überraschungskiste' });
    expect(o.some((x) => x.value === 'gurke')).toBe(false);
  });

  it('hats at 280 XP: Zylinder open; a box item in unlocked is open', () => {
    const o = lookOptions(prof({ xp: 280, unlocked: ['hat.bauhelm'] }), 'hat');
    expect(o.find((x) => x.label === 'Zylinder')).toMatchObject({ locked: false, lockText: null });
    expect(o.find((x) => x.label === 'Bauhelm')).toMatchObject({ locked: false, lockText: null });
  });

  it('pranks: Bananenschale and Konfetti-Kanone open, Furzkissen from level 5', () => {
    const o = lookOptions(prof(), 'prank');
    expect(o.slice(0, 2)).toMatchObject([
      { value: 'bananenschale', label: 'Bananenschale', locked: false, selected: true },
      { value: 'konfetti_kanone', label: 'Konfetti-Kanone', locked: false, selected: false },
    ]);
    expect(o.find((x) => x.label === 'Furzkissen')).toMatchObject({ locked: true, lockText: 'ab Level 5' });
  });

  it('hair colours, hairstyles and skins are all open', () => {
    const colors = lookOptions(prof(), 'hairColor');
    expect(colors.map((x) => x.label)).toEqual(['Braun', 'Rot', 'Blond', 'Schwarz', 'Grau', 'Grün']);
    expect(colors.every((x) => !x.locked)).toBe(true);
    expect(colors[0]).toMatchObject({ value: 0, selected: true });
    expect(lookOptions(prof(), 'skin').map((x) => x.label)).toEqual(['Hautton 1', 'Hautton 2', 'Hautton 3', 'Hautton 4']);
    const hairs = lookOptions(prof(), 'hair');
    expect(hairs).toHaveLength(6);
    expect(hairs.every((x) => !x.locked)).toBe(true);
  });

  it('face and cape map to glasses and back, emotes mark the slotted ones', () => {
    const p = prof();
    p.look = { ...p.look, glasses: 'rundbrille' };
    expect(lookOptions({ ...p, xp: 1000 }, 'face').find((x) => x.selected)).toMatchObject({ value: 'rundbrille' });
    expect(lookOptions(p, 'cape')[0]).toMatchObject({ value: null, selected: true });
    const emotes = lookOptions(p, 'emotes');
    expect(emotes.filter((x) => x.selected).map((x) => x.value)).toEqual(['winken', 'lachen']);
    expect(emotes.find((x) => x.value === 'zunge')).toMatchObject({ locked: true, lockText: 'ab Level 2' });
  });

  it('applyOption sets the field of the tab', () => {
    const look = { ...defaultProfile().look, glasses: 'rundbrille' };
    expect(applyOption(look, 'face', null).glasses).toBeNull();
    expect(applyOption(look, 'outfit', 'latzhose').outfit).toBe('latzhose');
    expect(applyOption(look, 'hairColor', 3).hairColor).toBe(3);
    expect(applyOption(look, 'cape', 'umhang_rot').back).toBe('umhang_rot');
    expect(applyOption(look, 'prank', 'konfetti_kanone').prank).toBe('konfetti_kanone');
    expect(look.glasses).toBe('rundbrille'); // input untouched
  });

  it('assignEmote swaps an emote that sits in another slot and can empty a slot', () => {
    const slots = ['winken', 'lachen', null, null];
    expect(assignEmote(slots, 2, 'winken')).toEqual([null, 'lachen', 'winken', null]);
    expect(assignEmote(slots, 1, 'winken')).toEqual(['lachen', 'winken', null, null]);
    expect(assignEmote(slots, 1, null)).toEqual(['winken', null, null, null]);
    expect(assignEmote(slots, 3, 'zunge')).toEqual(['winken', 'lachen', null, 'zunge']);
    expect(slots).toEqual(['winken', 'lachen', null, null]);
  });

  it('nextRewardText names the next level reward or the next box', () => {
    expect(nextRewardText(0)).toBe('Nächste Belohnung: Zunge rausstrecken (noch 120 XP)');
    expect(nextRewardText(250)).toBe('Nächste Belohnung: Zylinder (noch 30 XP)');
    expect(nextRewardText(19720)).toBe('Nächste Belohnung: Überraschungskiste (noch 1000 XP)');
  });
});

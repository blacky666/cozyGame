import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../config';
import type { Cue } from '../snowball/snowballSounds';
import { finaleAt, type TowerFx, type TowerPlayer, type TowerState } from './towerHost';
import { TowerSounds } from './towerSounds';

const C = CONFIG.wackelturm;
const player = (o: Partial<TowerPlayer> = {}): TowerPlayer => ({
  plot: 0, craneX: 100, hangTop: 50, hang: { kind: 'kurz', rot: 0 }, cdMs: 0, heightPx: 0, bestPx: 0, placed: 0,
  charges: 0, armed: null, windMs: 0, windDir: 1, blocks: [], ...o,
});
const state = (o: Partial<TowerState> = {}): TowerState => ({
  timeLeftMs: 100000, durationMs: C.durationMs, goalPx: C.goalPx,
  players: { p0: player(), p1: player({ plot: 1, craneX: 300 }) }, fx: [], winner: null, ...o,
});
const withP0 = (o: Partial<TowerPlayer>, extra: Partial<TowerState> = {}) =>
  state({ players: { p0: player(o), p1: player({ plot: 1, craneX: 300 }) }, ...extra });
const names = (c: Cue[]) => c.map((x) => x.name);
const fx = (id: number, kind: TowerFx['kind'], who = 'p0', o: Partial<TowerFx> = {}): TowerFx => ({
  id, kind, who, x: 100, y: 100, by: null, stone: false, slide: false, ...o,
});

describe('TowerSounds', () => {
  it('first state is only the baseline', () => {
    const t = new TowerSounds('p0');
    expect(t.update(state({ fx: [fx(1, 'drop')] }), 0)).toEqual([]);
    // Nothing changed relative to the baseline: no loop yet either.
    expect(t.loops(10).kran).toBe(false);
  });

  it('fx map to sounds, each id once', () => {
    const t = new TowerSounds('p0');
    t.update(state(), 0);
    const list = [
      fx(1, 'drop'), fx(2, 'land'), fx(3, 'land', 'p0', { stone: true }), fx(4, 'wackel'), fx(5, 'wackel', 'p0', { slide: true }),
      fx(6, 'einsturz'), fx(7, 'weg'), fx(8, 'hoehe'), fx(9, 'wind', 'p1', { by: 'p0' }), fx(10, 'fies', 'p1', { by: 'p0' }),
      fx(11, 'ziel'),
    ];
    expect(names(t.update(state({ fx: list }), 16))).toEqual([
      'loslassen', 'aufprall_holz', 'aufprall_stein', 'knarzen', 'rutschen', 'einsturz', 'klotz_weg', 'hoehe_neu',
      'windstoss', 'fieser_klotz', 'zielhoehe',
    ]);
    expect(t.update(state({ fx: list }), 32)).toEqual([]);
    // Ids that left the snapshot are forgotten.
    t.update(state(), 48);
    expect(names(t.update(state({ fx: [fx(1, 'drop')] }), 64))).toEqual(['loslassen']);
  });

  it('other players fx play at half volume, own at full; pan follows x; hoehe is own only', () => {
    const t = new TowerSounds('p0');
    t.update(state(), 0);
    const c = t.update(state({ fx: [
      fx(1, 'drop', 'p0', { x: 10 }), fx(2, 'drop', 'p1', { x: 400 }), fx(3, 'hoehe', 'p1'),
    ] }), 16);
    expect(c.map((x) => x.volume)).toEqual([1, 0.5]);
    expect(c[0].pan).toBeLessThan(0);
    expect(c[1].pan).toBeGreaterThan(0);
  });

  it('wind / fies are full volume for the user and the target; ziel is global', () => {
    const t = new TowerSounds('p0');
    t.update(state(), 0);
    const c = t.update(state({ fx: [
      fx(1, 'wind', 'p1', { by: 'p0', x: 400 }), fx(2, 'fies', 'p0', { by: 'p1' }), fx(3, 'wind', 'p1', { by: 'p2' }),
      fx(4, 'ziel', 'p1', { x: 400 }),
    ] }), 16);
    expect(c.map((x) => x.volume)).toEqual([1, 1, 0.5, 1]);
    expect(c[3].pan).toBe(0);
  });

  it('own rotation change plays drehen, a new block does not', () => {
    const t = new TowerSounds('p0');
    t.update(state(), 0);
    expect(names(t.update(withP0({ hang: { kind: 'kurz', rot: 1 } }), 16))).toEqual(['drehen']);
    expect(t.update(withP0({ hang: { kind: 'lang', rot: 0 } }), 32)).toEqual([]);
    expect(t.update(withP0({ hang: null }), 48)).toEqual([]);
    const o = state();
    o.players.p1.hang = { kind: 'kurz', rot: 2 };
    expect(t.update(o, 64)).toEqual([]);
  });

  it('own crane starting to move plays verschieben once per movement', () => {
    const t = new TowerSounds('p0');
    t.update(withP0({ craneX: 100 }), 0);
    expect(names(t.update(withP0({ craneX: 101 }), 16))).toEqual(['verschieben']);
    expect(t.update(withP0({ craneX: 102 }), 32)).toEqual([]);
    expect(t.update(withP0({ craneX: 102 }), 48)).toEqual([]);
    expect(names(t.update(withP0({ craneX: 103 }), 64))).toEqual(['verschieben']);
    // Other players' cranes are silent.
    const o = withP0({ craneX: 103 });
    o.players.p1.craneX = 310;
    expect(t.update(o, 80)).toEqual([]);
  });

  it('own charges rising play aerger_bereit', () => {
    const t = new TowerSounds('p0');
    t.update(state(), 0);
    expect(names(t.update(withP0({ charges: 1 }), 16))).toEqual(['aerger_bereit']);
    expect(t.update(withP0({ charges: 0 }), 32)).toEqual([]);
    const o = withP0({});
    o.players.p1.charges = 2;
    expect(t.update(o, 48)).toEqual([]);
  });

  it('kran loop runs while the own hangTop changed within 200 ms', () => {
    const t = new TowerSounds('p0');
    t.update(withP0({ hangTop: 50 }), 0);
    expect(t.loops(0).kran).toBe(false);
    t.update(withP0({ hangTop: 49 }), 100);
    expect(t.loops(100).kran).toBe(true);
    expect(t.loops(299).kran).toBe(true);
    expect(t.loops(301).kran).toBe(false);
  });

  it('music: normal, finale by time or by height, none at the end', () => {
    const near = C.goalPx - C.finaleNearPx;
    expect(TowerSounds.music(state())).toBe('musik_schleife');
    expect(TowerSounds.music(state({ timeLeftMs: finaleAt(C.durationMs) }))).toBe('musik_finale_schleife');
    expect(TowerSounds.music(state({ timeLeftMs: finaleAt(18000) + 1, durationMs: 18000 }))).toBe('musik_schleife');
    expect(TowerSounds.music(state({ timeLeftMs: finaleAt(18000), durationMs: 18000 }))).toBe('musik_finale_schleife');
    expect(TowerSounds.music(withP0({ heightPx: near - 1 }))).toBe('musik_schleife');
    expect(TowerSounds.music(withP0({ heightPx: near }))).toBe('musik_finale_schleife');
    expect(TowerSounds.music(state({ timeLeftMs: 0 }))).toBeNull();
    expect(TowerSounds.music(state({ winner: 'p0' }))).toBeNull();
  });
});

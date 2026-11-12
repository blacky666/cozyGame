import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../config';
import type { Cue } from '../common/cue';
import { finaleAt, type PaintFx, type PaintPlayer, type PaintState } from './paintHost';
import { PaintSounds } from './paintSounds';

const COLS = 26;
const ROWS = 13;
const blank = '0'.repeat(COLS * ROWS);
/** Grid string with the given owner digit set at the tile under pixel (x, y). */
const gridWith = (x: number, y: number, v: string): string => {
  const i = Math.floor(y / 16) * COLS + Math.floor(x / 16);
  return blank.slice(0, i) + v + blank.slice(i + 1);
};

const player = (o: Partial<PaintPlayer> = {}): PaintPlayer => ({
  x: 100, y: 100, vx: 0, vy: 0, dir: 'down', klecksCdMs: 0, slowMs: 0, extra: null, moppMs: 0, rollMs: 0,
  stun: false, swing: false, shoveCdMs: 0, tiles: 0, throwAnimMs: 0, ...o,
});
const state = (o: Partial<PaintState> = {}): PaintState => ({
  timeLeftMs: 60000,
  durationMs: 90000,
  players: { p0: player(), p1: player({ x: 300 }) },
  grid: blank,
  blobs: [],
  pickups: [],
  fx: [],
  finale: { phase: 'wait', fallLeftMs: 0, x: 0, y: 0, who: null },
  ...o,
});
const names = (c: Cue[]) => c.map((x) => x.name);
const fx = (id: number, kind: PaintFx['kind'], who: string | null = 'p0', x = 100): PaintFx => ({ id, kind, x, y: 100, who, r: 0, owner: null });

describe('PaintSounds', () => {
  it('first state is only the baseline', () => {
    const t = new PaintSounds('p0', 0);
    expect(t.update(state({ fx: [fx(1, 'wurf')] }), 0)).toEqual([]);
  });

  it('fx map to sounds, each id once', () => {
    const t = new PaintSounds('p0', 0);
    t.update(state(), 0);
    const list = [
      fx(1, 'wurf'), fx(2, 'platsch'), fx(3, 'getuencht'), fx(4, 'bombe_wurf'), fx(5, 'bombe'),
      fx(6, 'finale'), fx(7, 'finale_fall'), fx(8, 'pickup'),
    ];
    expect(names(t.update(state({ fx: list }), 16))).toEqual([
      'klecks_wurf', 'klecks_platsch', 'getuencht', 'farbbombe_wurf', 'farbbombe_explosion',
      'farbbombe_explosion', 'finale_bombe_faellt', 'pickup',
    ]);
    expect(t.update(state({ fx: list }), 32)).toEqual([]);
  });

  it('other players fx play at half volume, own at full', () => {
    const t = new PaintSounds('p0', 0);
    t.update(state(), 0);
    const c = t.update(state({ fx: [fx(1, 'wurf', 'p0'), fx(2, 'wurf', 'p1')] }), 16);
    expect(c.map((x) => x.volume)).toEqual([1, 0.5]);
  });

  it('pans across the map width from CONFIG', () => {
    const t = new PaintSounds('p0', 0);
    t.update(state(), 0);
    const at = (id: number, x: number) => t.update(state({ fx: [fx(id, 'wurf', 'p0', x)] }), id * 16)[0].pan;
    expect(at(1, 0)).toBeCloseTo(-0.6);
    expect(at(2, CONFIG.farbkrieg.mapW / 2)).toBeCloseTo(0);
    expect(at(3, CONFIG.farbkrieg.mapW)).toBeCloseTo(0.6);
  });

  it('finale_fall and finale are global: full volume, centred, whoever they belong to', () => {
    const t = new PaintSounds('p0', 0);
    t.update(state(), 0);
    const c = t.update(state({ fx: [fx(1, 'finale_fall', 'p1', 10), fx(2, 'finale', null, 400), fx(3, 'finale', 'p0', 50)] }), 16);
    expect(c).toEqual([
      { name: 'finale_bombe_faellt', volume: 1, pan: 0 },
      { name: 'farbbombe_explosion', volume: 1, pan: 0 },
      { name: 'farbbombe_explosion', volume: 1, pan: 0 },
    ]);
  });

  it('endspurt once when timeLeft crosses finaleAt', () => {
    const t = new PaintSounds('p0', 0);
    const f = finaleAt(90000);
    t.update(state({ timeLeftMs: f + 100 }), 0);
    expect(names(t.update(state({ timeLeftMs: f - 100 }), 16))).toEqual(['endspurt']);
    expect(t.update(state({ timeLeftMs: f - 200 }), 32)).toEqual([]);
  });

  it('shove cues use full ids; own cooldown ready', () => {
    const t = new PaintSounds('p0', 0);
    t.update(state(), 0);
    const c = t.update(state({ players: { p0: player({ swing: true, shoveCdMs: 4000 }), p1: player({ x: 300, stun: true }) } }), 16);
    expect(names(c)).toEqual(['aktion.schubsen', 'aktion.geschubst']);
    expect(names(t.update(state({ players: { p0: player(), p1: player({ x: 300 }) } }), 32))).toEqual(['aktion.schubs_bereit']);
  });

  it('painting is true for 300 ms after the own feet tile turned own colour', () => {
    const t = new PaintSounds('p0', 0);
    t.update(state(), 0);
    expect(t.painting(0)).toBe(false);
    t.update(state({ grid: gridWith(100, 100, '1') }), 1000);
    expect(t.painting(1000)).toBe(true);
    expect(t.painting(1299)).toBe(true);
    expect(t.painting(1301)).toBe(false);
  });

  it('painting reads the tile from the map geometry, also in the last column and row', () => {
    const t = new PaintSounds('p0', 1);
    const x = CONFIG.farbkrieg.mapW - 1;
    const y = CONFIG.farbkrieg.mapH - 1;
    const at = (o: Partial<PaintPlayer>) => ({ p0: player(o), p1: player({ x: 300 }) });
    t.update(state({ players: at({ x, y }) }), 0);
    t.update(state({ players: at({ x, y }), grid: gridWith(x, y, '2') }), 16);
    expect(t.painting(16)).toBe(true);
    // A grid string of the wrong length is ignored.
    const u = new PaintSounds('p0', 0);
    u.update(state({ grid: '0'.repeat(100) }), 0);
    u.update(state({ grid: '1'.repeat(100) }), 16);
    expect(u.painting(16)).toBe(false);
  });

  it('painting ignores other colours and unchanged tiles', () => {
    const t = new PaintSounds('p0', 0);
    t.update(state({ grid: gridWith(100, 100, '1') }), 0);
    t.update(state({ grid: gridWith(100, 100, '1') }), 16);
    expect(t.painting(16)).toBe(false);
    t.update(state({ grid: gridWith(100, 100, '2') }), 32);
    expect(t.painting(32)).toBe(false);
  });

  it('loops follow own mopp and roller timers', () => {
    expect(PaintSounds.loops(state(), 'p0')).toEqual({ mopp: false, roll: false });
    const s = state({ players: { p0: player({ moppMs: 100 }), p1: player({ rollMs: 100 }) } });
    expect(PaintSounds.loops(s, 'p0')).toEqual({ mopp: true, roll: false });
    expect(PaintSounds.loops(s, 'p1')).toEqual({ mopp: false, roll: true });
  });

  it('music: normal, finale from finaleAt, none at the end', () => {
    const f = finaleAt(90000);
    expect(PaintSounds.music(state())).toBe('musik_schleife');
    expect(PaintSounds.music(state({ timeLeftMs: f + 1 }))).toBe('musik_schleife');
    expect(PaintSounds.music(state({ timeLeftMs: f }))).toBe('musik_finale_schleife');
    expect(PaintSounds.music(state({ timeLeftMs: 0 }))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { Cue } from '../snowball/snowballSounds';
import type { Potato, SpudFx, SpudPlayer, SpudState } from './spudHost';
import { SpudSounds } from './spudSounds';

const player = (o: Partial<SpudPlayer> = {}): SpudPlayer => ({
  x: 100, y: 100, vx: 0, vy: 0, dir: 'down', ghost: false, sprintMs: 0, sprintCdMs: 0, slowMs: 0, leader: false,
  stun: false, swing: false, shoveCdMs: 0, losses: 0, ...o,
});
const potato = (o: Partial<Potato> = {}): Potato => ({ id: 1, holder: 'p0', heat: 0, noBackFrom: null, noBackMs: 0, ...o });
const state = (o: Partial<SpudState> = {}): SpudState => ({
  phase: 'play',
  players: { p0: player(), p1: player({ x: 300 }), p2: player({ x: 200 }), p3: player({ x: 50 }) },
  potatoes: [potato()], pickups: [], fx: [], out: [], bang: 0, elapsedMs: 0, ...o,
});
const names = (c: Cue[]) => c.map((x) => x.name);
const fx = (id: number, kind: SpudFx['kind'], who: string | null = null): SpudFx => ({ id, kind, x: 100, y: 100, who });

describe('SpudSounds', () => {
  it('first state is only the baseline', () => {
    const t = new SpudSounds('p0');
    expect(t.update(state({ fx: [fx(1, 'uebergabe')] }), 0)).toEqual([]);
  });

  it('fx map to sounds, each id once', () => {
    const t = new SpudSounds('p0');
    t.update(state(), 0);
    const list = [
      fx(1, 'uebergabe'), fx(2, 'kein_zurueck'), fx(3, 'konfetti'), fx(4, 'kurze_lunte'),
      fx(5, 'giesskanne'), fx(6, 'pickup'), fx(7, 'sprint'),
    ];
    expect(names(t.update(state({ fx: list }), 16))).toEqual([
      'uebergabe', 'kein_zurueck', 'fake_kartoffel_konfetti', 'kurze_lunte', 'giesskanne', 'pickup', 'sprint',
    ]);
    expect(t.update(state({ fx: list }), 32)).toEqual([]);
  });

  it('bang: knall, plus geist_werden when ranked out', () => {
    const t = new SpudSounds('p0');
    t.update(state(), 0);
    expect(names(t.update(state({ fx: [fx(1, 'knall', 'p1')], out: [] }), 16))).toEqual(['knall']);
    expect(names(t.update(state({ fx: [fx(1, 'knall', 'p1'), fx(2, 'knall', 'p2')], out: ['p2'] }), 32))).toEqual(['knall', 'geist_werden']);
  });

  it('footsteps every 280 ms per walking non-ghost, others quieter', () => {
    const t = new SpudSounds('p0');
    const walk = state({ players: { p0: player({ vx: 60 }), p1: player({ x: 300, vx: 60 }), p2: player({ vx: 60, ghost: true }) } });
    t.update(state(), 0);
    const got: Cue[] = [];
    for (let ms = 16; ms <= 1000; ms += 16) got.push(...t.update(walk, ms).filter((c) => c.name === 'schritt_erde'));
    expect(got.length).toBe(8);
    expect(got.filter((c) => c.volume === 1).length).toBe(4);
    expect(got.filter((c) => c.volume === 0.5).length).toBe(4);
  });

  it('shove cues use full ids; own cooldown ready', () => {
    const t = new SpudSounds('p0');
    t.update(state(), 0);
    const c = t.update(state({ players: { p0: player({ swing: true, shoveCdMs: 4000 }), p1: player({ x: 300, stun: true }) } }), 16);
    expect(names(c)).toEqual(['aktion.schubsen', 'aktion.geschubst']);
    expect(names(t.update(state({ players: { p0: player(), p1: player({ x: 300 }) } }), 32))).toEqual(['aktion.schubs_bereit']);
  });

  it('phase done plays letzter_uebrig once', () => {
    const t = new SpudSounds('p0');
    t.update(state(), 0);
    expect(names(t.update(state({ phase: 'done' }), 16))).toEqual(['letzter_uebrig']);
    expect(t.update(state({ phase: 'done' }), 32)).toEqual([]);
  });

  it('ticking follows the highest heat; none in pause/done', () => {
    expect(SpudSounds.ticking(state())).toBe('ticken_langsam_schleife');
    expect(SpudSounds.ticking(state({ potatoes: [potato({ heat: 1 })] }))).toBe('ticken_langsam_schleife');
    expect(SpudSounds.ticking(state({ potatoes: [potato({ heat: 2 }), potato({ id: 2, heat: 0 })] }))).toBe('ticken_mittel_schleife');
    expect(SpudSounds.ticking(state({ potatoes: [potato({ heat: 3 })] }))).toBe('ticken_schnell_schleife');
    expect(SpudSounds.ticking(state({ phase: 'pause', potatoes: [potato({ heat: 3 })] }))).toBeNull();
    expect(SpudSounds.ticking(state({ phase: 'done' }))).toBeNull();
    expect(SpudSounds.ticking(state({ potatoes: [] }))).toBeNull();
  });

  it('hissing only at heat 3 while playing', () => {
    expect(SpudSounds.hissing(state({ potatoes: [potato({ heat: 2 })] }))).toBe(false);
    expect(SpudSounds.hissing(state({ potatoes: [potato({ heat: 3 })] }))).toBe(true);
    expect(SpudSounds.hissing(state({ phase: 'pause', potatoes: [potato({ heat: 3 })] }))).toBe(false);
  });

  it('music: normal, finale for the last two of >= 3, finale at 1:1 with a loss each, none when done', () => {
    expect(SpudSounds.music(state())).toBe('musik_schleife');
    const two = state({ players: { p0: player(), p1: player(), p2: player({ ghost: true }), p3: player({ ghost: true }) } });
    expect(SpudSounds.music(two)).toBe('musik_finale_schleife');
    const duel = (a: number, b: number) => state({ players: { p0: player({ losses: a }), p1: player({ losses: b }) } });
    expect(SpudSounds.music(duel(0, 0))).toBe('musik_schleife');
    expect(SpudSounds.music(duel(1, 0))).toBe('musik_schleife');
    expect(SpudSounds.music(duel(1, 1))).toBe('musik_finale_schleife');
    expect(SpudSounds.music(state({ phase: 'done' }))).toBeNull();
  });
});

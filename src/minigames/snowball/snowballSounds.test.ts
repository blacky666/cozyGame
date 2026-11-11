import { describe, expect, it } from 'vitest';
import type { Ball, SnowPlayer, SnowState } from './snowballHost';
import { FINALE_MS, SnowSounds, type Cue } from './snowballSounds';

const player = (o: Partial<SnowPlayer> = {}): SnowPlayer => ({
  x: 100, y: 100, vx: 0, vy: 0, dir: 'down', score: 0, balls: 5, reloading: false, invulnMs: 0, down: false,
  strongCdMs: 0, stun: false, swing: false, shoveCdMs: 0, extra: null, extraLeft: 0, hat: false, throwAnimMs: 0, ...o,
});
const ball = (id: number, o: Partial<Ball> = {}): Ball => ({
  id, x: 50, y: 50, vx: 100, vy: 0, left: 50, total: 100, owner: 'p0', kind: 'normal', bounces: 0, strong: false, ...o,
});
const state = (o: Partial<SnowState> = {}): SnowState => ({
  timeLeftMs: 60000,
  players: { p0: player(), p1: player({ x: 300 }) },
  balls: [], snowmen: [{ id: 's1', hits: 0, state: 'heil', rebuildMs: 0 }], pickups: [], fx: [], ...o,
});
const names = (c: Cue[]) => c.map((x) => x.name);
const tracker = (ice = false) => new SnowSounds('p0', () => ice);

describe('SnowSounds', () => {
  it('first state is only the baseline', () => {
    const t = tracker();
    expect(t.update(state({ balls: [ball(1)], fx: [{ id: 1, kind: 'treffer', x: 0, y: 0 }] }), 0)).toEqual([]);
  });

  it('each new ball sounds once: normal or strong, others quieter', () => {
    const t = tracker();
    t.update(state(), 0);
    const c = t.update(state({ balls: [ball(1), ball(2, { strong: true, owner: 'p1' })] }), 16);
    expect(names(c)).toEqual(['wurf', 'wurf_fest']);
    expect(c[0].volume).toBe(1);
    expect(c[1].volume).toBeLessThan(1);
    expect(t.update(state({ balls: [ball(1), ball(2, { strong: true })] }), 32)).toEqual([]);
  });

  it('fx ids map to impact sounds once', () => {
    const t = tracker();
    t.update(state(), 0);
    const fx = [
      { id: 1, kind: 'treffer' as const, x: 10, y: 10 },
      { id: 2, kind: 'zerfall' as const, x: 10, y: 10 },
      { id: 3, kind: 'abprall' as const, x: 10, y: 10 },
      { id: 4, kind: 'schild_bruch' as const, x: 10, y: 10 },
    ];
    expect(names(t.update(state({ fx }), 16))).toEqual(['treffer_platsch', 'ball_zerfaellt', 'abpraller', 'eiszapfenmuetze_bruch']);
    expect(t.update(state({ fx }), 32)).toEqual([]);
  });

  it('own knockdown: fall, ouch, minus; getting up; protection end', () => {
    const t = tracker();
    t.update(state(), 0);
    const hit = state({ players: { p0: player({ down: true, invulnMs: 2500 }), p1: player({ x: 300, score: 2 }) } });
    expect(names(t.update(hit, 16))).toEqual(['hinfallen', 'getroffen_autsch']);
    const minus = state({ players: { p0: player({ down: true, invulnMs: 2400, score: 0 }), p1: player({ x: 300, score: 2 }) } });
    t.update(minus, 32);
    expect(names(t.update(state({ players: { p0: player({ invulnMs: 1500 }), p1: player({ x: 300 }) } }), 48))).toEqual(['aufstehen']);
    expect(names(t.update(state(), 64))).toEqual(['schutz_ende']);
  });

  it('own score: plus, laugh every third hit, minus', () => {
    const t = tracker();
    t.update(state(), 0);
    const got: string[] = [];
    for (let i = 1; i <= 3; i++) got.push(...names(t.update(state({ players: { p0: player({ score: i * 2 }), p1: player({ x: 300 }) } }), i * 16)));
    expect(got).toEqual(['punkte_plus', 'punkte_plus', 'punkte_plus', 'schadenfroh_lachen']);
    expect(names(t.update(state({ players: { p0: player({ score: 5 }), p1: player({ x: 300 }) } }), 100))).toEqual(['punkte_minus']);
  });

  it('reload: scoop per ball, full at max', () => {
    const t = tracker();
    t.update(state({ players: { p0: player({ balls: 3 }), p1: player() } }), 0);
    expect(names(t.update(state({ players: { p0: player({ balls: 4 }), p1: player() } }), 16))).toEqual(['schnee_aufsammeln']);
    expect(names(t.update(state({ players: { p0: player({ balls: 5 }), p1: player() } }), 32))).toEqual(['munition_voll']);
  });

  it('footsteps every 280 ms while walking, none standing or on ice', () => {
    const t = tracker();
    const walk = state({ players: { p0: player({ vx: 60 }), p1: player({ x: 300 }) } });
    t.update(state(), 0);
    let steps = 0;
    for (let ms = 16; ms <= 1000; ms += 16) steps += names(t.update(walk, ms)).filter((n) => n === 'schritt_schnee').length;
    expect(steps).toBe(4);
    const ice = tracker(true);
    ice.update(state(), 0);
    const c = ice.update(walk, 16);
    expect(names(c)).toEqual(['eis_rutschen']);
    expect(names(ice.update(walk, 32))).toEqual([]);
  });

  it('pickups: own one loud, taken by another quieter, never twice', () => {
    const t = tracker();
    const pk = { id: 1, x: 100, y: 100, kind: 'abpraller' as const };
    t.update(state({ pickups: [pk] }), 0);
    const own = t.update(state({ players: { p0: player({ extra: 'abpraller', extraLeft: 3 }), p1: player({ x: 300 }) } }), 16);
    expect(own).toEqual([{ name: 'pickup' }]);
    const t2 = tracker();
    t2.update(state({ pickups: [pk] }), 0);
    const other = t2.update(state({ players: { p0: player(), p1: player({ x: 300, hat: true }) } }), 16);
    expect(names(other)).toEqual(['pickup']);
    expect(other[0].volume).toBeLessThan(1);
  });

  it('shove: swing, shoved, own cooldown ready', () => {
    const t = tracker();
    t.update(state(), 0);
    const c = t.update(state({ players: { p0: player({ swing: true, shoveCdMs: 4000 }), p1: player({ x: 300, stun: true }) } }), 16);
    expect(names(c)).toEqual(['aktion.schubsen', 'aktion.geschubst']);
    expect(names(t.update(state(), 32))).toEqual(['aktion.schubs_bereit']);
  });

  it('snowman damage, break and rebuild', () => {
    const t = tracker();
    t.update(state(), 0);
    const sm = (st: 'schaden1' | 'kaputt' | 'aufbau' | 'heil') => state({ snowmen: [{ id: 's1', hits: 1, state: st, rebuildMs: 0 }] });
    expect(names(t.update(sm('schaden1'), 16))).toEqual(['schneemann_treffer']);
    expect(names(t.update(sm('kaputt'), 32))).toEqual(['schneemann_kaputt']);
    expect(names(t.update(sm('aufbau'), 48))).toEqual(['schneemann_aufbau']);
    expect(names(t.update(sm('heil'), 64))).toEqual([]);
  });

  it('clock: ticks 5..1, nothing at zero', () => {
    const t = tracker();
    t.update(state({ timeLeftMs: 6100 }), 0);
    const got: Cue[] = [];
    for (let left = 6000; left >= -100; left -= 100) got.push(...t.update(state({ timeLeftMs: Math.max(0, left) }), 6100 - left));
    expect(names(got)).toEqual(['countdown_tick', 'countdown_tick', 'countdown_tick', 'countdown_tick', 'countdown_tick']);
  });

  it('music: normal, finale at the end, none after; giant ball rolls', () => {
    expect(SnowSounds.music(state())).toBe('musik_schneeball');
    expect(SnowSounds.music(state({ timeLeftMs: FINALE_MS }))).toBe('musik_schneeball_finale');
    expect(SnowSounds.music(state({ timeLeftMs: 0 }))).toBeNull();
    expect(SnowSounds.rolling(state({ balls: [ball(1, { kind: 'riesenball' })] }))).toBe(true);
    expect(SnowSounds.rolling(state({ balls: [ball(1)] }))).toBe(false);
  });
});

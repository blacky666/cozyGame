import { CONFIG } from '../../config';
import type { PlayerKey } from '../types';
import type { Cue } from '../snowball/snowballSounds';
import { finaleAt, type TowerFx, type TowerState } from './towerHost';

export type { Cue };

/** Width of the arena map the fx x values live in. */
const MAP_WIDTH = 416;
/** Stereo spread: the map edges are this far left/right. */
const PAN_SPREAD = 0.6;
const OTHERS = 0.5;
/** The crane loop keeps running this long after the own hangTop last changed (the crane rising). */
const KRAN_HOLD_MS = 200;
/** A crane x change above this counts as moving (px). */
const MOVE_EPS = 1e-3;

const panAt = (x: number): number => Math.max(-1, Math.min(1, (x / MAP_WIDTH) * 2 - 1)) * PAN_SPREAD;

function fxName(f: TowerFx): string | null {
  switch (f.kind) {
    case 'drop': return 'loslassen';
    case 'land': return f.stone ? 'aufprall_stein' : 'aufprall_holz';
    case 'wackel': return f.slide ? 'rutschen' : 'knarzen';
    case 'einsturz': return 'einsturz';
    case 'weg': return 'klotz_weg';
    case 'hoehe': return 'hoehe_neu';
    case 'wind': return 'windstoss';
    case 'fies': return 'fieser_klotz';
    case 'ziel': return 'zielhoehe';
  }
}

/**
 * Turns successive (rendered) tower states into one-shot sounds, from state differences only, so
 * host and clients hear the same events. The first state only sets the baseline.
 */
export class TowerSounds {
  private prev: TowerState | null = null;
  private readonly seenFx = new Set<number>();
  private kranUntil = -Infinity;
  private moving = false;

  constructor(private readonly selfKey: PlayerKey) {}

  /** Music for this state: the finale track in the last stretch or when a tower nears the goal; none at the end. */
  static music(s: TowerState): string | null {
    if (s.timeLeftMs <= 0 || s.winner !== null) return null;
    const near = Object.values(s.players).some((p) => p.heightPx >= s.goalPx - CONFIG.wackelturm.finaleNearPx);
    return near || s.timeLeftMs <= finaleAt(s.durationMs) ? 'musik_finale_schleife' : 'musik_schleife';
  }

  /** Own crane loop: on while the own crane rose shortly ago. */
  loops(nowMs: number): { kran: boolean } {
    return { kran: nowMs < this.kranUntil };
  }

  update(s: TowerState, nowMs: number): Cue[] {
    const prev = this.prev;
    this.prev = s;
    const out: Cue[] = [];
    if (!prev) {
      for (const f of s.fx) this.seenFx.add(f.id);
      return out;
    }
    const self = this.selfKey;

    // Fx ids stay in the snapshot for a while; each plays once.
    const fxNow = new Set(s.fx.map((f) => f.id));
    for (const id of this.seenFx) if (!fxNow.has(id)) this.seenFx.delete(id);
    for (const f of s.fx) {
      if (this.seenFx.has(f.id)) continue;
      this.seenFx.add(f.id);
      const name = fxName(f);
      if (!name || (f.kind === 'hoehe' && f.who !== self)) continue;
      if (f.kind === 'ziel') {
        out.push({ name, volume: 1, pan: 0 });
        continue;
      }
      const mine = f.who === self || ((f.kind === 'wind' || f.kind === 'fies') && f.by === self);
      out.push({ name, volume: mine ? 1 : OTHERS, pan: panAt(f.x) });
    }

    const me = s.players[self];
    const was = prev.players[self];
    if (me && was) {
      if (me.hang && was.hang && me.hang.kind === was.hang.kind && me.hang.rot !== was.hang.rot) out.push({ name: 'drehen' });
      const moving = Math.abs(me.craneX - was.craneX) > MOVE_EPS;
      if (moving && !this.moving) out.push({ name: 'verschieben' });
      this.moving = moving;
      if (me.charges > was.charges) out.push({ name: 'aerger_bereit' });
      if (me.hangTop !== was.hangTop) this.kranUntil = nowMs + KRAN_HOLD_MS;
    }
    return out;
  }
}

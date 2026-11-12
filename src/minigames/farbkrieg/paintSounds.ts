import { CONFIG } from '../../config';
import type { PlayerKey } from '../types';
import type { Cue } from '../common/cue';
import { PAINT_TILE } from './paintGrid';
import { finaleAt, type PaintFx, type PaintState } from './paintHost';

export type { Cue };

/** Stereo spread: the map edges are this far left/right. */
const PAN_SPREAD = 0.6;
const OTHERS = 0.5;
/** Events everybody hears the same: full volume, centred. */
const GLOBAL: ReadonlySet<PaintFx['kind']> = new Set(['finale_fall', 'finale']);
/** The painting loop keeps running this long after the last own tile was painted. */
const PAINT_HOLD_MS = 300;

const FX_SOUND: Record<PaintFx['kind'], string> = {
  wurf: 'klecks_wurf',
  platsch: 'klecks_platsch',
  getuencht: 'getuencht',
  bombe_wurf: 'farbbombe_wurf',
  bombe: 'farbbombe_explosion',
  finale: 'farbbombe_explosion',
  finale_fall: 'finale_bombe_faellt',
  pickup: 'pickup',
};

const panAt = (x: number): number => Math.max(-1, Math.min(1, (x / CONFIG.farbkrieg.mapW) * 2 - 1)) * PAN_SPREAD;

const COLS = Math.round(CONFIG.farbkrieg.mapW / PAINT_TILE);
const ROWS = Math.round(CONFIG.farbkrieg.mapH / PAINT_TILE);

/** Owner digit under pixel (x, y) of a COLS x ROWS grid string; 0 off the map or for a grid of another size. */
function ownerAt(grid: string, x: number, y: number): number {
  if (grid.length !== COLS * ROWS) return 0;
  const col = Math.floor(x / PAINT_TILE);
  const row = Math.floor(y / PAINT_TILE);
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return 0;
  const v = grid.charCodeAt(row * COLS + col) - 48;
  return v >= 0 && v <= 4 ? v : 0;
}

/**
 * Turns successive (rendered) paint states into one-shot sounds, from state differences only, so
 * host and clients hear the same events. The first state only sets the baseline.
 * `slot` is the own colour slot (own paint is owner slot + 1).
 */
export class PaintSounds {
  private prev: PaintState | null = null;
  private readonly seenFx = new Set<number>();
  private paintUntil = -Infinity;

  constructor(private readonly selfKey: PlayerKey, private readonly slot: number) {}

  /** Music for this state: the finale track from finaleAt, none once the time is up. */
  static music(s: PaintState): string | null {
    if (s.timeLeftMs <= 0) return null;
    return s.timeLeftMs <= finaleAt(s.durationMs) ? 'musik_finale_schleife' : 'musik_schleife';
  }

  /** Own extra loops. */
  static loops(s: PaintState, selfKey: PlayerKey): { mopp: boolean; roll: boolean } {
    const me = s.players[selfKey];
    return { mopp: !!me && me.moppMs > 0, roll: !!me && me.rollMs > 0 };
  }

  /** True shortly after the own feet painted a tile in the own colour. */
  painting(nowMs: number): boolean {
    return nowMs < this.paintUntil;
  }

  update(s: PaintState, nowMs: number): Cue[] {
    const prev = this.prev;
    this.prev = s;
    const out: Cue[] = [];
    if (!prev) {
      for (const f of s.fx) this.seenFx.add(f.id);
      return out;
    }
    const self = this.selfKey;

    // Fx ids stay in the snapshot for a while (also after the end); each plays once.
    const fxNow = new Set(s.fx.map((f) => f.id));
    for (const id of this.seenFx) if (!fxNow.has(id)) this.seenFx.delete(id);
    for (const f of s.fx) {
      if (this.seenFx.has(f.id)) continue;
      this.seenFx.add(f.id);
      const global = GLOBAL.has(f.kind);
      out.push({ name: FX_SOUND[f.kind], volume: global || f.who === self ? 1 : OTHERS, pan: global ? 0 : panAt(f.x) });
    }

    const fa = finaleAt(s.durationMs);
    if (prev.timeLeftMs > fa && s.timeLeftMs <= fa && s.timeLeftMs > 0) out.push({ name: 'endspurt' });

    for (const [k, p] of Object.entries(s.players)) {
      const q = prev.players[k];
      if (!q) continue;
      const pan = panAt(p.x);
      if (p.swing && !q.swing) out.push({ name: 'aktion.schubsen', volume: k === self ? 1 : 0.6, pan });
      if (p.stun && !q.stun) out.push({ name: 'aktion.geschubst', volume: k === self ? 1 : 0.6, pan });
      if (k === self && q.shoveCdMs > 0 && p.shoveCdMs <= 0) out.push({ name: 'aktion.schubs_bereit' });
    }

    const me = s.players[self];
    if (me && s.grid !== prev.grid) {
      const before = ownerAt(prev.grid, me.x, me.y);
      const now = ownerAt(s.grid, me.x, me.y);
      if (now !== before && now === this.slot + 1) this.paintUntil = nowMs + PAINT_HOLD_MS;
    }
    return out;
  }
}

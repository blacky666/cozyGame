import type { PlayerKey } from '../types';
import type { Cue } from '../snowball/snowballSounds';
import type { SpudFx, SpudState } from './spudHost';

export type { Cue };

const MAP_WIDTH = 416;
/** Stereo spread: the arena edges are this far left/right. */
const PAN_SPREAD = 0.6;
const STEP_MS = 280;
const STEP_OTHERS = 0.5;

export type TickLoop = 'ticken_langsam_schleife' | 'ticken_mittel_schleife' | 'ticken_schnell_schleife';

const FX_SOUND: Record<SpudFx['kind'], string> = {
  knall: 'knall',
  konfetti: 'fake_kartoffel_konfetti',
  uebergabe: 'uebergabe',
  kein_zurueck: 'kein_zurueck',
  kurze_lunte: 'kurze_lunte',
  giesskanne: 'giesskanne',
  pickup: 'pickup',
  sprint: 'sprint',
};

const panAt = (x: number): number => Math.max(-1, Math.min(1, (x / MAP_WIDTH) * 2 - 1)) * PAN_SPREAD;
const maxHeat = (s: SpudState): number => s.potatoes.reduce((m, p) => Math.max(m, p.heat), -1);

/**
 * Turns successive (rendered) potato states into one-shot sounds, from state differences only, so
 * host and clients hear the same events. The first state only sets the baseline.
 */
export class SpudSounds {
  private prev: SpudState | null = null;
  private prevAt = 0;
  private readonly seenFx = new Set<number>();
  private readonly stepMs = new Map<PlayerKey, number>();

  constructor(private readonly selfKey: PlayerKey) {}

  /** Tick loop for this state: follows the hottest potato; silent between bangs and after the end. */
  static ticking(s: SpudState): TickLoop | null {
    if (s.phase !== 'play') return null;
    const h = maxHeat(s);
    if (h < 0) return null;
    return h >= 3 ? 'ticken_schnell_schleife' : h === 2 ? 'ticken_mittel_schleife' : 'ticken_langsam_schleife';
  }

  /** The fuse hisses at the highest heat. */
  static hissing(s: SpudState): boolean {
    return s.phase === 'play' && maxHeat(s) >= 3;
  }

  /** Finale music for the last two of at least three, or a 1:1 duel with a loss each; none when done. */
  static music(s: SpudState): string | null {
    if (s.phase === 'done') return null;
    const all = Object.values(s.players);
    const alive = all.filter((p) => !p.ghost);
    const finale = (alive.length === 2 && all.length >= 3) || (all.length === 2 && alive.length === 2 && alive.every((p) => p.losses === 1));
    return finale ? 'musik_finale_schleife' : 'musik_schleife';
  }

  update(s: SpudState, nowMs: number): Cue[] {
    const prev = this.prev;
    const dt = prev ? Math.max(0, nowMs - this.prevAt) : 0;
    this.prev = s;
    this.prevAt = nowMs;
    const out: Cue[] = [];
    if (!prev) {
      for (const f of s.fx) this.seenFx.add(f.id);
      return out;
    }
    const self = this.selfKey;

    // Fx ids stay in the snapshot for a while; forget ids that left it.
    const fxNow = new Set(s.fx.map((f) => f.id));
    for (const id of this.seenFx) if (!fxNow.has(id)) this.seenFx.delete(id);
    for (const f of s.fx) {
      if (this.seenFx.has(f.id)) continue;
      this.seenFx.add(f.id);
      out.push({ name: FX_SOUND[f.kind], pan: panAt(f.x) });
      if (f.kind === 'knall' && f.who && s.out.includes(f.who)) out.push({ name: 'geist_werden', pan: panAt(f.x) });
    }

    for (const [k, p] of Object.entries(s.players)) {
      const q = prev.players[k];
      if (!q) continue;
      const pan = panAt(p.x);
      const vol = k === self ? 1 : STEP_OTHERS;
      if (p.swing && !q.swing) out.push({ name: 'aktion.schubsen', volume: k === self ? 1 : 0.6, pan });
      if (p.stun && !q.stun) out.push({ name: 'aktion.geschubst', volume: k === self ? 1 : 0.6, pan });
      if (k === self && q.shoveCdMs > 0 && p.shoveCdMs <= 0) out.push({ name: 'aktion.schubs_bereit' });
      const moving = !p.ghost && Math.hypot(p.vx, p.vy) > 1;
      if (moving) {
        const acc = (this.stepMs.get(k) ?? STEP_MS) + dt;
        if (acc >= STEP_MS) {
          this.stepMs.set(k, acc % STEP_MS);
          out.push({ name: 'schritt_erde', volume: vol, pan });
        } else {
          this.stepMs.set(k, acc);
        }
      } else {
        // The first step after standing comes at once.
        this.stepMs.set(k, STEP_MS);
      }
    }

    if (s.phase === 'done' && prev.phase !== 'done') out.push({ name: 'letzter_uebrig' });
    return out;
  }
}

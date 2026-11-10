import { mulberry32 } from '../flow/rng';
import { neutralInput, type InputState } from '../net/protocol';
import type { BotView } from '../minigames/types';
import type { HostSession } from '../net/session';
import { defaultProfile, type Look } from '../save/profile';

/** Names of dev bots (`?dev=1&bots=N`). */
export const BOT_NAMES = ['Bot Krümel', 'Bot Mo', 'Bot Lotte'] as const;

const BOT_LOOKS: Partial<Look>[] = [
  { hair: 'wuschel', hairColor: 1, skin: 1, hat: null },
  { hair: 'zopf', hairColor: 2, skin: 2, hat: 'zylinder' },
  { hair: 'kurz', hairColor: 3, skin: 3, hat: null, glasses: 'rundbrille' },
];

/** Dev mode: add up to 3 always-ready bot players to a host session; returns their ids. */
export function addDevBots(session: HostSession, n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < Math.min(n, BOT_NAMES.length); i++) {
    const look: Look = { ...defaultProfile().look, ...BOT_LOOKS[i] };
    const p = session.addLocalPlayer(BOT_NAMES[i], look, { isBot: true });
    if (!p) break;
    session.setLocalReady(p.id, true);
    ids.push(p.id);
  }
  return ids;
}

const JITTER_CHANCE = 0.04; // per call (~30 Hz): roughly one detour per second
const JITTER_TICKS = 6;
const DEAD_ZONE = 2;
/** Chance per tick that a bot presses shove (about once every 1.5 s at 30 Hz). */
const SHOVE_CHANCE = 0.02;

/** Bot brain: walks toward the nearest target, with occasional random detours. */
export function createBotInputs(seed: number): (view: BotView) => InputState {
  const rand = mulberry32(seed);
  let detour: InputState | null = null;
  let detourLeft = 0;
  // Bots press shove now and then (the host decides whether it lands).
  let shoves = 0;

  const randomDir = (): InputState => {
    const s = neutralInput();
    const d = Math.floor(rand() * 8);
    s.up = d === 0 || d === 4 || d === 5;
    s.down = d === 1 || d === 6 || d === 7;
    s.left = d === 2 || d === 4 || d === 6;
    s.right = d === 3 || d === 5 || d === 7;
    return s;
  };

  const brain = (view: BotView): InputState => {
    if (detourLeft > 0 && detour) {
      detourLeft--;
      return { ...detour };
    }
    const { self, targets } = view;
    if (targets.length === 0 || rand() < JITTER_CHANCE) {
      detour = randomDir();
      detourLeft = JITTER_TICKS;
      return { ...detour };
    }
    let best = targets[0];
    let bestD = Infinity;
    for (const t of targets) {
      const d = Math.hypot(t.x - self.x, t.y - self.y);
      if (d < bestD) {
        best = t;
        bestD = d;
      }
    }
    const s = neutralInput();
    s.right = best.x > self.x + DEAD_ZONE;
    s.left = best.x < self.x - DEAD_ZONE;
    s.down = best.y > self.y + DEAD_ZONE;
    s.up = best.y < self.y - DEAD_ZONE;
    return s;
  };
  return (view) => {
    if (rand() < SHOVE_CHANCE) shoves++;
    return { ...brain(view), shoves };
  };
}

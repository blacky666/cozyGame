import { neutralInput, type InputState } from '../net/protocol';

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
/** Shove key: the thumb rests on it while the fingers are on WASD. */
export const SHOVE_KEY = 'Space';
const TURN_CCW = 'KeyQ';
const TURN_CW = 'KeyE';
const ALL = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, SHOVE_KEY, TURN_CCW, TURN_CW]);

/** Typing into a text field must never trigger game keys. */
const typing = (t: EventTarget | null): boolean =>
  typeof HTMLElement !== 'undefined' && t instanceof HTMLElement &&
  (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/** Build an InputState from pressed key codes (WASD; arrows as a fallback) and the shove count. */
export function inputFromKeys(
  down: ReadonlySet<string>,
  shoves = 0,
  extra: Partial<Pick<InputState, 'turnsCw' | 'turnsCcw' | 'drops'>> = {},
): InputState {
  const s = neutralInput();
  const any = (codes: string[]) => codes.some((c) => down.has(c));
  s.up = any(UP);
  s.down = any(DOWN);
  s.left = any(LEFT);
  s.right = any(RIGHT);
  s.shoves = shoves;
  Object.assign(s, extra);
  return s;
}

export interface KeyboardInput {
  state(): InputState;
  /** Presses only grow the shove counter while on (a running minigame); movement keys are unaffected. */
  setCounting(on: boolean): void;
  destroy(): void;
}

type KeyTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
export type KeyboardOptions = {
  win?: KeyTarget;
  doc?: KeyTarget & { hidden: boolean };
  /** Called when all keys were released because the window lost focus or the page got hidden. */
  onIdle?: () => void;
};

/** Window-level key reader: independent of Phaser scenes, cleared on blur and when the page gets hidden. */
export function createKeyboard(o: KeyboardOptions = {}): KeyboardInput {
  const win = o.win ?? window;
  const doc = o.doc ?? document;
  const down = new Set<string>();
  let shoves = 0;
  let turnsCw = 0;
  let turnsCcw = 0;
  let drops = 0;
  let counting = false;
  const onDown = (e: Event) => {
    const { code, repeat } = e as KeyboardEvent;
    // Typing into a text field must never trigger game keys.
    if (!ALL.has(code) || typing(e.target)) return;
    // Count fresh presses only: holding the key (auto-repeat) is one shove.
    if (counting && !repeat && !down.has(code)) {
      if (code === SHOVE_KEY) shoves++;
      else if (code === TURN_CW) turnsCw++;
      else if (code === TURN_CCW) turnsCcw++;
      else if (DOWN.includes(code)) drops++;
    }
    down.add(code);
    e.preventDefault();
  };
  const onUp = (e: Event) => void down.delete((e as KeyboardEvent).code);
  const release = () => {
    down.clear();
    o.onIdle?.();
  };
  const onVisibility = () => {
    if (doc.hidden) release();
  };
  win.addEventListener('keydown', onDown);
  win.addEventListener('keyup', onUp);
  win.addEventListener('blur', release);
  doc.addEventListener('visibilitychange', onVisibility);
  return {
    state: () => inputFromKeys(down, shoves, { turnsCw, turnsCcw, drops }),
    setCounting(on) {
      counting = on;
    },
    destroy() {
      win.removeEventListener('keydown', onDown);
      win.removeEventListener('keyup', onUp);
      win.removeEventListener('blur', release);
      doc.removeEventListener('visibilitychange', onVisibility);
      down.clear();
    },
  };
}

import { neutralInput, type InputState } from '../net/protocol';

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const ALL = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT]);

/** Build an InputState from pressed key codes (WASD; arrows as a fallback). */
export function inputFromKeys(down: ReadonlySet<string>): InputState {
  const s = neutralInput();
  const any = (codes: string[]) => codes.some((c) => down.has(c));
  s.up = any(UP);
  s.down = any(DOWN);
  s.left = any(LEFT);
  s.right = any(RIGHT);
  return s;
}

export interface KeyboardInput {
  state(): InputState;
  destroy(): void;
}

/** Window-level key reader: independent of Phaser scenes, cleared on blur. */
export function createKeyboard(target: Window = window): KeyboardInput {
  const down = new Set<string>();
  const onDown = (e: KeyboardEvent) => {
    if (!ALL.has(e.code)) return;
    down.add(e.code);
    e.preventDefault();
  };
  const onUp = (e: KeyboardEvent) => void down.delete(e.code);
  const onBlur = () => down.clear();
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return {
    state: () => inputFromKeys(down),
    destroy() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
      down.clear();
    },
  };
}

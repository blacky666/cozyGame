import { describe, expect, it } from 'vitest';
import { createKeyboard, inputFromKeys } from './keyboard';

describe('inputFromKeys', () => {
  it('maps WASD to directions', () => {
    const s = inputFromKeys(new Set(['KeyW', 'KeyD']));
    expect([s.up, s.down, s.left, s.right]).toEqual([true, false, false, true]);
    expect(inputFromKeys(new Set(['KeyA', 'KeyS']))).toMatchObject({ left: true, down: true, up: false, right: false });
    expect(inputFromKeys(new Set())).toMatchObject({ up: false, down: false, left: false, right: false });
  });
});

/** Minimal stand-ins for window/document in the node test env. */
class FakeTarget extends EventTarget {
  hidden = false;
}
const key = (type: string, code: string) => Object.assign(new Event(type), { code, preventDefault() {} });

describe('createKeyboard', () => {
  it('releases all keys and reports idle on blur and when the document gets hidden', () => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    let idle = 0;
    const kb = createKeyboard({ win, doc, onIdle: () => idle++ });
    win.dispatchEvent(key('keydown', 'KeyD'));
    expect(kb.state().right).toBe(true);
    win.dispatchEvent(new Event('blur'));
    expect(kb.state().right).toBe(false);
    expect(idle).toBe(1);

    win.dispatchEvent(key('keydown', 'KeyW'));
    doc.dispatchEvent(new Event('visibilitychange')); // still visible: ignored
    expect(kb.state().up).toBe(true);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(kb.state().up).toBe(false);
    expect(idle).toBe(2);

    kb.destroy();
    win.dispatchEvent(new Event('blur'));
    expect(idle).toBe(2);
  });

  it('counts fresh presses of E as shoves (auto-repeat and holding count once)', () => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    const kb = createKeyboard({ win, doc });
    expect(kb.state().shoves).toBe(0);
    win.dispatchEvent(key('keydown', 'KeyE'));
    win.dispatchEvent(Object.assign(key('keydown', 'KeyE'), { repeat: true }));
    win.dispatchEvent(key('keydown', 'KeyE')); // still held, no keyup yet
    expect(kb.state().shoves).toBe(1);
    win.dispatchEvent(key('keyup', 'KeyE'));
    win.dispatchEvent(key('keydown', 'KeyE'));
    expect(kb.state().shoves).toBe(2);
    win.dispatchEvent(new Event('blur'));
    expect(kb.state().shoves).toBe(2);
    kb.destroy();
  });
});

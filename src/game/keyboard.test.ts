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

  it('counts fresh presses of Space as shoves (auto-repeat and holding count once)', () => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    const kb = createKeyboard({ win, doc });
    kb.setCounting(true);
    expect(kb.state().shoves).toBe(0);
    win.dispatchEvent(key('keydown', 'Space'));
    win.dispatchEvent(Object.assign(key('keydown', 'Space'), { repeat: true }));
    win.dispatchEvent(key('keydown', 'Space')); // still held, no keyup yet
    expect(kb.state().shoves).toBe(1);
    win.dispatchEvent(key('keyup', 'Space'));
    win.dispatchEvent(key('keydown', 'Space'));
    expect(kb.state().shoves).toBe(2);
    win.dispatchEvent(new Event('blur'));
    expect(kb.state().shoves).toBe(2);
    kb.destroy();
  });

  it('does not count Space while counting is off', () => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    const kb = createKeyboard({ win, doc });
    kb.setCounting(false);
    win.dispatchEvent(key('keydown', 'Space'));
    win.dispatchEvent(key('keyup', 'Space'));
    expect(kb.state().shoves).toBe(0);
    kb.setCounting(true);
    win.dispatchEvent(key('keydown', 'Space'));
    expect(kb.state().shoves).toBe(1);
    kb.destroy();
  });
});

describe('createKeyboard turns and drops', () => {
  it('Q/E count turns only while counting; holding E (repeat) is one turn', () => {
    const win = new FakeTarget();
    const kb = createKeyboard({ win, doc: new FakeTarget() });
    win.dispatchEvent(key('keydown', 'KeyE'));
    win.dispatchEvent(key('keyup', 'KeyE'));
    expect(kb.state()).toMatchObject({ turnsCw: 0, turnsCcw: 0 });
    kb.setCounting(true);
    win.dispatchEvent(key('keydown', 'KeyE'));
    win.dispatchEvent(Object.assign(key('keydown', 'KeyE'), { repeat: true }));
    win.dispatchEvent(key('keyup', 'KeyE'));
    win.dispatchEvent(key('keydown', 'KeyQ'));
    expect(kb.state()).toMatchObject({ turnsCw: 1, turnsCcw: 1, drops: 0 });
    kb.destroy();
  });

  it('S press counts a drop and sets down', () => {
    const win = new FakeTarget();
    const kb = createKeyboard({ win, doc: new FakeTarget() });
    kb.setCounting(true);
    win.dispatchEvent(key('keydown', 'KeyS'));
    win.dispatchEvent(Object.assign(key('keydown', 'KeyS'), { repeat: true }));
    expect(kb.state()).toMatchObject({ drops: 1, down: true });
    win.dispatchEvent(key('keyup', 'KeyS'));
    win.dispatchEvent(key('keydown', 'ArrowDown'));
    expect(kb.state().drops).toBe(2);
    kb.destroy();
  });
});

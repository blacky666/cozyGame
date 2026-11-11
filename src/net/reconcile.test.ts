import { describe, expect, it } from 'vitest';
import { neutralInput, type InputState } from './protocol';
import { Reconciler } from './reconcile';

const step = (p: { x: number }, i: InputState, dt: number) => ({ x: p.x + (i.right ? 60 * dt : 0) });
const right = { ...neutralInput(), right: true };

describe('Reconciler', () => {
  it('replays frames the host has not acknowledged yet', () => {
    const r = new Reconciler(step);
    r.record(1, right, 0.1);
    r.record(1, right, 0.1);
    r.record(2, right, 0.1);
    expect(r.reconcile({ x: 100 }, 1).x).toBeCloseTo(106); // only the seq-2 frame is replayed
    expect(r.reconcile({ x: 100 }, 2).x).toBeCloseTo(100);
  });

  it('acks restart after a reconnect', () => {
    const r = new Reconciler(step);
    r.record(50, right, 0.1);
    r.clear(); // new connection: seq starts at 1 again
    r.record(1, right, 0.1);
    expect(r.reconcile({ x: 0 }, 0).x).toBeCloseTo(6);
  });

  it('caps the history at 120 frames', () => {
    const r = new Reconciler(step);
    for (let i = 0; i < 200; i++) r.record(1, right, 0.1);
    expect(r.reconcile({ x: 0 }, 0).x).toBeCloseTo(120 * 6);
  });
});

describe('Reconciler under constant movement', () => {
  it('stays on the intended path when a seq covers one host tick', () => {
    const r = new Reconciler(step);
    const dt = 1 / 60;
    const lat = 50;
    const sent: Array<{ at: number; seq: number }> = [];
    let seq = 0;
    let lastSend = -Infinity;
    let host = { x: 0 };
    let hostSeq = 0;
    let truth = { x: 0 };
    let shown = { x: 0 };
    for (let f = 1; f <= 60; f++) {
      const t = f * dt * 1000;
      if (t - lastSend >= 33) {
        sent.push({ at: t + lat, seq: ++seq });
        lastSend = t;
      }
      truth = step(truth, right, dt);
      r.record(seq, right, dt);
      // Host processes arrived inputs on a 30 Hz grid and acks them.
      for (let n = Math.floor((t - dt * 1000) / 33.3); n < Math.floor(t / 33.3); n++) {
        const arrived = sent.filter((s) => s.at <= (n + 1) * 33.3);
        const last = arrived.at(-1);
        if (last && last.seq > 0) {
          host = step(host, right, 1 / 30);
          hostSeq = last.seq;
        }
      }
      shown = r.reconcile(host, hostSeq);
    }
    expect(Math.abs(shown.x - truth.x)).toBeLessThan(2);
  });
});

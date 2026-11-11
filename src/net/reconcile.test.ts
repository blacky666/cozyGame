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

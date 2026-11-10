import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from './interpolation';

type S = { x: number };
const lerp = (a: S, b: S, t: number): S => ({ x: a.x + (b.x - a.x) * t });

describe('SnapshotBuffer', () => {
  it('returns null when empty', () => {
    expect(new SnapshotBuffer<S>().sample(0, lerp)).toBeNull();
  });
  it('interpolates between two snapshots', () => {
    const b = new SnapshotBuffer<S>();
    b.push(1, 0, { x: 0 });
    b.push(2, 50, { x: 10 });
    expect(b.sample(25, lerp)).toEqual({ x: 5 });
  });
  it('clamps to the first snapshot before the start', () => {
    const b = new SnapshotBuffer<S>();
    b.push(1, 100, { x: 3 });
    b.push(2, 150, { x: 10 });
    expect(b.sample(20, lerp)).toEqual({ x: 3 });
  });
  it('clamps to the last snapshot after the end (no extrapolation)', () => {
    const b = new SnapshotBuffer<S>();
    b.push(1, 0, { x: 0 });
    b.push(2, 50, { x: 10 });
    expect(b.sample(500, lerp)).toEqual({ x: 10 });
  });
  it('drops stale or duplicate ticks', () => {
    const b = new SnapshotBuffer<S>();
    b.push(2, 0, { x: 0 });
    b.push(1, 10, { x: 99 });
    b.push(2, 20, { x: 99 });
    b.push(3, 50, { x: 10 });
    expect(b.sample(25, lerp)).toEqual({ x: 5 });
  });
});

import { describe, expect, it } from 'vitest';
import { createLocalHub } from './transport';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('LocalHub', () => {
  it('broadcasts to all other peers with from set', async () => {
    const hub = createLocalHub();
    const a = hub.join(), b = hub.join(), c = hub.join();
    const got: Array<[string, unknown, string]> = [];
    const self: unknown[] = [];
    b.on('input', (d, f) => got.push(['b', d, f]));
    c.on('input', (d, f) => got.push(['c', d, f]));
    a.on('input', (d) => self.push(d));
    a.send('input', { n: 1 });
    expect(got).toHaveLength(0); // async delivery
    await tick();
    expect(got).toEqual([['b', { n: 1 }, a.selfId], ['c', { n: 1 }, a.selfId]]);
    expect(self).toHaveLength(0);
  });
  it('targets a single peer', async () => {
    const hub = createLocalHub();
    const a = hub.join(), b = hub.join(), c = hub.join();
    const gb: unknown[] = [], gc: unknown[] = [];
    b.on('hello', (d) => gb.push(d));
    c.on('hello', (d) => gc.push(d));
    a.send('hello', 'x', b.selfId);
    await tick();
    expect(gb).toEqual(['x']);
    expect(gc).toEqual([]);
  });
  it('keeps order', async () => {
    const hub = createLocalHub();
    const a = hub.join(), b = hub.join();
    const got: unknown[] = [];
    b.on('input', (d) => got.push(d));
    for (let i = 0; i < 5; i++) a.send('input', i);
    await tick();
    expect(got).toEqual([0, 1, 2, 3, 4]);
  });
  it('join is symmetric', async () => {
    const hub = createLocalHub();
    const a = hub.join();
    const aSaw: string[] = [], bSaw: string[] = [];
    a.onPeerJoin((id) => aSaw.push(id));
    const b = hub.join();
    b.onPeerJoin((id) => bSaw.push(id));
    await tick();
    expect(aSaw).toEqual([b.selfId]);
    expect(bSaw).toEqual([a.selfId]);
  });
  it('fires join and leave events', async () => {
    const hub = createLocalHub();
    const a = hub.join();
    const joined: string[] = [], left: string[] = [];
    a.onPeerJoin((id) => joined.push(id));
    a.onPeerLeave((id) => left.push(id));
    const b = hub.join();
    const c = hub.join();
    b.leave();
    expect(joined).toEqual([b.selfId, c.selfId]);
    expect(left).toEqual([b.selfId]);
    // left peer no longer receives
    const got: unknown[] = [];
    b.on('input', (d) => got.push(d));
    a.send('input', 1);
    await tick();
    expect(got).toEqual([]);
  });
});

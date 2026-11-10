type Entry<T> = { tick: number; time: number; s: T };

/** Client-side snapshot buffer; sample at (now - CONFIG.net.interpDelayMs). Never extrapolates. */
export class SnapshotBuffer<T> {
  private entries: Entry<T>[] = [];

  constructor(private readonly capacity = 32) {}

  push(tick: number, time: number, s: T): void {
    const last = this.entries[this.entries.length - 1];
    if (last && (tick <= last.tick || time < last.time)) return; // stale or reordered
    this.entries.push({ tick, time, s });
    if (this.entries.length > this.capacity) this.entries.shift();
  }

  sample(renderTime: number, lerp: (a: T, b: T, t: number) => T): T | null {
    const e = this.entries;
    if (e.length === 0) return null;
    if (renderTime <= e[0].time) return e[0].s;
    const last = e[e.length - 1];
    if (renderTime >= last.time) return last.s;
    for (let i = e.length - 1; i > 0; i--) {
      const a = e[i - 1];
      if (a.time <= renderTime) {
        const b = e[i];
        const span = b.time - a.time;
        return span > 0 ? lerp(a.s, b.s, (renderTime - a.time) / span) : b.s;
      }
    }
    return last.s;
  }

  clear(): void {
    this.entries = [];
  }
}

/**
 * Turns a monotonically growing press counter into "new presses since the last call".
 * The first call only sets the baseline (counters keep growing across rounds while a new host
 * starts fresh, so the first value is no press).
 */
export class Edge {
  private seen: number | null = null;

  take(counter: number): number {
    if (this.seen === null) {
      this.seen = counter;
      return 0;
    }
    if (counter < this.seen) {
      // Counter dropped (client reconnected / reset): re-base without firing.
      this.seen = counter;
      return 0;
    }
    const n = counter - this.seen;
    this.seen = counter;
    return n;
  }
}

/** Turns a monotonically growing press counter into "new presses since the last call". */
export class Edge {
  private seen = 0;

  take(counter: number): number {
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

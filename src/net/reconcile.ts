import type { InputState } from './protocol';

const MAX_FRAMES = 120;

type Frame = { seq: number; input: InputState; dt: number };

/**
 * Client-side reconciliation: remembers every locally simulated frame tagged with the seq of the
 * latest input sent. Given an authoritative state and the seq the host has processed, it replays
 * the frames the host has not seen yet on top of that state.
 */
export class Reconciler<P> {
  private frames: Frame[] = [];

  constructor(private readonly step: (p: P, input: InputState, dt: number) => P) {}

  record(seq: number, input: InputState, dt: number): void {
    this.frames.push({ seq, input, dt });
    if (this.frames.length > MAX_FRAMES) this.frames.splice(0, this.frames.length - MAX_FRAMES);
  }

  reconcile(server: P, ackSeq: number): P {
    this.frames = this.frames.filter((f) => f.seq > ackSeq);
    return this.frames.reduce((p, f) => this.step(p, f.input, f.dt), server);
  }

  clear(): void {
    this.frames = [];
  }
}

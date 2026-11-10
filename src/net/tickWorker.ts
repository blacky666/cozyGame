// Dedicated worker: timers in workers are not throttled like those of a background tab,
// so the host simulation keeps running when its tab is not focused.
let timer: ReturnType<typeof setInterval> | undefined;
const scope = self as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(m: unknown): void;
};

scope.onmessage = (ev: MessageEvent) => {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  const hz = (ev.data as { hz?: unknown } | null)?.hz;
  if (typeof hz === 'number' && hz > 0 && Number.isFinite(hz)) {
    timer = setInterval(() => scope.postMessage(0), 1000 / hz);
  }
};

import { setTimeout as delay } from 'node:timers/promises';
import { AuroraError } from './errors.js';

export function abortError(signal: AbortSignal): AuroraError {
  return new AuroraError(signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED');
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function wait(ms: number, signal: AbortSignal): Promise<void> {
  try { await delay(ms, undefined, { signal }); }
  catch { throw abortError(signal); }
}

type Waiter = {
  signal: AbortSignal;
  start: () => void;
  cancel: () => void;
};

/** Bounds concurrency, queue length and request starts, including retries/bootstrap. */
export class RequestGate {
  private active = 0;
  private nextStart = 0;
  private queue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly intervalMs = 250, private readonly concurrency = 2) {}

  async run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw abortError(signal);
    if (this.queue.length >= 64) throw new AuroraError('BUSY');
    await new Promise<void>((resolve, reject) => {
      const entry: Waiter = {
        signal,
        start: () => { signal.removeEventListener('abort', entry.cancel); resolve(); },
        cancel: () => {
          this.queue = this.queue.filter((item) => item !== entry);
          reject(abortError(signal));
          this.pump();
        },
      };
      signal.addEventListener('abort', entry.cancel, { once: true });
      this.queue.push(entry);
      this.pump();
    });
    try {
      if (signal.aborted) throw abortError(signal);
      return await work();
    } finally { this.active--; this.pump(); }
  }

  private pump(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (!this.queue.length || this.active >= this.concurrency) return;
    const pause = Math.max(0, this.nextStart - Date.now());
    if (pause) {
      this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, pause);
      return;
    }
    const entry = this.queue.shift();
    if (!entry) return;
    this.active++;
    this.nextStart = Date.now() + this.intervalMs;
    entry.start();
    this.pump();
  }
}

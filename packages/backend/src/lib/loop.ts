/**
 * Hardened background-loop primitive — every periodic backend job runs
 * through this instead of a raw setInterval.
 *
 * Guarantees:
 * - Non-overlapping: the next tick is scheduled only after the previous one
 *   settles (setTimeout chaining, not setInterval).
 * - Never throws out: a failing tick is caught, logged, and retried with
 *   exponential backoff + jitter (5s → 5min cap) instead of killing the loop
 *   or — worse — crashing the process via an unhandled rejection.
 * - A successful tick resets the backoff.
 *
 * Previously each service rolled its own setInterval + `ticking` flag +
 * ad-hoc try/catch; several had no catch at all (an unhandled rejection in
 * a timer callback crashes Node).
 */
import { logger } from "./logger.js";

export interface LoopHandle {
  readonly name: string;
  stop(): void;
}

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export function runLoop(
  name: string,
  intervalMs: number,
  fn: () => Promise<void> | void,
  opts: { immediate?: boolean } = {}
): LoopHandle {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let failures = 0;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delayMs);
    timer.unref?.();
  };

  const run = async (): Promise<void> => {
    if (stopped) return;
    try {
      await fn();
      failures = 0;
      schedule(intervalMs);
    } catch (err) {
      failures += 1;
      const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
      const jitterMs = Math.random() * 1_000;
      const nextInMs = intervalMs + backoffMs + jitterMs;
      logger.error(`[loop:${name}] tick failed — backing off`, {
        failures,
        nextInMs: Math.round(nextInMs),
        error: String(err),
      });
      schedule(nextInMs);
    }
  };

  logger.info(`[loop:${name}] started`, { intervalMs });
  if (opts.immediate === false) schedule(intervalMs);
  else void run();

  return {
    name,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      logger.info(`[loop:${name}] stopped`);
    },
  };
}

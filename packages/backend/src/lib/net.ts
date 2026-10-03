/**
 * Process-level safety net + lightweight resource metering.
 *
 * 1. `installProcessGuards()` — the backend previously had NO
 *    unhandledRejection/uncaughtException handler, so any unhandled promise
 *    rejection anywhere (a timer callback, an event handler) crashed the
 *    whole process under Node's default behavior. Now:
 *    - unhandledRejection → logged, process continues (the loop primitive
 *      in lib/loop.ts already retries the failed work).
 *    - uncaughtException → logged, registered shutdown hooks run, exit(1).
 *      An uncaught exception means unknown state; restarting clean is safer
 *      than limping on (the process manager / container restarts us).
 *
 * 2. `meter` — cheap in-process counters for the 1 GB/month bandwidth
 *    budget. This is an *instrumented estimate*, not kernel-level accounting:
 *    subsystems call meter.count() at the points they touch the network, and
 *    /health exposes totals + a 30-day projection. Call `meter.checkBudget()`
 *    periodically (the health endpoint does) to get a warning log when the
 *    projection crosses 800 MB.
 */
import { logger } from "./logger.js";

type ShutdownHook = () => void | Promise<void>;
const shutdownHooks: ShutdownHook[] = [];

/** Register a hook that runs before exit on uncaughtException. */
export function onShutdown(hook: ShutdownHook): void {
  shutdownHooks.push(hook);
}

let guardsInstalled = false;

/** Install once, first thing in main(). */
export function installProcessGuards(): void {
  if (guardsInstalled) return;
  guardsInstalled = true;

  process.on("unhandledRejection", (reason: unknown) => {
    // A rejected promise nobody awaited. Log it loudly and keep running —
    // every background loop already has its own retry via lib/loop.ts, so
    // crashing the process here would turn a transient blip into downtime.
    logger.error("[net] unhandledRejection — continuing (check the loop that dropped it)", {
      reason: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
    });
  });

  process.on("uncaughtException", (err: Error) => {
    // Unknown state — shut down cleanly and let the supervisor restart us.
    logger.error("[net] uncaughtException — shutting down", {
      error: err.stack ?? err.message,
    });
    void (async () => {
      for (const hook of shutdownHooks) {
        try {
          await hook();
        } catch (hookErr) {
          logger.warn("[net] shutdown hook failed", { error: String(hookErr) });
        }
      }
      process.exit(1);
    })();
  });
}

// --- bandwidth / call metering ----------------------------------------------

const MONTH_MS = 30 * 24 * 3600 * 1000;
/** Warn when the 30-day projection crosses 80% of the 1 GB budget. */
export const BANDWIDTH_WARN_BYTES = 800 * 1024 * 1024;

class Meter {
  private readonly counts = new Map<string, number>();
  private readonly startedAt = Date.now();

  count(key: string, n = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }

  snapshot(): {
    uptimeMs: number;
    counts: Record<string, number>;
    projectedMonthly: Record<string, number>;
  } {
    const uptimeMs = Date.now() - this.startedAt;
    const counts: Record<string, number> = {};
    const projectedMonthly: Record<string, number> = {};
    for (const [k, v] of this.counts) {
      counts[k] = v;
      projectedMonthly[k] = uptimeMs > 0 ? Math.round((v / uptimeMs) * MONTH_MS) : 0;
    }
    return { uptimeMs, counts, projectedMonthly };
  }

  /** Log a warning if projected egress is over budget. Returns the projection. */
  checkBudget(): number {
    const projected = this.snapshot().projectedMonthly["egress_bytes"] ?? 0;
    if (projected > BANDWIDTH_WARN_BYTES) {
      logger.warn("[net] bandwidth projection over budget", {
        projectedMonthlyBytes: projected,
        warnAtBytes: BANDWIDTH_WARN_BYTES,
      });
    }
    return projected;
  }
}

export const meter = new Meter();

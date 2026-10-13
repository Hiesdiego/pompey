



















import { logger } from "./logger.js";

type ShutdownHook = () => void | Promise<void>;
const shutdownHooks: ShutdownHook[] = [];


export function onShutdown(hook: ShutdownHook): void {
  shutdownHooks.push(hook);
}

let guardsInstalled = false;


export function installProcessGuards(): void {
  if (guardsInstalled) return;
  guardsInstalled = true;

  process.on("unhandledRejection", (reason: unknown) => {



    logger.error("[net] unhandledRejection — continuing (check the loop that dropped it)", {
      reason: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
    });
  });

  process.on("uncaughtException", (err: Error) => {

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



const MONTH_MS = 30 * 24 * 3600 * 1000;

export const BANDWIDTH_WARN_BYTES = Math.round(2.4 * 1024 * 1024 * 1024);

class Meter {
  private readonly counts = new Map<string, number>();
  private readonly startedAt = Date.now();
  private lastBudgetWarningAt = 0;

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


  checkBudget(): number {
    const projected = Object.entries(this.snapshot().projectedMonthly)
      .filter(([key]) => key.startsWith("outbound_bytes:"))
      .reduce((sum, [, bytes]) => sum + bytes, 0);
    const now = Date.now();
    if (now - this.startedAt >= 60 * 60_000 &&
        projected > BANDWIDTH_WARN_BYTES &&
        now - this.lastBudgetWarningAt >= 60 * 60_000) {
      this.lastBudgetWarningAt = now;
      logger.warn("[net] bandwidth projection over budget", {
        projectedMonthlyBytes: projected,
        warnAtBytes: BANDWIDTH_WARN_BYTES,
      });
    }
    return projected;
  }
}

export const meter = new Meter();

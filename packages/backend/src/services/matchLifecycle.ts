/**
 * Match lifecycle — kickoff monitor (spec P2.5) + match timer (spec P2.6).
 *
 * One 30-second loop drives the whole on-chain match flow:
 *
 *   1. REVEAL — for every fixture whose matchday window has opened but whose
 *      kickoff is still secret: revealKickoff(now + leadMinutes). All of a
 *      matchday's fixtures are revealed in the same pass, so they kick off
 *      together like a real football matchday. If the window is too far gone
 *      for a legal reveal (kickoff would land outside 30–120 min or outside
 *      the window), the fixture is flagged for manual review — never send a
 *      doomed transaction.
 *   2. START — when now >= kickoff and the start snapshot isn't on-chain:
 *      validate both teams' prices → PriceOracle.submitStartPrice.
 *   3. END — when now >= kickoff + matchDuration: validate prices →
 *      PriceOracle.submitEndPrice, which cascades into ResultEngine →
 *      league table, MatchRegistry.markSettled, PredictionPool.settleFixture.
 *      If the start snapshot is missing (backend was down over the start
 *      window), the submitter performs a late-start recovery first so the
 *      fixture can still settle instead of reverting forever.
 *
 * Idempotency: every step pre-checks on-chain state AND the contracts revert
 * on double-submit, so restarts and overlapping ticks are safe. One fixture
 * failing never blocks the others. A per-fixture exponential backoff keeps a
 * persistently failing fixture from spamming doomed transactions every tick.
 * Multiple concurrent matches are handled independently (the signer's TxQueue
 * serializes the actual transactions).
 */

import { createPublicClient, http, type PublicClient } from "viem";
import { baseSepolia, base } from "viem/chains";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { PriceFeed } from "./priceFeed.js";
import { PriceUnavailableError, PriceValidationError } from "./priceFeed.js";
import { SnapshotSubmitter } from "./snapshotSubmitter.js";

const REGISTRY_READ_ABI = [
  {
    type: "function",
    name: "fixtureCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getFixture",
    stateMutability: "view",
    inputs: [{ name: "fixtureId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "homeTeamId", type: "uint16" },
          { name: "awayTeamId", type: "uint16" },
          { name: "matchdayIndex", type: "uint8" },
          { name: "windowStart", type: "uint64" },
          { name: "windowEnd", type: "uint64" },
          { name: "kickoffTimestamp", type: "uint64" },
          { name: "kickoffRevealed", type: "bool" },
          { name: "settled", type: "bool" },
        ],
      },
    ],
  },
] as const;

export interface FixtureView {
  fixtureId: bigint;
  homeTeamId: number;
  awayTeamId: number;
  matchdayIndex: number;
  windowStartMs: number;
  windowEndMs: number;
  kickoffMs: number; // 0 until revealed
  kickoffRevealed: boolean;
  settled: boolean;
}

/** In-memory fixture cache. Revealed+settled fixtures are immutable → cached forever. */
class FixtureCache {
  private fixtures = new Map<bigint, FixtureView>();

  constructor(private readonly publicClient: PublicClient) {}

  async loadAll(): Promise<void> {
    const count = (await this.publicClient.readContract({
      address: config.contracts.matchRegistrySeason1,
      abi: REGISTRY_READ_ABI,
      functionName: "fixtureCount",
    })) as bigint;
    logger.info("[FixtureCache] loading fixtures", { count: count.toString() });

    // Chunked reads — kind to public RPC rate limits.
    const CHUNK = 25;
    for (let start = 0n; start < count; start += BigInt(CHUNK)) {
      const end = start + BigInt(CHUNK) > count ? count : start + BigInt(CHUNK);
      const ids: bigint[] = [];
      for (let i = start; i < end; i++) ids.push(i);
      const results = await Promise.all(ids.map((id) => this.readFixture(id)));
      for (const f of results) this.fixtures.set(f.fixtureId, f);
    }
    logger.info("[FixtureCache] loaded", { fixtures: this.fixtures.size });
  }

  /** Re-read every fixture that can still change (unrevealed or unsettled). */
  async refresh(): Promise<void> {
    const mutable = [...this.fixtures.values()].filter((f) => !f.settled);
    if (mutable.length === 0) return;
    const CHUNK = 25;
    for (let i = 0; i < mutable.length; i += CHUNK) {
      const chunk = mutable.slice(i, i + CHUNK);
      const results = await Promise.all(chunk.map((f) => this.readFixture(f.fixtureId)));
      for (const f of results) this.fixtures.set(f.fixtureId, f);
    }
  }

  private async readFixture(fixtureId: bigint): Promise<FixtureView> {
    const f = (await this.publicClient.readContract({
      address: config.contracts.matchRegistrySeason1,
      abi: REGISTRY_READ_ABI,
      functionName: "getFixture",
      args: [fixtureId],
    })) as {
      homeTeamId: number;
      awayTeamId: number;
      matchdayIndex: number;
      windowStart: bigint;
      windowEnd: bigint;
      kickoffTimestamp: bigint;
      kickoffRevealed: boolean;
      settled: boolean;
    };
    return {
      fixtureId,
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
      matchdayIndex: f.matchdayIndex,
      windowStartMs: Number(f.windowStart) * 1000,
      windowEndMs: Number(f.windowEnd) * 1000,
      kickoffMs: Number(f.kickoffTimestamp) * 1000,
      kickoffRevealed: f.kickoffRevealed,
      settled: f.settled,
    };
  }

  all(): FixtureView[] {
    return [...this.fixtures.values()].sort((a, b) =>
      a.fixtureId < b.fixtureId ? -1 : 1
    );
  }

  get size(): number {
    return this.fixtures.size;
  }
}

/**
 * Per-fixture failure backoff: a fixture whose processing keeps throwing
 * (bad signer, deterministic revert, RPC trouble) waits progressively longer
 * between retries — 1m, 2m, 4m … capped at 30m — instead of firing a doomed
 * transaction every 30s tick. Success clears the backoff.
 */
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;

interface FailureState {
  count: number;
  nextRetryAtMs: number;
}

export class MatchLifecycle {
  private readonly cache: FixtureCache;
  private readonly durationMs: number;
  private readonly leadMs: number;
  private readonly failures = new Map<bigint, FailureState>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly feed: PriceFeed,
    private readonly submitter: SnapshotSubmitter,
    publicClient?: PublicClient
  ) {
    const chain = config.chainEnv === "mainnet" ? base : baseSepolia;
    const rpcUrl =
      config.chainEnv === "mainnet" ? config.baseMainnetRpcUrl : config.baseSepoliaRpcUrl;
    const client =
      publicClient ?? (createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient);
    this.cache = new FixtureCache(client);
    this.durationMs = config.leagues.main.matchDurationMinutes * 60 * 1000;
    this.leadMs = config.kickoff.leadMinutes * 60 * 1000;
  }

  async start(): Promise<void> {
    await this.cache.loadAll();
    if (this.cache.size === 0) {
      logger.warn(
        "[MatchLifecycle] no fixtures on-chain yet — the schedule has not been generated. " +
          "Lifecycle loop running idle until fixtures exist."
      );
    }
    logger.info("[MatchLifecycle] starting", {
      tickIntervalMs: config.kickoff.tickIntervalMs,
      matchDurationMin: config.leagues.main.matchDurationMinutes,
      kickoffLeadMin: config.kickoff.leadMinutes,
    });
    this.timer = setInterval(() => void this.tick(), config.kickoff.tickIntervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Read-only fixture list for the REST API. */
  getFixtures(): FixtureView[] {
    return this.cache.all();
  }

  private async tick(): Promise<void> {
    if (this.ticking) return; // never overlap ticks
    this.ticking = true;
    try {
      await this.cache.refresh();
      await this.revealDueKickoffs();
      await this.processLiveMatches();
    } catch (err) {
      logger.error("[MatchLifecycle] tick failed", { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  // ------------------------------------------------------------- P2.5 reveal

  private async revealDueKickoffs(): Promise<void> {
    const now = Date.now();
    const due = this.cache
      .all()
      .filter(
        (f) => !f.kickoffRevealed && !f.settled && f.windowStartMs <= now && now < f.windowEndMs
      );
    for (const f of due) {
      const kickoffMs = now + this.leadMs;
      // Legal reveal requires kickoff within [now+30min, now+120min] AND inside the window.
      if (kickoffMs > f.windowEndMs || this.leadMs < 30 * 60 * 1000 || this.leadMs > 120 * 60 * 1000) {
        logger.error("[MatchLifecycle] MISSED reveal window — manual review required", {
          fixtureId: f.fixtureId.toString(),
          matchday: f.matchdayIndex,
          windowEnd: new Date(f.windowEndMs).toISOString(),
        });
        continue;
      }
      try {
        const kickoffSec = BigInt(Math.floor(kickoffMs / 1000));
        await this.submitter.revealKickoff(f.fixtureId, kickoffSec);
        // Update the cache optimistically — the tx is queued; refresh() will confirm.
        f.kickoffRevealed = true;
        f.kickoffMs = kickoffMs;
      } catch (err) {
        logger.error("[MatchLifecycle] revealKickoff failed", {
          fixtureId: f.fixtureId.toString(),
          error: String(err),
        });
      }
    }
    if (due.length > 0) logger.info("[MatchLifecycle] reveal pass complete", { count: due.length });
  }

  // ------------------------------------------------------------- P2.6 match timer

  private async processLiveMatches(): Promise<void> {
    const now = Date.now();
    const live = this.cache
      .all()
      .filter((f) => f.kickoffRevealed && !f.settled && f.kickoffMs <= now);
    for (const f of live) {
      const failure = this.failures.get(f.fixtureId);
      if (failure && now < failure.nextRetryAtMs) continue; // backing off
      try {
        await this.processFixture(f, now);
        if (failure) this.failures.delete(f.fixtureId); // success resets backoff
      } catch (err) {
        // One fixture failing must never block the others — and a
        // persistently failing fixture must not spam doomed txs every tick.
        const count = (failure?.count ?? 0) + 1;
        const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS);
        this.failures.set(f.fixtureId, { count, nextRetryAtMs: now + backoffMs });
        logger.error("[MatchLifecycle] fixture processing failed", {
          fixtureId: f.fixtureId.toString(),
          attempt: count,
          nextRetryInMin: Math.round(backoffMs / 60_000),
          error: String(err),
        });
      }
    }
  }

  private async processFixture(f: FixtureView, now: number): Promise<void> {
    const matchEndMs = f.kickoffMs + this.durationMs;
    const wantEnd = now >= matchEndMs;

    let home, away;
    try {
      home = this.feed.getValidatedPrice(f.homeTeamId);
      away = this.feed.getValidatedPrice(f.awayTeamId);
    } catch (err) {
      if (err instanceof PriceValidationError || err instanceof PriceUnavailableError) {
        // Feeds disagree or are down → do NOT submit. Retry next tick.
        logger.warn("[MatchLifecycle] snapshot blocked by price validation", {
          fixtureId: f.fixtureId.toString(),
          wantEnd,
          error: err.message,
        });
        return;
      }
      throw err;
    }

    logger.info("[MatchLifecycle] submitting snapshot", {
      fixtureId: f.fixtureId.toString(),
      kind: wantEnd ? "endPrice" : "startPrice",
      home: this.feed.describeQuote(home),
      away: this.feed.describeQuote(away),
    });

    if (wantEnd) {
      await this.submitter.submitEndPrice(
        f.fixtureId, home.scaled, away.scaled, home.source, away.source
      );
    } else {
      await this.submitter.submitStartPrice(
        f.fixtureId, home.scaled, away.scaled, home.source, away.source
      );
    }
  }
}

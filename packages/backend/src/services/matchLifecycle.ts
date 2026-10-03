/**
 * Match lifecycle — kickoff monitor (spec P2.5) + match timer (spec P2.6).
 *
 * One 30-second loop drives the whole on-chain match flow:
 *
 *   1. REVEAL — for every fixture whose matchday window has opened but whose
 *      kickoff is still secret: each matchday's fixtures are spread evenly
 *      across the usable part of the window (deterministic slots on a
 *      15-minute grid), so every day has matches instead of the whole
 *      matchday playing in the first hour. The contract only accepts a
 *      reveal 30–120 min before kickoff, so a fixture is revealed
 *      progressively as its slot enters the 120-min lead window. If a slot
 *      was missed (backend downtime), the fixture is revealed late with
 *      kickoff = now + leadMinutes; a fixture that can't be revealed
 *      legally at all is flagged for manual review — never send a doomed
 *      transaction.
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
 *
 * Optimization pass changes:
 * - Fixture refresh uses ONE multicall per 50 fixtures instead of one
 *   eth_call per fixture (was ~380 calls/30s ≈ 1.1M calls/day early season
 *   against the public RPC).
 * - Per-tick refresh covers only fixtures NEAR a state transition (within
 *   15 min of window open / kickoff / match end); a full refresh runs every
 *   10th tick. Quiescent fixtures can't change state — re-reading them was
 *   pure RPC burn.
 * - Reads go through the shared resilient client (lib/rpc.ts).
 * - The tick runs on lib/loop.ts (non-overlapping, backoff on failure).
 */

import type { PublicClient } from "viem";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { publicClient as sharedPublicClient, withRpcRetry } from "../lib/rpc.js";
import { runLoop, type LoopHandle } from "../lib/loop.js";
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
          { name: "matchEndTimestamp", type: "uint64" }, // v0.2: pinned at reveal = kickoff + matchDuration
          { name: "voided", type: "bool" }, // escape hatch: fixture voided by owner, stakes refundable via claimVoid
        ],
      },
    ],
  },
] as const;

// Season 1 was deployed before matchEndTimestamp was added to Fixture. Keep
// the old decoder available because a backend must be able to read the
// configured registry while that season is still live.
const LEGACY_REGISTRY_READ_ABI = [
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
  matchEndMs: number; // v0.2: 0 until revealed, then kickoff + matchDuration
  settled: boolean;
  voided: boolean; // escape hatch: fixture voided by owner, stakes refundable via claimVoid
}

/**
 * A fixture only needs re-reading when it's near a state transition —
 * window opening (reveal), kickoff, or match end (settle). Everything else
 * is immutable on-chain between ticks.
 */
const HOT_WINDOW_MS = 15 * 60_000;
/** Full cache refresh every Nth tick (10 × 30s = 5 min). */
const FULL_REFRESH_EVERY_TICKS = 10;
/** Fixtures per multicall chunk — kind to public RPC payload limits. */
const READ_CHUNK = 50;

/** In-memory fixture cache. Revealed+settled fixtures are immutable → cached forever. */
class FixtureCache {
  private fixtures = new Map<bigint, FixtureView>();

  constructor(private readonly publicClient: PublicClient) {}

  async loadAll(): Promise<void> {
    const count = (await withRpcRetry("lifecycle:fixtureCount", () =>
      this.publicClient.readContract({
        address: config.contracts.matchRegistrySeason1,
        abi: REGISTRY_READ_ABI,
        functionName: "fixtureCount",
      })
    )) as bigint;
    logger.info("[FixtureCache] loading fixtures", { count: count.toString() });

    const ids: bigint[] = [];
    for (let i = 0n; i < count; i++) ids.push(i);
    for (const f of await this.readFixtures(ids)) this.fixtures.set(f.fixtureId, f);
    logger.info("[FixtureCache] loaded", { fixtures: this.fixtures.size });
  }

  /** Re-read every fixture that can still change (unrevealed or unsettled). */
  async refresh(): Promise<void> {
    const mutable = [...this.fixtures.values()].filter((f) => !f.settled);
    if (mutable.length === 0) return;
    for (const f of await this.readFixtures(mutable.map((x) => x.fixtureId))) {
      this.fixtures.set(f.fixtureId, f);
    }
  }

  /**
   * Re-read only fixtures near a state transition. This is the per-tick
   * path — it turns ~380 eth_calls/30s into ~1 multicall (often zero, when
   * nothing is live).
   */
  async refreshHot(): Promise<void> {
    const now = Date.now();
    const hot = [...this.fixtures.values()].filter(
      (f) =>
        !f.settled &&
        (f.kickoffRevealed
          ? now >= f.kickoffMs - HOT_WINDOW_MS // live, or about to start/end
          : f.windowStartMs <= now + HOT_WINDOW_MS && now < f.windowEndMs) // reveal window open/imminent
    );
    if (hot.length === 0) return;
    for (const f of await this.readFixtures(hot.map((x) => x.fixtureId))) {
      this.fixtures.set(f.fixtureId, f);
    }
  }

  /**
   * Batch-read fixtures via multicall (one RPC call per 50 fixtures).
   * Items that fail to decode against the modern ABI fall back to an
   * individual legacy-ABI read (pre-v0.2 8-field registries).
   */
  private async readFixtures(ids: bigint[]): Promise<FixtureView[]> {
    const out: FixtureView[] = [];
    for (let i = 0; i < ids.length; i += READ_CHUNK) {
      const chunk = ids.slice(i, i + READ_CHUNK);
      const results = (await withRpcRetry("lifecycle:readFixtures", () =>
        this.publicClient.multicall({
          contracts: chunk.map((id) => ({
            address: config.contracts.matchRegistrySeason1,
            abi: REGISTRY_READ_ABI,
            functionName: "getFixture" as const,
            args: [id] as const,
          })),
          allowFailure: true,
        })
      )) as Array<{ status: "success"; result: unknown } | { status: "failure"; error: unknown }>;
      for (let k = 0; k < chunk.length; k++) {
        const r = results[k];
        if (r.status === "success") {
          out.push(this.toFixtureView(chunk[k], r.result));
        } else {
          logger.debug("[FixtureCache] modern read failed, trying legacy ABI", {
            fixtureId: chunk[k].toString(),
          });
          out.push(await this.readFixtureLegacy(chunk[k]));
        }
      }
    }
    return out;
  }

  private async readFixtureLegacy(fixtureId: bigint): Promise<FixtureView> {
    const f = (await withRpcRetry("lifecycle:readFixtureLegacy", () =>
      this.publicClient.readContract({
        address: config.contracts.matchRegistrySeason1,
        abi: LEGACY_REGISTRY_READ_ABI,
        functionName: "getFixture",
        args: [fixtureId],
      })
    )) as {
      homeTeamId: number;
      awayTeamId: number;
      matchdayIndex: number;
      windowStart: bigint;
      windowEnd: bigint;
      kickoffTimestamp: bigint;
      kickoffRevealed: boolean;
      settled: boolean;
    };
    return this.toFixtureView(fixtureId, f);
  }

  private toFixtureView(
    fixtureId: bigint,
    f: {
      homeTeamId: number;
      awayTeamId: number;
      matchdayIndex: number;
      windowStart: bigint;
      windowEnd: bigint;
      kickoffTimestamp: bigint;
      kickoffRevealed: boolean;
      settled: boolean;
      matchEndTimestamp?: bigint;
      voided?: boolean;
    }
  ): FixtureView {
    const matchEndTimestamp =
      f.matchEndTimestamp ??
      (f.kickoffTimestamp > 0n
        ? f.kickoffTimestamp + BigInt(config.leagues.main.matchDurationMinutes * 60)
        : 0n);
    return {
      fixtureId,
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
      matchdayIndex: f.matchdayIndex,
      windowStartMs: Number(f.windowStart) * 1000,
      windowEndMs: Number(f.windowEnd) * 1000,
      kickoffMs: Number(f.kickoffTimestamp) * 1000,
      kickoffRevealed: f.kickoffRevealed,
      matchEndMs: Number(matchEndTimestamp) * 1000,
      settled: f.settled,
      voided: f.voided ?? false,
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

/** Contract bounds: revealKickoff requires kickoff within [now+30min, now+120min]. */
const REVEAL_LEAD_MIN_MS = 30 * 60_000;
const REVEAL_LEAD_MAX_MS = 120 * 60_000;
/** Breathing room after windowStart before the first kickoff slot. */
const SLOT_START_PAD_MS = 30 * 60_000;
/** Settlement slack reserved before windowEnd after the last match ends. */
const SLOT_END_PAD_MS = 60 * 60_000;
/** Kickoff slots snap to this grid for human-friendly times. */
const SLOT_GRID_MS = 15 * 60_000;

export class MatchLifecycle {
  private readonly cache: FixtureCache;
  private readonly durationMs: number;
  /** Late-reveal fallback lead (clamped into the contract's 30–120 min bounds). */
  private readonly leadMs: number;
  private readonly failures = new Map<bigint, FailureState>();
  /** Fixtures already flagged for an unschedulable window (log-once guard). */
  private readonly slotWarned = new Set<string>();
  private loop: LoopHandle | null = null;
  private tickCount = 0;

  constructor(
    private readonly feed: PriceFeed,
    private readonly submitter: SnapshotSubmitter,
    publicClient?: PublicClient
  ) {
    this.cache = new FixtureCache(publicClient ?? sharedPublicClient);
    this.durationMs = config.leagues.main.matchDurationMinutes * 60 * 1000;
    // Fallback lead used only when a scheduled slot was missed (backend
    // downtime) — clamped inside the contract's 30–120 min reveal bounds.
    // On-schedule reveals always use the slot time itself.
    this.leadMs = Math.min(Math.max(config.kickoff.leadMinutes, 35), 115) * 60 * 1000;
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
    this.loop = runLoop("match-lifecycle", config.kickoff.tickIntervalMs, () => this.tick());
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }

  /** Read-only fixture list for the REST API. */
  getFixtures(): FixtureView[] {
    return this.cache.all();
  }

  /**
   * Deterministic scheduled kickoff slots for all unsettled fixtures
   * (fixtureId → slot ms). Published via the API so users see start times
   * well before the on-chain reveal — the contract only accepts reveals
   * 30–120 min before kickoff, but each slot is fixed for the season.
   */
  getScheduledKickoffs(): Map<bigint, number> {
    const out = new Map<bigint, number>();
    for (const f of this.cache.all()) {
      if (f.settled) continue;
      const slot = this.kickoffSlotMs(f);
      if (slot !== null) out.set(f.fixtureId, slot);
    }
    return out;
  }

  /**
   * True when any fixture needs price attention soon: a scheduled reveal
   * entering its 120-min lead window, or within ~10 min of kickoff /
   * settlement. Drives the price heartbeat's hot cadence — the backend only
   * needs fresh prices when it might actually submit.
   */
  isHotWindow(): boolean {
    const now = Date.now();
    const MARGIN_MS = 10 * 60_000;
    return this.cache.all().some((f) => {
      if (f.settled) return false;
      if (!f.kickoffRevealed) {
        if (f.windowStartMs > now || now >= f.windowEndMs) return false;
        const slot = this.kickoffSlotMs(f);
        // Unschedulable window — stay hot; it needs operator attention.
        if (slot === null) return true;
        return now >= slot - REVEAL_LEAD_MAX_MS - MARGIN_MS;
      }
      return now >= f.kickoffMs - MARGIN_MS;
    });
  }

  private async tick(): Promise<void> {
    this.tickCount++;
    // Cheap per-tick path: only fixtures near a transition. Full refresh
    // every Nth tick catches anything the hot filter missed (clock skew,
    // reorgs, manual on-chain changes).
    if (this.tickCount % FULL_REFRESH_EVERY_TICKS === 0) {
      await this.cache.refresh();
    } else {
      await this.cache.refreshHot();
    }
    await this.revealDueKickoffs();
    await this.processLiveMatches();
  }

  // ------------------------------------------------------------- P2.5 reveal (window-spread)

  /**
   * Deterministic kickoff slot for a fixture. A matchday's fixtures are
   * spread evenly across the usable part of the matchday window — from
   * 30 min after windowStart until (matchDuration + 60 min) before
   * windowEnd — snapped to 15-minute boundaries, so every day of the
   * window has matches instead of the whole matchday playing in the first
   * hour. Derived purely from on-chain fixture data (fixtureId order
   * within the matchday + window bounds), so a backend restart re-derives
   * identical slots. Returns null when the window is too short to fit the
   * schedule (defensive — never happens with 2-day windows).
   */
  private kickoffSlotMs(f: FixtureView): number | null {
    const usableStart = f.windowStartMs + SLOT_START_PAD_MS;
    const usableEnd = f.windowEndMs - this.durationMs - SLOT_END_PAD_MS;
    if (usableEnd <= usableStart) return null;
    // All fixtures of the matchday, settled or not — matchday membership
    // never changes, so slots are stable for the whole season.
    const siblings = this.cache
      .all()
      .filter((g) => g.matchdayIndex === f.matchdayIndex)
      .sort((a, b) => (a.fixtureId < b.fixtureId ? -1 : 1));
    const idx = siblings.findIndex((g) => g.fixtureId === f.fixtureId);
    if (idx < 0) return null;
    const raw = usableStart + ((idx + 0.5) * (usableEnd - usableStart)) / siblings.length;
    const snapped = Math.round(raw / SLOT_GRID_MS) * SLOT_GRID_MS;
    return Math.min(Math.max(snapped, usableStart), usableEnd);
  }

  /**
   * Window-spread progressive reveal. The contract only accepts
   * revealKickoff when kickoff lands within [now+30min, now+120min], so a
   * fixture can't be revealed a day early — instead each fixture is
   * revealed on the tick where its scheduled slot first enters the
   * 120-minute lead window, with kickoff = the slot time itself.
   *
   * If a slot was missed (backend downtime), the fixture is revealed late
   * with kickoff = now + leadMinutes (clamped into the legal bounds) so it
   * still plays rather than dying silently. A fixture that can't be
   * revealed legally at all is flagged for manual review — never send a
   * doomed transaction.
   */
  private async revealDueKickoffs(): Promise<void> {
    const now = Date.now();
    const due = this.cache
      .all()
      .filter(
        (f) => !f.kickoffRevealed && !f.settled && f.windowStartMs <= now && now < f.windowEndMs
      );
    if (due.length === 0) return;

    let revealed = 0;
    let waiting = 0;
    for (const f of due) {
      const slot = this.kickoffSlotMs(f);
      if (slot === null) {
        const key = f.fixtureId.toString();
        if (!this.slotWarned.has(key)) {
          this.slotWarned.add(key);
          logger.error(
            "[MatchLifecycle] window too short for kickoff schedule — manual review required",
            {
              fixtureId: key,
              matchday: f.matchdayIndex,
              windowEnd: new Date(f.windowEndMs).toISOString(),
            }
          );
        }
        continue;
      }
      // Slot hasn't entered the 120-min reveal lead window yet — wait for a later tick.
      if (now < slot - REVEAL_LEAD_MAX_MS) {
        waiting++;
        continue;
      }
      let kickoffMs: number;
      let late = false;
      if (now <= slot - REVEAL_LEAD_MIN_MS) {
        kickoffMs = slot; // on schedule: kickoff lands within [now+30min, now+120min]
      } else {
        // Slot missed (backend was down) — reveal ASAP inside the legal bounds.
        late = true;
        kickoffMs = now + this.leadMs;
        logger.warn("[MatchLifecycle] kickoff slot missed — revealing late", {
          fixtureId: f.fixtureId.toString(),
          matchday: f.matchdayIndex,
          slot: new Date(slot).toISOString(),
          fallbackKickoff: new Date(kickoffMs).toISOString(),
        });
      }
      if (kickoffMs > f.windowEndMs) {
        logger.error("[MatchLifecycle] MISSED reveal window — manual review required", {
          fixtureId: f.fixtureId.toString(),
          matchday: f.matchdayIndex,
          kickoff: new Date(kickoffMs).toISOString(),
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
        revealed++;
        logger.info("[MatchLifecycle] kickoff revealed (window-spread)", {
          fixtureId: f.fixtureId.toString(),
          matchday: f.matchdayIndex,
          kickoff: new Date(kickoffMs).toISOString(),
          late,
        });
      } catch (err) {
        logger.error("[MatchLifecycle] revealKickoff failed", {
          fixtureId: f.fixtureId.toString(),
          error: String(err),
        });
      }
    }
    logger.info("[MatchLifecycle] reveal pass complete", { due: due.length, revealed, waiting });
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

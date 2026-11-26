/**
 * Stock match lifecycle, kickoff monitor + match timer for the stock league.
 *
 * Intended destination: packages/backend/src/services/stockMatchLifecycle.ts.
 * Mirrors the crypto MatchLifecycle (reveal -> start snapshot -> end
 * snapshot, idempotency pre-checks, per-fixture exponential backoff, one
 * fixture failing never blocks the others, TxQueue serializes writes) with
 * stock differences:
 *
 *   1. EVENT-DRIVEN, not a 30s tick loop. The crypto loop ticks every
 *      30s all day; the stock loop sleeps until the next event (next
 *      window opening, next kickoff, next full-time), capped at 15 min
 *      idle / 60s hot so the NAV hot window still turns over. A 30s
 *      tick would burn RPC reads and log noise for 22 rounds with
 *      nothing happening between them. Sleep is via a single setTimeout
 *      that is re-armed after every pass; stop() clears it.
 *   2. SLOT-TIME STAGGER, restart-safe (same pattern as crypto
 *      MatchLifecycle.kickoffSlotMs, NOT the 22-team build's
 *      now-plus-lead-plus-slot arithmetic, which could never satisfy the
 *      on-chain 30-120 min reveal lead for slots past the first two).
 *      A matchday (round) lasts 1 day and its 6 fixtures kick off at
 *      absolute slot times spread across the fixture window: each
 *      round's fixtures are spread evenly across the usable window
 *      (windowStart + 30 min pad to windowEnd - duration - 60 min pad)
 *      and snapped to a 15-min grid. The slot is derived from the
 *      fixture's position among its round's fixtures, so a restart
 *      re-derives the exact same kickoff times instead of
 *      double-scheduling. Reveal happens when the slot enters the legal
 *      reveal window (slot minus 120 min); a slot missed by a late
 *      backend falls back to now + lead, logged as late.
 *      WEEKDAY SESSION RULE (2026-11-26): on Monday to Friday
 *      matchdays the usable window is NOT the whole day. The NAV
 *      barely moves while the US market is shut, so dead-zone matches
 *      finish 0-0 (the Matchday 1 opener kicked off 02:15 UTC and
 *      ended 0-0). Weekday slots are confined to the session bounds
 *      in stockConfig.kickoff (slot starts 14:15 to 20:15 UTC, hourly
 *      kickoffs 14:45 to 19:45 UTC). Weekend matchdays keep the
 *      full-window spread above: the market is shut all day, so
 *      staggering cannot fix them this season.
 *   3. DOUBLE-HEADER FINALE (Dec 16, rounds 21 and 22, matchdayIndex 20
 *      and 21). Nov 26 to Dec 16 inclusive is 21 days for 22 rounds, so
 *      the finale hosts two rounds in two waves. Rounds 21 and 22 share
 *      one on-chain Dec 16 window. Dec 16 is a Wednesday, so the waves
 *      split the weekday session band instead of the day: round 21
 *      takes the first half (kickoffs 14:30 to 17:00 UTC) and round 22
 *      the second half (17:30 to 20:00 UTC). The reveal-time overlap
 *      guard shifts any colliding kickoff forward in 15-min steps and
 *      flags manual review when no free slot remains.
 *   4. HOT-ONLY REFRESH. The fixture cache re-reads only fixtures that
 *      can still change (unrevealed or unsettled), in multicall chunks
 *      of 50, and only on passes that do work. Revealed+settled fixtures
 *      are immutable and cached forever. Idle passes do not re-read the
 *      chain at all.
 *   5. FORFEIT, decided at FULL-TIME, with the last-NAV fallback first.
 *      At kickoff the lifecycle submits the start snapshot from the
 *      latest NAV (25h pricing bound). If NAV is stale at kickoff, the
 *      snapshot is BLOCKED (like crypto) and the fixture waits; nothing
 *      is fabricated. At FT the lifecycle resolves the end price per
 *      team via StockPriceFeed.resolveEndPrice, which tries, in order:
 *      a NAV published inside the match window [kickoff, FT + grace],
 *      then the LAST-NAV FALLBACK (user approved 2026-11-18: last NAV
 *      within the 24h heartbeat, feed healthy, published before
 *      kickoff, every use logged). Only a team that fails both is a
 *      forfeit candidate:
 *        - one team with no performance and no fallback -> submitter.
 *          recordForfeit, opponent wins 3-0, marked FORFEIT. Never a
 *          silent normal 3-0.
 *        - both teams with no performance and no fallback -> submitter.
 *          voidFixture, stakes refunded 1:1.
 *        - both resolved (performed or fallback) -> normal end snapshot
 *          (with late-start recovery if the start was missed while the
 *          backend was down).
 *      A forfeit/void failure is logged at ERROR and the fixture is
 *      retried with backoff; it is never settled as a normal result.
 *
 * FIX (2026-11-17, carried into this revision): the getFixture ABI
 * includes voided, so matchEndTimestamp is decoded from the right word
 * (before the fix it decoded the voided word, corrupting live/awaiting
 * status), and voided is carried into the cache view.
 *
 * NAV hot window: the lifecycle owns it. Hot from 30 min before the
 * first kickoff of the day until the last full-time + 15 min, idle
 * otherwise (StockNavPoller.setHot). The NAV poller must be hot while
 * any match is live, or the FT freshness check reads a cold map.
 *
 * Circuit breaker: a raw +/-30% NAV spike is quarantined by the poller
 * (last good tick kept). If the feed reports a suspect tick for either
 * team at FT, the fixture is flagged for manual review and NOT settled
 * on the spike.
 */

import { stockConfig } from "../stockConfig.js";
import { logger } from "../lib/logger.js";
import type { StockPriceFeed, StockPriceSource } from "./stockPriceFeed.js";
import {
  StockPriceUnavailableError,
  StockPriceValidationError,
} from "./stockPriceFeed.js";
import type { StockValidatedPrice } from "./stockPriceFeed.js";
import { StockSnapshotSubmitter, createStockPublicClient } from "./stockSnapshotSubmitter.js";
import type { StockNavPoller } from "./stockNavPoller.js";
import type { PublicClient } from "viem";

const STOCK_REGISTRY_READ_ABI = [
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
          { name: "voided", type: "bool" },
          { name: "matchEndTimestamp", type: "uint64" },
        ],
      },
    ],
  },
] as const;

export interface StockFixtureView {
  fixtureId: bigint;
  homeTeamId: number;
  awayTeamId: number;
  matchdayIndex: number;
  windowStartMs: number;
  windowEndMs: number;
  kickoffMs: number; // 0 until revealed
  kickoffRevealed: boolean;
  matchEndMs: number; // 0 until revealed, then kickoff + matchDuration
  settled: boolean;
  /** Set once the lifecycle records a forfeit/void (in-memory; chain is truth). */
  forfeitTeamId?: number;
  voided?: boolean;
}

/** In-memory fixture cache. Revealed+settled fixtures are immutable, cached forever. */
class StockFixtureCache {
  private fixtures = new Map<bigint, StockFixtureView>();

  constructor(private readonly publicClient: PublicClient) {}

  async loadAll(): Promise<void> {
    const count = (await this.publicClient.readContract({
      address: stockConfig.contracts.matchRegistry,
      abi: STOCK_REGISTRY_READ_ABI,
      functionName: "fixtureCount",
    })) as bigint;
    logger.info("[StockFixtureCache] loading fixtures", { count: count.toString() });

    // Multicall in chunks of 50: one RPC request per chunk, kind to
    // public RPC rate limits and to the 1 GB/month budget.
    const CHUNK = 50;
    for (let start = 0n; start < count; start += BigInt(CHUNK)) {
      const end = start + BigInt(CHUNK) > count ? count : start + BigInt(CHUNK);
      const ids: bigint[] = [];
      for (let i = start; i < end; i++) ids.push(i);
      const results = (await this.publicClient.multicall({
        contracts: ids.map((id) => ({
          address: stockConfig.contracts.matchRegistry,
          abi: STOCK_REGISTRY_READ_ABI,
          functionName: "getFixture",
          args: [id],
        })),
        allowFailure: false,
      }) as unknown) as Array<{
        homeTeamId: number;
        awayTeamId: number;
        matchdayIndex: number;
        windowStart: bigint;
        windowEnd: bigint;
        kickoffTimestamp: bigint;
        kickoffRevealed: boolean;
        settled: boolean;
        voided: boolean;
        matchEndTimestamp: bigint;
      }>;
      results.forEach((f, idx) => {
        this.fixtures.set(ids[idx], this.toView(ids[idx], f));
      });
    }
    logger.info("[StockFixtureCache] loaded", { fixtures: this.fixtures.size });
  }

  /** Re-read every fixture that can still change (unrevealed or unsettled). */
  async refresh(): Promise<void> {
    const mutable = [...this.fixtures.values()].filter((f) => !f.settled);
    if (mutable.length === 0) return;
    const CHUNK = 50;
    for (let i = 0; i < mutable.length; i += CHUNK) {
      const chunk = mutable.slice(i, i + CHUNK);
      const results = (await this.publicClient.multicall({
        contracts: chunk.map((f) => ({
          address: stockConfig.contracts.matchRegistry,
          abi: STOCK_REGISTRY_READ_ABI,
          functionName: "getFixture",
          args: [f.fixtureId],
        })),
        allowFailure: false,
      }) as unknown) as Array<{
        homeTeamId: number;
        awayTeamId: number;
        matchdayIndex: number;
        windowStart: bigint;
        windowEnd: bigint;
        kickoffTimestamp: bigint;
        kickoffRevealed: boolean;
        settled: boolean;
        voided: boolean;
        matchEndTimestamp: bigint;
      }>;
      results.forEach((f, idx) => {
        const prev = this.fixtures.get(chunk[idx].fixtureId);
        const view = this.toView(chunk[idx].fixtureId, f);
        // Keep in-memory forfeit/void flags across refreshes.
        if (prev?.forfeitTeamId !== undefined) view.forfeitTeamId = prev.forfeitTeamId;
        if (prev?.voided) view.voided = true;
        this.fixtures.set(chunk[idx].fixtureId, view);
      });
    }
  }

  private toView(
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
      voided: boolean;
      matchEndTimestamp: bigint;
    }
  ): StockFixtureView {
    const matchEndTimestamp =
      f.matchEndTimestamp > 0n
        ? f.matchEndTimestamp
        : f.kickoffTimestamp > 0n
          ? f.kickoffTimestamp + BigInt(stockConfig.matchDurationMinutes * 60)
          : 0n;
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
      voided: f.voided,
    };
  }

  all(): StockFixtureView[] {
    return [...this.fixtures.values()].sort((a, b) =>
      a.fixtureId < b.fixtureId ? -1 : 1
    );
  }

  get size(): number {
    return this.fixtures.size;
  }
}

/**
 * Absolute kickoff slot for a fixture: a time inside its window, spread
 * evenly across the round's usable window and snapped to the 15-min
 * grid (same pattern as crypto MatchLifecycle.kickoffSlotMs). The slot
 * depends only on the fixture's position among its round's fixtures, so
 * it is identical after a restart and never double-schedules. Returns
 * null when the window is too short for any legal slot: the caller flags
 * manual review instead of revealing a doomed kickoff.
 *
 * `siblings` is every fixture of the same matchdayIndex (round),
 * including this one. On weekday matchdays the usable window is the
 * US session band from stockConfig (see the header, point 2); on
 * weekends it is the padded full window. The two Dec 16 rounds share
 * a 24-hour on-chain window, so on that weekday round 21 takes the
 * first half of the session band and round 22 the second half. Their
 * six fixtures are spread independently within each wave.
 */
export function stockKickoffSlotMs(
  fixture: { fixtureId: bigint; matchdayIndex: number; windowStartMs: number; windowEndMs: number },
  siblings: Array<{ fixtureId: bigint; matchdayIndex: number; windowStartMs: number; windowEndMs: number }>,
  durationMs: number = stockConfig.matchDurationMinutes * 60 * 1000
): number | null {
  const gridMs = stockConfig.kickoff.slotGridMinutes * 60 * 1000;
  let usableStart = fixture.windowStartMs + stockConfig.kickoff.slotStartPadMinutes * 60 * 1000;
  let usableEnd = fixture.windowEndMs - durationMs - stockConfig.kickoff.slotEndPadMinutes * 60 * 1000;
  // Weekday session rule (2026-11-26): Monday to Friday matchdays play
  // inside the US session, never in the 01:00 to 13:00 UTC dead zone.
  // Matchday windows start at 00:00 UTC, so the weekday and the session
  // bounds both read straight off windowStartMs. Weekends keep the
  // full-window spread computed above, finale noon split included.
  const utcDay = new Date(fixture.windowStartMs).getUTCDay();
  const isWeekday = utcDay >= 1 && utcDay <= 5;
  if (isWeekday) {
    const sessionStart = fixture.windowStartMs + stockConfig.kickoff.weekdaySessionStartMinutes * 60 * 1000;
    const sessionEnd = fixture.windowStartMs + stockConfig.kickoff.weekdaySessionEndMinutes * 60 * 1000;
    const sessionMid = sessionStart + (sessionEnd - sessionStart) / 2;
    if (fixture.matchdayIndex === 20) {
      usableStart = sessionStart;
      usableEnd = sessionMid;
    } else if (fixture.matchdayIndex === 21) {
      usableStart = sessionMid;
      usableEnd = sessionEnd;
    } else {
      usableStart = sessionStart;
      usableEnd = sessionEnd;
    }
  } else if (fixture.matchdayIndex === 20) {
    usableEnd = Math.min(usableEnd, fixture.windowStartMs + 12 * 60 * 60 * 1000 - durationMs);
  } else if (fixture.matchdayIndex === 21) {
    usableStart = Math.max(usableStart, fixture.windowStartMs + 12 * 60 * 60 * 1000);
  }
  if (usableEnd <= usableStart) return null;
  const round = siblings
    .filter((g) => g.matchdayIndex === fixture.matchdayIndex)
    .sort((a, b) => (a.fixtureId < b.fixtureId ? -1 : 1));
  const idx = round.findIndex((g) => g.fixtureId === fixture.fixtureId);
  if (idx < 0) return null;
  const raw = usableStart + ((idx + 0.5) * (usableEnd - usableStart)) / round.length;
  const snapped = Math.round(raw / gridMs) * gridMs;
  return Math.min(Math.max(snapped, usableStart), usableEnd);
}

/** On-chain reveal lead bounds (same as crypto): kickoff must land
 *  30-120 min after the reveal tx. */
const REVEAL_LEAD_MIN_MS = 30 * 60_000;
const REVEAL_LEAD_MAX_MS = 120 * 60_000;
/** Hot window margin around slots and kickoffs (same as crypto). */
const HOT_MARGIN_MS = 10 * 60_000;

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;
/** Longest sleep between passes when nothing is due (idle). */
const IDLE_SLEEP_CAP_MS = 15 * 60_000;
/** Longest sleep between passes while matches are live (hot). */
const HOT_SLEEP_CAP_MS = 60_000;
/** Hot window closes this long after the last full-time of the day. */
const HOT_TAIL_MS = 15 * 60_000;

interface FailureState {
  count: number;
  nextRetryAtMs: number;
}

export class StockMatchLifecycle {
  private readonly cache: StockFixtureCache;
  private readonly durationMs: number;
  private readonly leadMs: number;
  private readonly failures = new Map<bigint, FailureState>();
  /** Fixtures already flagged once for a window too short for any slot. */
  private readonly slotWarned = new Set<string>();
  private readonly startSources = new Map<string, { home: StockPriceSource; away: StockPriceSource }>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private running = false;

  constructor(
    private readonly feed: StockPriceFeed,
    private readonly submitter: StockSnapshotSubmitter,
    private readonly navPoller: StockNavPoller,
    publicClient?: PublicClient
  ) {
    this.cache = new StockFixtureCache(publicClient ?? createStockPublicClient());
    this.durationMs = stockConfig.matchDurationMinutes * 60 * 1000;
    this.leadMs = stockConfig.kickoff.leadMinutes * 60 * 1000;
  }

  async start(): Promise<void> {
    await this.cache.loadAll();
    if (this.cache.size === 0) {
      logger.warn(
        "[StockMatchLifecycle] no fixtures on-chain yet, the schedule has not been generated. " +
          "Lifecycle loop running idle until fixtures exist."
      );
    }
    this.running = true;
    logger.info("[StockMatchLifecycle] starting (event-driven)", {
      matchDurationMin: stockConfig.matchDurationMinutes,
      kickoffLeadMin: stockConfig.kickoff.leadMinutes,
      slotGridMin: stockConfig.kickoff.slotGridMinutes,
      teams: stockConfig.season.teamCount,
      rounds: stockConfig.season.matchdays,
      fixtures: stockConfig.season.totalFixtures,
      doubleHeaderDate: stockConfig.season.doubleHeaderDate,
      doubleHeaderMatchdays: stockConfig.season.doubleHeaderMatchdays,
    });
    this.armTimer(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Read-only fixture list for the REST API. */
  getFixtures(): StockFixtureView[] {
    return this.cache.all();
  }

  /** Deterministic kickoff slot per unsettled fixture, keyed by
   *  fixtureId: the same stockKickoffSlotMs the reveal pass runs on,
   *  published by the API as scheduledKickoff so stock cards count down
   *  to the slot before the on-chain reveal, exactly like crypto
   *  (MatchLifecycle.getScheduledKickoffs). Provisional by nature: the
   *  reveal-time overlap guard can shift a slot forward, and a slot
   *  missed by a late backend falls back to now + lead. */
  getScheduledKickoffs(): Map<bigint, number> {
    const all = this.cache.all();
    const out = new Map<bigint, number>();
    for (const f of all) {
      if (f.settled) continue;
      const slot = stockKickoffSlotMs(f, all);
      if (slot !== null) out.set(f.fixtureId, slot);
    }
    return out;
  }

  /** Read-only fixtures for one round (matchdayIndex). The Dec 16
   *  double-header finale is two calls: index 20 (round 21, morning
   *  wave) and index 21 (round 22, evening wave). */
  getFixturesForMatchday(matchdayIndex: number): StockFixtureView[] {
    return this.cache.all().filter((f) => f.matchdayIndex === matchdayIndex);
  }

  private armTimer(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick().catch((err) =>
        logger.error("[StockMatchLifecycle] tick failed", { error: String(err) })
      );
    }, Math.max(0, delayMs));
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      this.armTimer(HOT_SLEEP_CAP_MS);
      return;
    }
    this.ticking = true;
    try {
      await this.cache.refresh();
      this.updateNavHotWindow(Date.now());
      await this.revealDueKickoffs();
      await this.processLiveMatches();
    } catch (err) {
      logger.error("[StockMatchLifecycle] tick failed", { error: String(err) });
    } finally {
      this.ticking = false;
      if (this.running) this.armTimer(this.msUntilNextEvent());
    }
  }

  /**
   * Sleep until the next thing that can happen: the next window opening
   * (reveal), the next kickoff (start snapshot), or the next full-time
   * (end snapshot / forfeit). Capped so an idle backend still wakes
   * periodically (NAV hot-window turnover) and a hot backend never
   * sleeps past a 60s granularity.
   */
  private msUntilNextEvent(): number {
    const now = Date.now();
    const hot = this.isHotWindow(now);
    const cap = hot ? HOT_SLEEP_CAP_MS : IDLE_SLEEP_CAP_MS;
    let next = Number.POSITIVE_INFINITY;
    const all = this.cache.all();
    for (const f of all) {
      if (f.settled) continue;
      if (!f.kickoffRevealed) {
        // Wake at the legal reveal time: the slot minus the max lead,
        // never before the window opens. A fixture whose slot is already
        // inside the reveal window wakes the loop now.
        const slot = stockKickoffSlotMs(f, all, this.durationMs);
        if (slot === null) {
          if (f.windowEndMs > now) next = Math.min(next, 0);
          continue;
        }
        const revealAt = Math.max(f.windowStartMs, slot - REVEAL_LEAD_MAX_MS);
        if (revealAt > now) next = Math.min(next, revealAt - now);
        else if (f.windowEndMs > now) next = Math.min(next, 0);
      } else {
        if (f.kickoffMs > now) next = Math.min(next, f.kickoffMs - now);
        else if (f.matchEndMs > now) next = Math.min(next, f.matchEndMs - now);
        else next = Math.min(next, 0); // past FT, unsettled: act now
      }
    }
    if (!Number.isFinite(next)) return cap;
    return Math.min(Math.max(0, next), cap);
  }

  /** Hot while any fixture is live, about to kick off, or just finished.
   *  For an unrevealed fixture the slot stands in for the kickoff: hot
   *  from slot minus max reveal lead minus margin, so the NAV poller is
   *  already hot when the reveal lands. */
  private isHotWindow(now: number): boolean {
    const all = this.cache.all();
    for (const f of all) {
      if (f.settled) continue;
      let kickoff: number;
      let end: number;
      if (f.kickoffRevealed) {
        kickoff = f.kickoffMs;
        end = f.matchEndMs > 0 ? f.matchEndMs : f.windowEndMs;
      } else {
        const slot = stockKickoffSlotMs(f, all, this.durationMs);
        if (slot === null) return true; // window too short: stay hot, needs review
        kickoff = slot;
        end = f.windowEndMs;
      }
      if (now >= kickoff - REVEAL_LEAD_MAX_MS - HOT_MARGIN_MS && now <= end + HOT_TAIL_MS) return true;
    }
    return false;
  }

  private updateNavHotWindow(now: number): void {
    this.navPoller.setHot(this.isHotWindow(now));
  }

  // ------------------------------------------------------------- reveal

  private async revealDueKickoffs(): Promise<void> {
    const now = Date.now();
    const all = this.cache.all();
    const due = all.filter(
      (f) => !f.kickoffRevealed && !f.settled && f.windowStartMs <= now && now < f.windowEndMs
    );
    if (due.length === 0) return;

    let revealed = 0;
    let waiting = 0;
    for (const f of due) {
      const failure = this.failures.get(f.fixtureId);
      if (failure && now < failure.nextRetryAtMs) continue;
      const slot = stockKickoffSlotMs(f, all, this.durationMs);
      if (slot === null) {
        const key = f.fixtureId.toString();
        if (!this.slotWarned.has(key)) {
          this.slotWarned.add(key);
          logger.error("[StockMatchLifecycle] window too short for kickoff schedule, manual review required", {
            fixtureId: key,
            matchday: f.matchdayIndex,
            windowEnd: new Date(f.windowEndMs).toISOString(),
          });
        }
        continue;
      }
      // Too early to reveal: the slot is more than the max lead away.
      if (now < slot - REVEAL_LEAD_MAX_MS) {
        waiting++;
        continue;
      }
      let kickoffMs: number;
      let late = false;
      if (now <= slot - REVEAL_LEAD_MIN_MS) {
        kickoffMs = slot;
      } else {
        // Slot missed by a late backend: reveal now + lead instead, logged.
        late = true;
        kickoffMs = now + this.leadMs;
        logger.warn("[StockMatchLifecycle] kickoff slot missed, revealing late", {
          fixtureId: f.fixtureId.toString(),
          matchday: f.matchdayIndex,
          slot: new Date(slot).toISOString(),
          fallbackKickoff: new Date(kickoffMs).toISOString(),
        });
      }
      // Double-header overlap guard: never double-book a kickoff within
      // one match duration of another revealed fixture (the Dec 16
      // finale, if its two rounds ever shared one window). Shift forward
      // in grid steps; manual review when no free slot fits the window.
      const guarded = this.resolveKickoffOverlap(kickoffMs, f.fixtureId);
      if (guarded === null) {
        logger.error("[StockMatchLifecycle] no free kickoff slot, manual review required", {
          fixtureId: f.fixtureId.toString(),
          matchday: f.matchdayIndex,
          kickoff: new Date(kickoffMs).toISOString(),
          windowEnd: new Date(f.windowEndMs).toISOString(),
        });
        continue;
      }
      kickoffMs = guarded;
      if (kickoffMs > f.windowEndMs) {
        logger.error("[StockMatchLifecycle] MISSED reveal window, manual review required", {
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
        f.kickoffRevealed = true;
        f.kickoffMs = kickoffMs;
        f.matchEndMs = kickoffMs + this.durationMs;
        this.failures.delete(f.fixtureId);
        revealed++;
        logger.info("[StockMatchLifecycle] kickoff revealed (window-spread slot)", {
          fixtureId: f.fixtureId.toString(),
          matchday: f.matchdayIndex,
          round: f.matchdayIndex + 1,
          kickoff: new Date(kickoffMs).toISOString(),
          late,
        });
      } catch (err) {
        const count = (failure?.count ?? 0) + 1;
        const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS);
        this.failures.set(f.fixtureId, { count, nextRetryAtMs: now + backoffMs });
        logger.error("[StockMatchLifecycle] revealKickoff failed", {
          fixtureId: f.fixtureId.toString(),
          error: String(err),
        });
      }
    }
    logger.info("[StockMatchLifecycle] reveal pass complete", { due: due.length, revealed, waiting });
  }

  /**
   * Double-header overlap guard: shift a proposed kickoff forward in
   * slot-grid steps until it is at least one match duration away from
   * every other revealed, unsettled fixture, or return null when no free
   * slot fits inside the fixture's window. Two fixtures of the same
   * round never collide (their slots are spread), so a shift only ever
   * fires when two rounds share one window, which is the Dec 16 finale
   * misconfiguration the schedule must avoid.
   */
  private resolveKickoffOverlap(kickoffMs: number, fixtureId: bigint): number | null {
    const gridMs = stockConfig.kickoff.slotGridMinutes * 60 * 1000;
    const fixture = this.cache.all().find((f) => f.fixtureId === fixtureId);
    const windowEndMs = fixture?.windowEndMs ?? Number.POSITIVE_INFINITY;
    let candidate = kickoffMs;
    for (let attempt = 0; attempt < 8; attempt++) {
      const clash = this.cache.all().some(
        (g) =>
          g.fixtureId !== fixtureId &&
          g.kickoffRevealed &&
          !g.settled &&
          Math.abs(g.kickoffMs - candidate) < this.durationMs
      );
      if (!clash) return candidate;
      candidate += gridMs;
      if (candidate + this.durationMs > windowEndMs) return null;
    }
    return null;
  }

  // ------------------------------------------------------------- match timer

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
        if (failure) this.failures.delete(f.fixtureId);
      } catch (err) {
        const count = (failure?.count ?? 0) + 1;
        const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS);
        this.failures.set(f.fixtureId, { count, nextRetryAtMs: now + backoffMs });
        logger.error("[StockMatchLifecycle] fixture processing failed", {
          fixtureId: f.fixtureId.toString(),
          attempt: count,
          nextRetryInMin: Math.round(backoffMs / 60_000),
          error: String(err),
        });
      }
    }
  }

  private async processFixture(f: StockFixtureView, now: number): Promise<void> {
    const matchEndMs = f.matchEndMs > 0 ? f.matchEndMs : f.kickoffMs + this.durationMs;
    const wantEnd = now >= matchEndMs;

    if (wantEnd) {
      await this.processFullTime(f, matchEndMs);
      return;
    }

    // Kickoff: submit the start snapshot from the latest NAV. A stale or
    // missing NAV BLOCKS the snapshot (like crypto); the fixture waits
    // and retries. Nothing is fabricated, and no forfeit is decided yet:
    // the match period has not happened.
    const sourceKey = f.fixtureId.toString();
    let home: StockValidatedPrice | undefined;
    let away: StockValidatedPrice | undefined;
    try {
      home = this.feed.getValidatedPrice(f.homeTeamId);
      away = this.feed.getValidatedPrice(f.awayTeamId);
    } catch (err) {
      if (err instanceof StockPriceValidationError || err instanceof StockPriceUnavailableError) {
        logger.warn("[StockMatchLifecycle] start snapshot blocked by price validation", {
          fixtureId: f.fixtureId.toString(),
          error: err.message,
        });
        return;
      }
      throw err;
    }

    logger.info("[StockMatchLifecycle] submitting start snapshot", {
      fixtureId: f.fixtureId.toString(),
      home: this.feed.describeQuote(home),
      away: this.feed.describeQuote(away),
    });
    const audit = await this.submitter.submitStartPrice(
      f.fixtureId, home.scaled, away.scaled, home.source, away.source
    );
    if (!audit.skipped) {
      this.startSources.set(sourceKey, { home: home.source, away: away.source });
    }
  }

  /**
   * Full-time: the end price is resolved per team FIRST, before any end
   * snapshot, via StockPriceFeed.resolveEndPrice: a NAV published inside
   * [kickoff, FT + grace] wins, else the last-NAV fallback (last NAV
   * within 24h, feed healthy, published before kickoff), else the team
   * has no performance and no fallback. One team missing -> 0-3 forfeit
   * to the opponent. Both missing -> void, stakes refunded 1:1. Only when
   * both teams resolved does the normal end snapshot run.
   */
  private async processFullTime(f: StockFixtureView, matchEndMs: number): Promise<void> {
    const sourceKey = f.fixtureId.toString();
    const stored = this.startSources.get(sourceKey);

    // Resolve each side independently: a performed team settles normally
    // even when its opponent forfeits, and a fallback team settles on its
    // last NAV (end price equals start price for that team).
    let home;
    let away;
    let homeResolved = false;
    let awayResolved = false;
    try {
      home = this.feed.resolveEndPrice(f.homeTeamId, f.kickoffMs, matchEndMs, f.fixtureId, stored?.home);
      homeResolved = true;
    } catch (err) {
      if (err instanceof StockPriceValidationError) {
        logger.warn("[StockMatchLifecycle] end snapshot blocked by price validation", {
          fixtureId: f.fixtureId.toString(),
          error: err.message,
        });
        return;
      }
      if (!(err instanceof StockPriceUnavailableError)) throw err;
      logger.warn("[StockMatchLifecycle] home team has no performance and no last-NAV fallback", {
        fixtureId: f.fixtureId.toString(),
        homeTeamId: f.homeTeamId,
        error: err.message,
      });
    }
    try {
      away = this.feed.resolveEndPrice(f.awayTeamId, f.kickoffMs, matchEndMs, f.fixtureId, stored?.away);
      awayResolved = true;
    } catch (err) {
      if (err instanceof StockPriceValidationError) {
        logger.warn("[StockMatchLifecycle] end snapshot blocked by price validation", {
          fixtureId: f.fixtureId.toString(),
          error: err.message,
        });
        return;
      }
      if (!(err instanceof StockPriceUnavailableError)) throw err;
      logger.warn("[StockMatchLifecycle] away team has no performance and no last-NAV fallback", {
        fixtureId: f.fixtureId.toString(),
        awayTeamId: f.awayTeamId,
        error: err.message,
      });
    }

    if (!homeResolved || !awayResolved) {
      if (!homeResolved && !awayResolved) {
        logger.error("[StockMatchLifecycle] VOID, neither team performed in the match window and neither qualifies for the last-NAV fallback", {
          fixtureId: f.fixtureId.toString(),
          homeTeamId: f.homeTeamId,
          awayTeamId: f.awayTeamId,
          kickoff: new Date(f.kickoffMs).toISOString(),
          matchEnd: new Date(matchEndMs).toISOString(),
        });
        await this.submitter.voidFixture(f.fixtureId);
        f.voided = true;
        this.startSources.delete(sourceKey);
        return;
      }
      const forfeitingTeamId = !homeResolved ? f.homeTeamId : f.awayTeamId;
      logger.error("[StockMatchLifecycle] FORFEIT, team had no NAV performance in the match window and no last-NAV fallback, opponent wins 3-0", {
        fixtureId: f.fixtureId.toString(),
        forfeitingTeamId,
        homeResolved,
        awayResolved,
        kickoff: new Date(f.kickoffMs).toISOString(),
        matchEnd: new Date(matchEndMs).toISOString(),
      });
      await this.submitter.recordForfeit(f.fixtureId, forfeitingTeamId);
      f.forfeitTeamId = forfeitingTeamId;
      this.startSources.delete(sourceKey);
      return;
    }
    // Resolve flags are set only after assigning the corresponding quote.
    // Keep an explicit invariant check so TypeScript narrows both values.
    if (!home || !away) throw new Error("resolved stock quote missing after successful price resolution");

    // Both resolved: a suspect (quarantined +/-30% spike) NAV for either
    // team blocks settlement for manual review. Never settle on a spike.
    const homeSuspect = this.navPoller.getSuspect(f.homeTeamId);
    const awaySuspect = this.navPoller.getSuspect(f.awayTeamId);
    if (homeSuspect || awaySuspect) {
      logger.error("[StockMatchLifecycle] CIRCUIT BREAKER REVIEW, suspect NAV quarantined, settlement blocked", {
        fixtureId: f.fixtureId.toString(),
        homeSuspect: homeSuspect?.navPrice ?? null,
        awaySuspect: awaySuspect?.navPrice ?? null,
      });
      return;
    }

    logger.info("[StockMatchLifecycle] submitting end snapshot", {
      fixtureId: f.fixtureId.toString(),
      home: this.feed.describeQuote(home),
      away: this.feed.describeQuote(away),
    });
    await this.submitter.submitEndPrice(
      f.fixtureId, home.scaled, away.scaled, home.source, away.source,
      { lastNavFallback: { home: home.lastNavFallback, away: away.lastNavFallback } }
    );
    this.startSources.delete(sourceKey);
  }
}

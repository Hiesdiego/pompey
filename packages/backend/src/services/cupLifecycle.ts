/**
 * Cup lifecycle — the CRYPTO PRICE WORLD CUP match loop.
 *
 * Mirrors MatchLifecycle's reliability pattern (30s tick, per-match
 * backoff, idempotent pre-checks, one failing match never blocks others)
 * but drives the cup contracts instead of the league's:
 *
 *   1. DRAW GATE — until registry.drawExecuted() is true, the loop idles
 *      (same "not scheduled yet" posture as the league lifecycle).
 *   2. REVEAL — R64 (matches 0–31): deterministic staggered kickoffs across
 *      Nov 1–6, revealed as soon as the draw is detected. Later rounds:
 *      revealed only when BOTH feeder matches are Settled (the contract
 *      enforces this too). R16 and QF use the match's deterministic
 *      staggered slot in LATER_ROUND_SLOTS (R16 Nov 10–11, QF Nov 12,
 *      all 10:00 UTC + 2h per slot). SF (Nov 13) and the Final (Nov 15)
 *      instead get a RANDOM kickoff inside their round day, 10:00–16:00
 *      UTC at minute granularity, 2h clear of the other semi (user
 *      decision 2026-11-11: 2 per day at random times, not predetermined
 *      slots). The old now + lead rule clamped every early match to its
 *      round window start, which piled 15 of 16 R32 matches onto Nov 7
 *      00:00 UTC; a fixed slot per matchId cannot do that. If a slot
 *      (or random draw) has already passed, the fallback is now + lead,
 *      rounded to the next even UTC hour and stepped +2h clear of other
 *      matches in the same round.
 *   3. START — now >= kickoff and no start snapshot: validate both teams'
 *      prices → CupEngine.submitStartPrice.
 *   4. END — now >= kickoff + 1h: CupEngine.submitEndPrice. Late-start
 *      recovery lives in the submitter.
 *   5. SETTLE — after the end snapshot: CupEngine.settleMatch. A normal
 *      settle advances the winner; a ±30% spike trips the circuit breaker
 *      on-chain (match → Disputed, ballot opens).
 *   6. BALLOTS — any unresolved ballot past its deadline is resolved
 *      (permissionless; the backend guarantees it happens). DAO voting
 *      itself happens off-backend, on-chain.
 *
 * "Road to" display (Winner Match X vs Winner Match Y) is frontend-only:
 * the feeder ids are on-chain; staking stays closed until both teams are
 * known (enforced by CupPool).
 */

import { createPublicClient, http, type PublicClient } from "viem";
import { baseSepolia, base } from "viem/chains";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { PriceFeed, PriceSource } from "./priceFeed.js";
import { PriceUnavailableError, PriceValidationError } from "./priceFeed.js";
import { CupSubmitter } from "./cupSubmitter.js";
import { CUP_TEAM_SYMBOLS } from "./cupTeams.js";

/** On-chain TBD sentinel for "team not known yet". */
const TBD = 65535;
/** Match states: 0=Created, 1=Open, 2=Settled, 3=Disputed. */
const STATE = { Created: 0, Open: 1, Settled: 2, Disputed: 3 } as const;

const CUP_REGISTRY_READ_ABI = [
  {
    type: "function",
    name: "getMatch",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint16" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "teamA", type: "uint16" },
          { name: "teamB", type: "uint16" },
          { name: "feederA", type: "uint16" },
          { name: "feederB", type: "uint16" },
          { name: "winner", type: "uint16" },
          { name: "kickoffTimestamp", type: "uint64" },
          { name: "endTimestamp", type: "uint64" },
          { name: "state", type: "uint8" },
          { name: "goalsA", type: "int16" },
          { name: "goalsB", type: "int16" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "drawExecuted",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "tournamentComplete",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "champion",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
] as const;

export interface CupMatchView {
  matchId: number;
  teamA: number;
  teamB: number;
  feederA: number;
  feederB: number;
  kickoffMs: number; // 0 until revealed
  endMs: number; // 0 until revealed; kickoff + 1h, pinned on-chain at reveal
  state: number;
  winner: number;
  goalsA: number;
  goalsB: number;
}

class CupMatchCache {
  private matches = new Map<number, CupMatchView>();

  constructor(private readonly publicClient: PublicClient) {}

  async loadAll(): Promise<void> {
    const CHUNK = 16;
    for (let start = 0; start < 63; start += CHUNK) {
      const end = Math.min(start + CHUNK, 63);
      const ids: number[] = [];
      for (let i = start; i < end; i++) ids.push(i);
      const results = await Promise.all(ids.map((id) => this.readMatch(id)));
      for (const m of results) this.matches.set(m.matchId, m);
    }
    logger.info("[CupLifecycle] bracket loaded", { matches: this.matches.size });
  }

  /** Re-read every match that can still change (not Settled). */
  async refresh(): Promise<void> {
    const mutable = [...this.matches.values()].filter((m) => m.state !== STATE.Settled);
    if (mutable.length === 0) return;
    const CHUNK = 16;
    for (let i = 0; i < mutable.length; i += CHUNK) {
      const chunk = mutable.slice(i, i + CHUNK);
      const results = await Promise.all(chunk.map((m) => this.readMatch(m.matchId)));
      for (const m of results) this.matches.set(m.matchId, m);
    }
  }

  private async readMatch(matchId: number): Promise<CupMatchView> {
    const m = (await this.publicClient.readContract({
      address: config.cup.registry,
      abi: CUP_REGISTRY_READ_ABI,
      functionName: "getMatch",
      args: [matchId],
    })) as unknown as {
      teamA: number;
      teamB: number;
      feederA: number;
      feederB: number;
      winner: number;
      kickoffTimestamp: bigint;
      endTimestamp: bigint;
      state: number;
      goalsA: number;
      goalsB: number;
    };
    return {
      matchId,
      teamA: m.teamA,
      teamB: m.teamB,
      feederA: m.feederA,
      feederB: m.feederB,
      kickoffMs: Number(m.kickoffTimestamp) * 1000,
      endMs: Number(m.endTimestamp) * 1000,
      state: m.state,
      winner: m.winner,
      goalsA: m.goalsA,
      goalsB: m.goalsB,
    };
  }

  all(): CupMatchView[] {
    return [...this.matches.values()].sort((a, b) => a.matchId - b.matchId);
  }

  get size(): number {
    return this.matches.size;
  }
}

// Round windows as day-offsets from the R64 start date (Nov 1–6, Nov 7–9,
// Nov 10–11, Nov 12, Nov 13, Nov 14 buffer, Nov 15 final).
const ROUND_WINDOWS: { start: number; end: number }[] = [
  { start: 0, end: 5 }, // R64
  { start: 6, end: 8 }, // R32
  { start: 9, end: 10 }, // R16
  { start: 11, end: 11 }, // QF
  { start: 12, end: 12 }, // SF
  { start: 14, end: 14 }, // Final
];

function roundOf(matchId: number): number {
  if (matchId < 32) return 0;
  if (matchId < 48) return 1;
  if (matchId < 56) return 2;
  if (matchId < 60) return 3;
  if (matchId < 62) return 4;
  return 5;
}

// R64 day assignment: 32 matches over 6 days → 6,6,5,5,5,5.
const R64_DAY_OFFSETS: number[] = [
  0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 1,
  2, 2, 2, 2, 2,
  3, 3, 3, 3, 3,
  4, 4, 4, 4, 4,
  5, 5, 5, 5, 5,
];

// First matchId of each round, by roundOf() index: R64, R32, R16, QF, SF, Final.
const ROUND_START: number[] = [0, 32, 48, 56, 60, 62];

// Later-round slots: deterministic kickoff per match, same pattern as R64
// (10:00 UTC + 2h per slot within the day). Day is a day-offset from the
// R64 start date (Nov 1), so day 9 = Nov 10, day 14 = Nov 15.
// R32 has no entry: its 16 matches were already revealed by the old
// now+lead rule, all clamped to Nov 7 00:00 UTC, and revealKickoff only
// works while a match is Created, so those times are locked and cannot
// be restaggered by this file. This table saves R16 onward.
//   R16 (48-55): Nov 10-11, 4 per day at 10, 12, 14, 16 UTC.
//   QF  (56-59): Nov 12, 4 matches at 10, 12, 14, 16 UTC.
//   SF  (60-61): Nov 13, 2 matches at 10, 12 UTC — now FALLBACK ONLY:
//     the random draw (randomRoundKickoff) runs first for SF/Final per
//     the user's 2026-11-11 decision; these slots apply only if no
//     random time fits (e.g. feeders settle very late).
//   Final (62):  Nov 15, 10:00 UTC — same fallback-only status as SF.
// QF keeps its fixed slots: its 4 matches are already Open on-chain,
// so their kickoffs are locked regardless of what this file says.
const LATER_ROUND_SLOTS: { day: number; hour: number }[][] = [
  [], // R64: uses R64_DAY_OFFSETS, not this table
  [], // R32: already revealed, locked
  [
    { day: 9, hour: 10 }, { day: 9, hour: 12 }, { day: 9, hour: 14 }, { day: 9, hour: 16 },
    { day: 10, hour: 10 }, { day: 10, hour: 12 }, { day: 10, hour: 14 }, { day: 10, hour: 16 },
  ],
  [
    { day: 11, hour: 10 }, { day: 11, hour: 12 }, { day: 11, hour: 14 }, { day: 11, hour: 16 },
  ],
  [
    { day: 12, hour: 10 }, { day: 12, hour: 12 },
  ],
  [
    { day: 14, hour: 10 },
  ],
];

// Rounds whose kickoff is drawn at random instead of from the slot table:
// 4 = SF, 5 = Final (user decision 2026-11-11). R16/QF stay fixed-slot.
const RANDOM_ROUNDS = new Set([4, 5]);

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;

interface FailureState {
  count: number;
  nextRetryAtMs: number;
}

export class CupLifecycle {
  private readonly cache: CupMatchCache;
  private readonly r64StartMs: number;
  private readonly leadMs: number;
  private readonly durationMs = 60 * 60 * 1000; // cup matches are 1 hour
  private readonly failures = new Map<number, FailureState>();
  /**
   * matchId → sources used for the start snapshot. The end snapshot
   * prefers the same source per team so a venue spread can't masquerade
   * as a price move. Soft preference only: a stale preferred source
   * falls back to priority order, and cross-validation still applies.
   * Empty after a restart (start already on-chain) → priority order.
   */
  private readonly startSources = new Map<number, { a: PriceSource; b: PriceSource }>();
  private readonly knownBallots = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private drawIdleLogged = false;

  constructor(
    private readonly feed: PriceFeed,
    private readonly submitter: CupSubmitter,
    publicClient?: PublicClient
  ) {
    const chain = config.chainEnv === "mainnet" ? base : baseSepolia;
    const rpcUrl =
      config.chainEnv === "mainnet" ? config.baseMainnetRpcUrl : config.baseSepoliaRpcUrl;
    const client =
      publicClient ?? (createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient);
    this.cache = new CupMatchCache(client);
    const [y, mo, d] = config.cup.r64StartDate.split("-").map(Number);
    this.r64StartMs = Date.UTC(y, mo - 1, d);
    this.leadMs = config.cup.laterRoundLeadHours * 60 * 60 * 1000;
  }

  async start(): Promise<void> {
    await this.cache.loadAll();
    logger.info("[CupLifecycle] starting", {
      tickIntervalMs: config.cup.tickIntervalMs,
      r64Start: new Date(this.r64StartMs).toISOString().slice(0, 10),
      laterRoundLeadHours: config.cup.laterRoundLeadHours,
    });
    this.timer = setInterval(() => void this.tick(), config.cup.tickIntervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Read-only bracket for the REST API / frontend. */
  getMatches(): CupMatchView[] {
    return this.cache.all();
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const drawn = await this.submitter.drawExecuted();
      if (!drawn) {
        if (!this.drawIdleLogged) {
          logger.info("[CupLifecycle] draw not executed yet — idling until the draw ceremony");
          this.drawIdleLogged = true;
        }
        return;
      }
      this.drawIdleLogged = false;
      await this.cache.refresh();
      await this.revealDueKickoffs();
      await this.processLiveMatches();
      await this.settleDueMatches();
      await this.resolveDueBallots();
    } catch (err) {
      logger.error("[CupLifecycle] tick failed", { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  // ------------------------------------------------------------- reveals

  private async revealDueKickoffs(): Promise<void> {
    const now = Date.now();
    let revealed = 0;
    for (const m of this.cache.all()) {
      if (m.state !== STATE.Created || m.kickoffMs !== 0) continue;
      const isR64 = m.feederA === TBD && m.feederB === TBD;
      let kickoffMs: number | null = null;

      if (isR64) {
        kickoffMs = this.r64Kickoff(m.matchId, now);
      } else {
        const fa = this.cache.all().find((x) => x.matchId === m.feederA);
        const fb = this.cache.all().find((x) => x.matchId === m.feederB);
        if (!fa || !fb || fa.state !== STATE.Settled || fb.state !== STATE.Settled) continue;
        kickoffMs = this.laterRoundKickoff(m.matchId, now);
      }

      if (kickoffMs === null) continue;
      try {
        await this.submitter.revealKickoff(m.matchId, BigInt(Math.floor(kickoffMs / 1000)));
        m.kickoffMs = kickoffMs; // optimistic; refresh() confirms
        revealed++;
        logger.info("[CupLifecycle] cup kickoff revealed", {
          matchId: m.matchId,
          round: roundOf(m.matchId),
          kickoff: new Date(kickoffMs).toISOString(),
        });
      } catch (err) {
        logger.error("[CupLifecycle] cup revealKickoff failed", {
          matchId: m.matchId,
          error: String(err),
        });
      }
    }
    if (revealed > 0) logger.info("[CupLifecycle] reveal pass complete", { revealed });
  }

  /**
   * Deterministic R64 slot: day from R64_DAY_OFFSETS, time 10:00 UTC +
   * 2h per slot within the day (10:00, 12:00, …). Restart-safe: the same
   * matchId always maps to the same kickoff. If the backend starts late
   * (scheduled time already < now + 65min), push to now + 65min so the
   * reveal tx stays legal.
   */
  private r64Kickoff(matchId: number, now: number): number {
    const dayOffset = R64_DAY_OFFSETS[matchId];
    const dayStart = this.r64StartMs + dayOffset * 86_400_000;
    const slotInDay = R64_DAY_OFFSETS.slice(0, matchId).filter((d) => d === dayOffset).length;
    const scheduled = dayStart + (10 + slotInDay * 2) * 3_600_000;
    const earliest = now + 65 * 60_000;
    if (scheduled < earliest) {
      logger.warn("[CupLifecycle] R64 slot already passed — revealing late", {
        matchId,
        scheduled: new Date(scheduled).toISOString(),
      });
      return earliest;
    }
    return scheduled;
  }

  /**
   * Random kickoff for SF / Final (user decision 2026-11-11: 2 per day at
   * random times, not predetermined slots).
   *
   * Draws a random minute between 10:00 and 16:00 UTC on the round's day
   * (SF = Nov 13, Final = Nov 15), at least 2h clear of any
   * already-revealed match in the same round, and still leaving the full
   * lead (staking window) before kickoff. Returns null when no such time
   * exists (e.g. feeders settled so late the window is gone); the caller
   * then falls through to the slot / staggered fallback.
   *
   * Deliberately NOT restart-safe: each attempt draws a fresh time. That
   * is harmless because the time only becomes final when the reveal tx
   * lands on-chain; after that the match is Open and this code never runs
   * for it again. A failed reveal tx simply draws again on the next tick.
   */
  private randomRoundKickoff(matchId: number, now: number): number | null {
    const round = roundOf(matchId);
    const w = ROUND_WINDOWS[round];
    const dayStartMs = this.r64StartMs + w.start * 86_400_000;
    const windowOpenMs = dayStartMs + 10 * 3_600_000;
    const windowCloseMs = dayStartMs + 16 * 3_600_000;
    const earliest = Math.max(now + this.leadMs, now + 65 * 60_000, windowOpenMs);
    if (earliest > windowCloseMs) return null;
    const sameRound = this.cache
      .all()
      .filter((x) => roundOf(x.matchId) === round && x.kickoffMs !== 0);
    const minuteMs = 60_000;
    const spanMinutes = Math.floor((windowCloseMs - earliest) / minuteMs);
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = earliest + Math.floor(Math.random() * (spanMinutes + 1)) * minuteMs;
      if (sameRound.some((x) => Math.abs(x.kickoffMs - candidate) < 2 * 3_600_000)) continue;
      return candidate;
    }
    return null;
  }

  /**
   * Later rounds: deterministic staggered slot from LATER_ROUND_SLOTS,
   * same pattern as R64 (10:00 UTC + 2h per slot within the day).
   *
   * Why this replaced the old rule: the old rule was kickoff =
   * max(now + lead, window start). Every match whose feeders settled
   * before its round window opened therefore clamped to the exact same
   * window-start instant. That is what happened to R32 on Nov 6: 15 of
   * 16 matches all got Nov 7 00:00 UTC, and the 16th got 01:01 UTC.
   * A fixed slot per matchId cannot pile up that way, and it is
   * restart-safe: the same matchId always maps to the same kickoff.
   *
   * Fallback, only when the slot has already passed (feeders settled
   * late, e.g. after a dispute): kickoff = now + lead, rounded up to
   * the next even UTC hour, then stepped +2h until no other revealed
   * match in the same round is within 90 minutes of it. The contract
   * only requires 1h lead (MIN_KICKOFF_LEAD); the 65-minute margin
   * here is the safety buffer, and the 6h lead is the staking window
   * we try to preserve, not a contract rule. A blown window logs an
   * overrun and keeps the lead-time schedule — a late match beats a
   * doomed tx.
   */
  private laterRoundKickoff(matchId: number, now: number): number {
    const round = roundOf(matchId);
    const w = ROUND_WINDOWS[round];
    const windowStartMs = this.r64StartMs + w.start * 86_400_000;
    const windowEndMs = this.r64StartMs + (w.end + 1) * 86_400_000 - 1000;
    const earliestLegal = now + 65 * 60_000;
    const latestSane = windowEndMs - 70 * 60_000;

    // 0. Random rounds (SF, Final): draw a random kickoff inside the
    // round day instead of a fixed slot. Falls through to the slot /
    // staggered fallback below only if no random time fits.
    if (RANDOM_ROUNDS.has(round)) {
      const random = this.randomRoundKickoff(matchId, now);
      if (random !== null) {
        logger.info("[CupLifecycle] random kickoff drawn", {
          matchId,
          round,
          kickoff: new Date(random).toISOString(),
        });
        return random;
      }
      logger.warn("[CupLifecycle] no random slot fits — using slot/fallback", {
        matchId,
        round,
      });
    }

    // 1. Deterministic slot. Only use it if it still leaves the full
    // lead (staking window) between reveal and kickoff.
    const slot = LATER_ROUND_SLOTS[round]?.[matchId - ROUND_START[round]];
    if (slot) {
      const scheduled =
        this.r64StartMs + slot.day * 86_400_000 + slot.hour * 3_600_000;
      if (scheduled >= Math.max(earliestLegal, now + this.leadMs)) {
        return scheduled;
      }
      logger.warn("[CupLifecycle] later-round slot already passed — using staggered fallback", {
        matchId,
        round,
        scheduled: new Date(scheduled).toISOString(),
      });
    }

    // 2. Staggered fallback: next free even UTC hour at or after
    // now + lead, 2h apart from any already-revealed match in this round.
    const hourMs = 3_600_000;
    let candidate = Math.max(now + this.leadMs, windowStartMs, earliestLegal);
    candidate = Math.ceil(candidate / hourMs) * hourMs;
    if ((candidate / hourMs) % 2 !== 0) candidate += hourMs;
    const sameRound = this.cache
      .all()
      .filter((x) => roundOf(x.matchId) === round && x.kickoffMs !== 0);
    while (sameRound.some((x) => Math.abs(x.kickoffMs - candidate) < 90 * 60_000)) {
      candidate += 2 * hourMs;
    }

    if (candidate > latestSane) {
      const requiredLead = Math.max(earliestLegal, now + this.leadMs);
      const clampIsClear = !sameRound.some(
        (x) => Math.abs(x.kickoffMs - latestSane) < 90 * 60_000
      );
      if (latestSane >= requiredLead && clampIsClear) {
        logger.warn("[CupLifecycle] later-round kickoff clamped to round window edge", {
          matchId,
          kickoff: new Date(latestSane).toISOString(),
        });
        return latestSane;
      }
      logger.error("[CupLifecycle] ROUND WINDOW OVERRUN — manual review", {
        matchId,
        round,
        kickoff: new Date(candidate).toISOString(),
        windowEnd: new Date(windowEndMs).toISOString(),
      });
    }
    return candidate;
  }

  // ------------------------------------------------------------- live matches

  private async processLiveMatches(): Promise<void> {
    const now = Date.now();
    const live = this.cache
      .all()
      .filter((m) => m.state === STATE.Open && m.kickoffMs <= now);
    for (const m of live) {
      const failure = this.failures.get(m.matchId);
      if (failure && now < failure.nextRetryAtMs) continue;
      try {
        await this.processMatch(m, now);
        if (failure) this.failures.delete(m.matchId);
      } catch (err) {
        const count = (failure?.count ?? 0) + 1;
        const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS);
        this.failures.set(m.matchId, { count, nextRetryAtMs: now + backoffMs });
        logger.error("[CupLifecycle] cup match processing failed", {
          matchId: m.matchId,
          attempt: count,
          nextRetryInMin: Math.round(backoffMs / 60_000),
          error: String(err),
        });
      }
    }
  }

  private async processMatch(m: CupMatchView, now: number): Promise<void> {
    const wantEnd = m.endMs !== 0 && now >= m.endMs;
    const stored = wantEnd ? this.startSources.get(m.matchId) : undefined;
    let a, b;
    try {
      a = this.feed.getValidatedPrice(m.teamA, stored?.a);
      b = this.feed.getValidatedPrice(m.teamB, stored?.b);
    } catch (err) {
      if (err instanceof PriceValidationError || err instanceof PriceUnavailableError) {
        logger.warn("[CupLifecycle] cup snapshot blocked by price validation", {
          matchId: m.matchId,
          wantEnd,
          error: err.message,
        });
        return;
      }
      throw err;
    }
    logger.info("[CupLifecycle] submitting cup snapshot", {
      matchId: m.matchId,
      kind: wantEnd ? "endPrice" : "startPrice",
      a: `${CUP_TEAM_SYMBOLS[m.teamA]}=${a.scaled}`,
      b: `${CUP_TEAM_SYMBOLS[m.teamB]}=${b.scaled}`,
      sourceA: a.source,
      sourceB: b.source,
    });
    if (wantEnd) {
      await this.submitter.submitEndPrice(m.matchId, a.scaled, b.scaled, a.source, b.source);
      this.startSources.delete(m.matchId);
    } else {
      const audit = await this.submitter.submitStartPrice(m.matchId, a.scaled, b.scaled, a.source, b.source);
      // Record only a genuinely new start submission: on later ticks the
      // submitter skips (already on-chain) and must not overwrite the
      // kickoff-tick sources with a later tick's read.
      if (!audit.skipped) {
        this.startSources.set(m.matchId, { a: a.source, b: b.source });
      }
    }
  }

  // ------------------------------------------------------------- settle

  private async settleDueMatches(): Promise<void> {
    const now = Date.now();
    const due = this.cache
      .all()
      .filter(
        (m) => m.state === STATE.Open && m.endMs !== 0 && now >= m.endMs
      );
    for (const m of due) {
      try {
        await this.submitter.settleMatch(m.matchId);
      } catch (err) {
        logger.error("[CupLifecycle] cup settleMatch failed", {
          matchId: m.matchId,
          error: String(err),
        });
      }
    }
  }

  // ------------------------------------------------------------- ballots

  /**
   * Permissionless ballot resolution backstop: any unresolved ballot past
   * its 24h deadline gets resolved so the tournament never stalls on a
   * disputed match. Voting itself is DAO-only, on-chain.
   */
  private async resolveDueBallots(): Promise<void> {
    let count: bigint;
    try {
      count = await this.submitter.ballotCount();
    } catch (err) {
      logger.error("[CupLifecycle] ballotCount read failed", { error: String(err) });
      return;
    }
    for (let i = 0n; i < count; i++) {
      const id = i.toString();
      try {
        const b = await this.submitter.readBallot(i);
        if (!this.knownBallots.has(id)) {
          this.knownBallots.add(id);
          logger.warn("[CupLifecycle] dispute ballot open", {
            ballotId: id,
            matchId: b.matchId,
            accusedTeam: `${CUP_TEAM_SYMBOLS[b.accusedTeam] ?? b.accusedTeam}`,
            deadline: new Date(Number(b.deadline) * 1000).toISOString(),
          });
        }
        if (!b.resolved && Date.now() > Number(b.deadline) * 1000) {
          await this.submitter.resolveBallot(i);
        }
      } catch (err) {
        logger.error("[CupLifecycle] ballot check failed", { ballotId: id, error: String(err) });
      }
    }
  }
}

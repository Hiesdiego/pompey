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
 *      enforces this too), kickoff = now + lead, clamped into the round's
 *      date window so the published schedule holds.
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
import type { PriceFeed } from "./priceFeed.js";
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
      kickoffTimestamp: bigint;
      state: number;
      winner: number;
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
   * Later rounds: kickoff = now + lead, clamped into the round's date
   * window (never before the window opens; never so late the 1h contract
   * lead-time would break). A blown window logs an overrun and keeps the
   * lead-time schedule — a late match beats a doomed tx.
   */
  private laterRoundKickoff(matchId: number, now: number): number {
    const w = ROUND_WINDOWS[roundOf(matchId)];
    const windowStartMs = this.r64StartMs + w.start * 86_400_000;
    const windowEndMs = this.r64StartMs + (w.end + 1) * 86_400_000 - 1000;
    const earliestLegal = now + 65 * 60_000;
    let kickoff = Math.max(now + this.leadMs, windowStartMs, earliestLegal);
    const latestSane = windowEndMs - 70 * 60_000;
    if (kickoff > latestSane) {
      if (latestSane >= earliestLegal) {
        kickoff = latestSane;
        logger.warn("[CupLifecycle] later-round kickoff clamped to round window edge", {
          matchId,
          kickoff: new Date(kickoff).toISOString(),
        });
      } else {
        kickoff = now + this.leadMs;
        logger.error("[CupLifecycle] ROUND WINDOW OVERRUN — manual review", {
          matchId,
          round: roundOf(matchId),
          kickoff: new Date(kickoff).toISOString(),
          windowEnd: new Date(windowEndMs).toISOString(),
        });
      }
    }
    return kickoff;
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
    const wantEnd = now >= m.kickoffMs + this.durationMs;
    let a, b;
    try {
      a = this.feed.getValidatedPrice(m.teamA);
      b = this.feed.getValidatedPrice(m.teamB);
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
    } else {
      await this.submitter.submitStartPrice(m.matchId, a.scaled, b.scaled, a.source, b.source);
    }
  }

  // ------------------------------------------------------------- settle

  private async settleDueMatches(): Promise<void> {
    const now = Date.now();
    const due = this.cache
      .all()
      .filter(
        (m) => m.state === STATE.Open && m.kickoffMs !== 0 && now >= m.kickoffMs + this.durationMs
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

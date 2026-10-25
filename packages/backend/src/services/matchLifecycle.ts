











































import type { PublicClient } from "viem";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { publicClient as sharedPublicClient, withRpcRetry } from "../lib/rpc.js";
import { runLoop, type LoopHandle } from "../lib/loop.js";
import type { PriceFeed, PriceSource } from "./priceFeed.js";
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
          { name: "matchEndTimestamp", type: "uint64" },
          { name: "voided", type: "bool" },
        ],
      },
    ],
  },
] as const;




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
  kickoffMs: number;
  kickoffRevealed: boolean;
  matchEndMs: number;
  settled: boolean;
  voided: boolean;
}






const SAFETY_SWEEP_MS = 24 * 60 * 60_000;
const RETRY_POLL_MS = 5 * 60_000;
const FULL_REFRESH_EVERY_TICKS = 120;

const READ_CHUNK = 50;


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


  async refresh(): Promise<void> {
    const mutable = [...this.fixtures.values()].filter((f) => !f.settled);
    if (mutable.length === 0) return;
    for (const f of await this.readFixtures(mutable.map((x) => x.fixtureId))) {
      this.fixtures.set(f.fixtureId, f);
    }
  }






  async refreshHot(slotOf: (fixture: FixtureView) => number | null): Promise<void> {
    const now = Date.now();
    const hot = [...this.fixtures.values()].filter((f) => {
      if (f.settled) return false;
      if (f.kickoffRevealed) return now >= f.kickoffMs;
      const slot = slotOf(f);
      return f.windowStartMs <= now && now < f.windowEndMs &&
        (slot === null || now >= slot - REVEAL_LEAD_MAX_MS);
    });
    if (hot.length === 0) return;
    for (const f of await this.readFixtures(hot.map((x) => x.fixtureId))) {
      this.fixtures.set(f.fixtureId, f);
    }
  }

  async refreshIds(ids: bigint[]): Promise<void> {
    for (const fixture of await this.readFixtures(ids)) {
      this.fixtures.set(fixture.fixtureId, fixture);
    }
  }






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


          out.push(this.toFixtureView(chunk[k], r.result as Parameters<FixtureCache["toFixtureView"]>[1]));
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







const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;

interface FailureState {
  count: number;
  nextRetryAtMs: number;
}


const REVEAL_LEAD_MIN_MS = 30 * 60_000;
const REVEAL_LEAD_MAX_MS = 120 * 60_000;

const SLOT_START_PAD_MS = 30 * 60_000;

const SLOT_END_PAD_MS = 60 * 60_000;

const SLOT_GRID_MS = 15 * 60_000;

export class MatchLifecycle {
  private readonly cache: FixtureCache;
  private readonly durationMs: number;

  private readonly leadMs: number;
  private readonly failures = new Map<bigint, FailureState>();
  private readonly startVerifiedAt = new Map<bigint, number>();
  private readonly startSources = new Map<bigint, { home: PriceSource; away: PriceSource }>();
  private readonly endAttemptAt = new Map<bigint, number>();
  private readonly endConfirmed = new Set<bigint>();
  private readonly pendingRevealAt = new Map<bigint, number>();

  private readonly slotWarned = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private loop: LoopHandle | null = null;
  private stopped = false;
  private nextSweepAt = 0;
  private retryAfter = 0;
  private tickCount = 0;

  constructor(
    private readonly feed: PriceFeed,
    private readonly submitter: SnapshotSubmitter,
    publicClient?: PublicClient
  ) {
    this.cache = new FixtureCache(publicClient ?? sharedPublicClient);
    this.durationMs = config.leagues.main.matchDurationMinutes * 60 * 1000;



    this.leadMs = Math.min(Math.max(config.kickoff.leadMinutes, 35), 115) * 60 * 1000;
  }

  async start(): Promise<void> {
    this.stopped = false;
    try {
      await this.cache.loadAll();
    } catch (err) {
      if (process.env.SCHEDULER_MODE === "poll") throw err;
      logger.error("[MatchLifecycle] initial fixture read failed", { error: String(err) });
      this.nextSweepAt = Date.now();
      this.retryAfter = Date.now() + BACKOFF_BASE_MS;
      this.armNext();
      return;
    }
    this.nextSweepAt = Date.now() + (this.cache.size === 0 ? 60 * 60_000 : SAFETY_SWEEP_MS);
    if (this.cache.size === 0) {
      logger.warn(
        "[MatchLifecycle] no fixtures on-chain yet — the schedule has not been generated. " +
          "Lifecycle loop running idle until fixtures exist."
      );
    }
    logger.info("[MatchLifecycle] starting", {
      mode: process.env.SCHEDULER_MODE === "poll" ? "poll" : "event",
      matchDurationMin: config.leagues.main.matchDurationMinutes,
      kickoffLeadMin: config.kickoff.leadMinutes,
    });
    if (process.env.SCHEDULER_MODE === "poll") {
      this.loop = runLoop("match-lifecycle", config.kickoff.tickIntervalMs, () => this.pollTick());
      return;
    }
    await this.runScheduled(true);
  }

  stop(): void {
    this.stopped = true;
    this.loop?.stop();
    this.loop = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }


  getFixtures(): FixtureView[] {
    return this.cache.all();
  }







  getScheduledKickoffs(): Map<bigint, number> {
    const out = new Map<bigint, number>();
    for (const f of this.cache.all()) {
      if (f.settled) continue;
      const slot = this.kickoffSlotMs(f);
      if (slot !== null) out.set(f.fixtureId, slot);
    }
    return out;
  }







  isHotWindow(): boolean {
    const now = Date.now();
    const MARGIN_MS = 10 * 60_000;
    return this.cache.all().some((f) => {
      if (f.settled) return false;
      if (!f.kickoffRevealed) {
        if (f.windowStartMs > now || now >= f.windowEndMs) return false;
        const slot = this.kickoffSlotMs(f);

        if (slot === null) return true;
        return now >= slot - REVEAL_LEAD_MAX_MS - MARGIN_MS;
      }
      return now >= f.kickoffMs - MARGIN_MS;
    });
  }

  private async tick(skipRefresh = false): Promise<void> {
    if (!skipRefresh) {
      if (Date.now() >= this.nextSweepAt) {
        await this.cache.loadAll();
        this.nextSweepAt = Date.now() + (this.cache.size === 0 ? 60 * 60_000 : SAFETY_SWEEP_MS);
      } else {
        await this.cache.refreshHot((fixture) => this.kickoffSlotMs(fixture));
        const dueConfirmations = [...this.pendingRevealAt]
          .filter(([, at]) => at <= Date.now())
          .map(([id]) => id);
        if (dueConfirmations.length > 0) {
          await this.cache.refreshIds(dueConfirmations);
          for (const id of dueConfirmations) this.pendingRevealAt.delete(id);
        }
      }
    }
    await this.revealDueKickoffs();
    await this.processLiveMatches();
  }

  private async pollTick(): Promise<void> {
    this.tickCount++;
    if (this.tickCount % FULL_REFRESH_EVERY_TICKS === 0) {
      await this.cache.refresh();
    } else {
      await this.cache.refreshHot((fixture) => this.kickoffSlotMs(fixture));
    }
    await this.revealDueKickoffs();
    await this.processLiveMatches();
  }

  private async runScheduled(skipRefresh = false): Promise<void> {
    if (this.stopped) return;
    this.timer = null;
    try {
      await this.tick(skipRefresh);
      this.retryAfter = 0;
    } catch (err) {
      logger.error("[MatchLifecycle] scheduled pass failed", { error: String(err) });
      this.retryAfter = Date.now() + BACKOFF_BASE_MS;
    } finally {
      this.armNext();
    }
  }

  private armNext(): void {
    if (this.stopped) return;
    const now = Date.now();
    const next = this.retryAfter > now ? this.retryAfter : this.nextWakeAt(now);
    this.timer = setTimeout(
      () => void this.runScheduled(),
      Math.max(1_000, next - now)
    );
    this.timer.unref?.();
  }

  private nextWakeAt(now: number): number {
    let next = this.nextSweepAt;
    for (const confirmationAt of this.pendingRevealAt.values()) next = Math.min(next, confirmationAt);
    for (const fixture of this.cache.all()) {
      if (fixture.settled) continue;
      const failureAt = this.failures.get(fixture.fixtureId)?.nextRetryAtMs ?? 0;
      if (!fixture.kickoffRevealed) {
        const slot = this.kickoffSlotMs(fixture);
        if (slot === null || now >= fixture.windowEndMs) continue;
        if (now > slot - REVEAL_LEAD_MIN_MS && now + this.leadMs > fixture.windowEndMs) continue;
        const revealAt = Math.max(fixture.windowStartMs, slot - REVEAL_LEAD_MAX_MS);
        next = Math.min(next, Math.max(revealAt, failureAt, now));
        continue;
      }
      if (now < fixture.kickoffMs) {
        next = Math.min(next, fixture.kickoffMs);
        continue;
      }
      const endAt = fixture.kickoffMs + this.durationMs;
      if (now < endAt) {
        next = Math.min(next, endAt);
        const verifiedAt = this.startVerifiedAt.get(fixture.fixtureId);
        if (verifiedAt !== Number.MAX_SAFE_INTEGER) {
          const startAt = verifiedAt === undefined ? fixture.kickoffMs : verifiedAt + RETRY_POLL_MS;
          next = Math.min(next, Math.max(startAt, failureAt, now));
        }
      } else if (!this.endConfirmed.has(fixture.fixtureId)) {
        const endAttemptAt = this.endAttemptAt.get(fixture.fixtureId);
        const retryAt = endAttemptAt === undefined ? endAt : endAttemptAt + RETRY_POLL_MS;
        next = Math.min(next, Math.max(retryAt, failureAt, now));
      }
    }
    return next;
  }














  private kickoffSlotMs(f: FixtureView): number | null {
    const usableStart = f.windowStartMs + SLOT_START_PAD_MS;
    const usableEnd = f.windowEndMs - this.durationMs - SLOT_END_PAD_MS;
    if (usableEnd <= usableStart) return null;


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
      const failure = this.failures.get(f.fixtureId);
      if (failure && now < failure.nextRetryAtMs) continue;
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

      if (now < slot - REVEAL_LEAD_MAX_MS) {
        waiting++;
        continue;
      }
      let kickoffMs: number;
      let late = false;
      if (now <= slot - REVEAL_LEAD_MIN_MS) {
        kickoffMs = slot;
      } else {

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

        f.kickoffRevealed = true;
        f.kickoffMs = kickoffMs;
        this.pendingRevealAt.set(f.fixtureId, Date.now() + 2 * 60_000);
        this.failures.delete(f.fixtureId);
        revealed++;
        logger.info("[MatchLifecycle] kickoff revealed (window-spread)", {
          fixtureId: f.fixtureId.toString(),
          matchday: f.matchdayIndex,
          kickoff: new Date(kickoffMs).toISOString(),
          late,
        });
      } catch (err) {
        const count = (failure?.count ?? 0) + 1;
        const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS);
        this.failures.set(f.fixtureId, { count, nextRetryAtMs: now + backoffMs });
        logger.error("[MatchLifecycle] revealKickoff failed", {
          fixtureId: f.fixtureId.toString(),
          error: String(err),
        });
      }
    }
    logger.info("[MatchLifecycle] reveal pass complete", { due: due.length, revealed, waiting });
  }



  private async processLiveMatches(): Promise<void> {
    const now = Date.now();
    const live = this.cache
      .all()
      .filter((f) => f.kickoffRevealed && !f.settled && f.kickoffMs <= now);
    for (const f of live) {
      const failure = this.failures.get(f.fixtureId);
      if (failure && now < failure.nextRetryAtMs) continue;
      try {
        const processed = await this.processFixture(f, now);
        if (processed && failure) this.failures.delete(f.fixtureId);
        if (!processed) this.failures.set(f.fixtureId, { count: 1, nextRetryAtMs: now + BACKOFF_BASE_MS });
      } catch (err) {


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

  private async processFixture(f: FixtureView, now: number): Promise<boolean> {
    const matchEndMs = f.kickoffMs + this.durationMs;
    const wantEnd = now >= matchEndMs;
    const preferred = wantEnd ? this.startSources.get(f.fixtureId) : undefined;
    if (wantEnd && this.endConfirmed.has(f.fixtureId)) return true;
    if (wantEnd && now - (this.endAttemptAt.get(f.fixtureId) ?? 0) < RETRY_POLL_MS) return true;
    if (!wantEnd && now - (this.startVerifiedAt.get(f.fixtureId) ?? 0) < RETRY_POLL_MS) return true;

    let home, away;
    try {
      home = this.feed.getValidatedPrice(f.homeTeamId, preferred?.home);
      away = this.feed.getValidatedPrice(f.awayTeamId, preferred?.away);
    } catch (err) {
      if (err instanceof PriceValidationError || err instanceof PriceUnavailableError) {

        logger.warn("[MatchLifecycle] snapshot blocked by price validation", {
          fixtureId: f.fixtureId.toString(),
          wantEnd,
          error: err.message,
        });
        return false;
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
      const audit = await this.submitter.submitEndPrice(
        f.fixtureId, home.scaled, away.scaled, home.source, away.source
      );
      if (audit.skipped && audit.skipReason === "endPrice already submitted on-chain") {
        this.endConfirmed.add(f.fixtureId);
        this.startSources.delete(f.fixtureId);
      } else {
        this.endAttemptAt.set(f.fixtureId, now);
      }
    } else {
      const audit = await this.submitter.submitStartPrice(
        f.fixtureId, home.scaled, away.scaled, home.source, away.source
      );
      if (audit.skipped && audit.skipReason === "startPrice already submitted on-chain") {
        this.startVerifiedAt.set(f.fixtureId, Number.MAX_SAFE_INTEGER);
      } else {
        this.startVerifiedAt.set(f.fixtureId, now);
        if (!audit.skipped) this.startSources.set(f.fixtureId, { home: home.source, away: away.source });
      }
    }
    return true;
  }
}

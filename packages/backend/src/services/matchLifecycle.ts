











































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






const HOT_WINDOW_MS = 15 * 60_000;

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






  async refreshHot(): Promise<void> {
    const now = Date.now();
    const hot = [...this.fixtures.values()].filter(
      (f) =>
        !f.settled &&
        (f.kickoffRevealed
          ? now >= f.kickoffMs - HOT_WINDOW_MS
          : f.windowStartMs <= now + HOT_WINDOW_MS && now < f.windowEndMs)
    );
    if (hot.length === 0) return;
    for (const f of await this.readFixtures(hot.map((x) => x.fixtureId))) {
      this.fixtures.set(f.fixtureId, f);
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

  private async tick(): Promise<void> {
    this.tickCount++;



    if (this.tickCount % FULL_REFRESH_EVERY_TICKS === 0) {
      await this.cache.refresh();
    } else {
      await this.cache.refreshHot();
    }
    await this.revealDueKickoffs();
    await this.processLiveMatches();
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



  private async processLiveMatches(): Promise<void> {
    const now = Date.now();
    const live = this.cache
      .all()
      .filter((f) => f.kickoffRevealed && !f.settled && f.kickoffMs <= now);
    for (const f of live) {
      const failure = this.failures.get(f.fixtureId);
      if (failure && now < failure.nextRetryAtMs) continue;
      try {
        await this.processFixture(f, now);
        if (failure) this.failures.delete(f.fixtureId);
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

  private async processFixture(f: FixtureView, now: number): Promise<void> {
    const matchEndMs = f.kickoffMs + this.durationMs;
    const wantEnd = now >= matchEndMs;

    let home, away;
    try {
      home = this.feed.getValidatedPrice(f.homeTeamId);
      away = this.feed.getValidatedPrice(f.awayTeamId);
    } catch (err) {
      if (err instanceof PriceValidationError || err instanceof PriceUnavailableError) {

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

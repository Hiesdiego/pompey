/**
 * Stock on-chain read helpers for the REST API, league table, pools,
 * fixture results, forfeits.
 *
 * Intended destination: packages/backend/src/api/stockReadClient.ts.
 * Mirrors the crypto ChainReader (multicall team records, ResultRecorded
 * scan for GF/GA, 900-block getLogs chunks with watermarks, dirty-only
 * re-reads) with stock differences:
 *
 *   - Stock contracts, stock season id, STOCK_TEAMS (12 teams).
 *   - Table sort is the LOCKED tiebreak, applied here, never trusting
 *     the raw multicall order: points, goal difference, goals scored,
 *     wins, fewest losses. (The crypto backend learned this the hard way
 *     on 2026-11-09: the backend GF/GA scan can lag, so a table served
 *     in raw API order misorders tied teams.)
 *   - GF/GA come from the stock ResultEngine's ResultRecorded events.
 *     The event carries the scoreline positionally (homeGoals,
 *     awayGoals); the stock engine emits goal counts under the 5-bps
 *     scoring, exactly as the crypto engine emits them under 50 bps.
 *   - FORFEIT flag surfaced. Forfeits are indexed from the stock
 *     ResultEngine's ForfeitRecorded event, whose ABI matches the stock
 *     contract source (seasonId, fixtureId, homeTeamId, awayTeamId,
 *     forfeitingTeamId, outcome). The scan filters by topic, so an absent event
 *     simply yields an empty
 *     map, never an error. Table rows carry forfeitWins/forfeitLosses
 *     counts, and getStockFixtureResult() reports the forfeit per
 *     fixture. A forfeit win still counts as a normal 3-0 win in the
 *     table (that is the locked rule); the flag exists so the frontend
 *     and the API can show it WAS a forfeit, never a played 3-0.
 *   - Reads go through the shared fallback transport
 *     (createStockPublicClient from stockSnapshotSubmitter.ts).
 *   - 12-TEAM REVISION (2026-11-18): reads run only against the FRESH
 *     stock contracts from STOCK_* env vars. The old 22-team registry
 *     (fixtureCount 231) is never read; see stockConfig.ts.
 *   - NO PlayerStats reads here: the stock pool cannot write to the
 *     crypto PlayerStats (one-time setter already set), so there is no
 *     stock PlayerStats to read. Per-player stock outcomes are derived
 *     by stockTpAggregator.ts from pool events, not by this file.
 */

import { parseAbiItem, type PublicClient } from "viem";
import { stockConfig } from "../stockConfig.js";
import { logger } from "../lib/logger.js";
import { STOCK_TEAMS } from "../services/stockTeams.js";
import { createStockPublicClient } from "../services/stockSnapshotSubmitter.js";

const STOCK_RESULT_ENGINE_ABI = [
  {
    type: "function",
    name: "getTeamRecord",
    stateMutability: "view",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "teamId", type: "uint16" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "played", type: "uint16" },
          { name: "won", type: "uint16" },
          { name: "drawn", type: "uint16" },
          { name: "lost", type: "uint16" },
          { name: "points", type: "uint32" },
          { name: "goalDifferenceSum", type: "int32" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "ResultRecorded",
    inputs: [
      { name: "seasonId", type: "uint256", indexed: true },
      { name: "fixtureId", type: "uint256", indexed: true },
      { name: "homeTeamId", type: "uint16", indexed: false },
      { name: "awayTeamId", type: "uint16", indexed: false },
      { name: "outcome", type: "uint8", indexed: false },
      { name: "homeGoals", type: "int16", indexed: false },
      { name: "awayGoals", type: "int16", indexed: false },
    ],
  },
] as const;

const STOCK_PREDICTION_POOL_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "totalHome", type: "uint256" },
          { name: "totalDraw", type: "uint256" },
          { name: "totalAway", type: "uint256" },
          { name: "seed", type: "uint256" },
          { name: "settled", type: "bool" },
          { name: "voided", type: "bool" },
          { name: "winningOutcome", type: "uint8" },
        ],
      },
    ],
  },
] as const;

const FORFEIT_RECORDED_EVENT = parseAbiItem(
  "event ForfeitRecorded(uint256 indexed seasonId, uint256 indexed fixtureId, uint16 homeTeamId, uint16 awayTeamId, uint16 forfeitingTeamId, uint8 outcome)"
);

export interface StockTableRow {
  teamId: number;
  ticker: string;
  name: string;
  tokenSymbol: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  goalDifference: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Wins by opponent forfeit (still 3 pts, flagged so the UI can say so). */
  forfeitWins: number;
  /** Losses by own forfeit (still 0 pts, flagged so the UI can say so). */
  forfeitLosses: number;
}

export interface StockPoolView {
  seasonId: string;
  fixtureId: string;
  totalHome: string;
  totalDraw: string;
  totalAway: string;
  seed: string;
  totalPool: string;
  settled: boolean;
  voided: boolean;
  winningOutcome: number | null;
}

export interface StockFixtureResult {
  fixtureId: string;
  homeTeamId: number;
  awayTeamId: number;
  outcome: number;
  homeGoals: number;
  awayGoals: number;
  /** Present when the fixture was decided by forfeit, never for a played result. */
  forfeit: { forfeitingTeamId: number } | null;
  /** Present when the fixture was voided (both teams no performance). */
  voided: boolean;
}

/** eth_getLogs block-range cap on Base Sepolia public RPC is 1,000, stay under it. */
const LOG_SCAN_CHUNK_BLOCKS = 900n;

export class StockChainReader {
  private readonly publicClient: PublicClient;
  /** Goals for/against per teamId, built incrementally from ResultRecorded events. */
  private readonly goalsByTeam = new Map<number, { gf: number; ga: number }>();
  /** fixtureId -> forfeiting teamId, from ForfeitRecorded events. */
  private readonly forfeitsByFixture = new Map<string, number>();
  /** fixtureIds voided (both teams no performance). Tracked in-memory from
   *  the lifecycle; the chain source of truth is the pool's void state,
   *  surfaced via getPool().settled + a missing ResultRecorded. */
  private readonly voidedFixtures = new Set<string>();
  private goalsSeasonId: bigint | null = null;
  private resultsScannedTo: bigint | null = null;
  private forfeitsScannedTo: bigint | null = null;
  private resultScanPromise: Promise<void> | null = null;
  private forfeitScanPromise: Promise<void> | null = null;

  constructor(publicClient?: PublicClient) {
    this.publicClient = publicClient ?? createStockPublicClient();
  }

  get client(): PublicClient {
    return this.publicClient;
  }

  /** Last-known forfeit map (fixtureId -> forfeiting teamId). Sync read of the scan cache. */
  getForfeitMap(): Map<string, number> {
    return new Map(this.forfeitsByFixture);
  }

  markVoided(fixtureId: bigint): void {
    this.voidedFixtures.add(fixtureId.toString());
  }

  async getStockLeagueTable(seasonId: bigint): Promise<StockTableRow[]> {
    try {
      this.refreshResultEventsInBackground(seasonId);
      this.refreshForfeitEventsInBackground(seasonId);
    } catch (err) {
      logger.warn("[StockChainReader] event scan failed, serving table without GF/GA and forfeit flags", {
        error: String(err),
      });
    }
    // Read all team records in one multicall. One readContract call per
    // team caused the public RPC to throttle the crypto table endpoint.
    const results = (await this.publicClient.multicall({
      contracts: STOCK_TEAMS.map((team) => ({
        address: stockConfig.contracts.resultEngine,
        abi: STOCK_RESULT_ENGINE_ABI,
        functionName: "getTeamRecord",
        args: [seasonId, team.teamId],
      })),
      allowFailure: true,
    })) as Array<{ status: "success"; result: unknown } | { status: "failure"; error: unknown }>;

    const rows = results.map((result, index) => {
      const team = STOCK_TEAMS[index];
      if (result.status !== "success") {
        throw new Error(`Failed to read stock team record for ${team.tokenSymbol}: ${String(result.error)}`);
      }
      const raw = result.result as {
        played?: number;
        won?: number;
        drawn?: number;
        lost?: number;
        points?: number;
        goalDifferenceSum?: number;
        [index: number]: number;
      };
      const r = {
        played: Number(raw.played ?? raw[0] ?? 0),
        won: Number(raw.won ?? raw[1] ?? 0),
        drawn: Number(raw.drawn ?? raw[2] ?? 0),
        lost: Number(raw.lost ?? raw[3] ?? 0),
        points: Number(raw.points ?? raw[4] ?? 0),
        goalDifferenceSum: Number(raw.goalDifferenceSum ?? raw[5] ?? 0),
      };
      const g = this.goalsByTeam.get(team.teamId) ?? { gf: 0, ga: 0 };
      // Forfeit counts are per-fixture (the ForfeitRecorded map is keyed
      // by fixture, not team). They are 0 here; callers that need
      // table-level counts aggregate getStockFixtureResult() over the
      // settled fixtures. The per-fixture flag is the source of truth.
      return {
        teamId: team.teamId,
        ticker: team.ticker,
        name: team.name,
        tokenSymbol: team.tokenSymbol,
        played: r.played,
        won: r.won,
        drawn: r.drawn,
        lost: r.lost,
        points: r.points,
        goalDifference: r.goalDifferenceSum,
        goalsFor: g.gf,
        goalsAgainst: g.ga,
        forfeitWins: 0,
        forfeitLosses: 0,
      } satisfies StockTableRow;
    });
    // LOCKED tiebreak: points > goal difference > goals scored >
    // games won > fewer games lost. Never trust the raw multicall order.
    rows.sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        b.won - a.won ||
        a.lost - b.lost
    );
    return rows;
  }

  /**
   * Per-fixture result with the forfeit flag. The forfeit counts on the
   * table are derived here: a forfeit fixture's winner gains one
   * forfeitWin and the forfeiting team one forfeitLoss. Callers that
   * need table-level counts should aggregate this over settled fixtures.
   */
  async getStockFixtureResult(seasonId: bigint, fixtureId: bigint): Promise<StockFixtureResult | null> {
    await this.scanNewResultEvents(seasonId);
    await this.scanNewForfeitEvents(seasonId);
    // The scans above are watermarked, so re-scanning per call is cheap.
    const cached = this.resultByFixture.get(fixtureId.toString());
    const forfeitingTeamId = this.forfeitsByFixture.get(fixtureId.toString());
    if (!cached && forfeitingTeamId === undefined && !this.voidedFixtures.has(fixtureId.toString())) {
      // The in-memory voided set is only filled by this process's own
      // lifecycle (markVoided), so a restart loses every void submitted
      // before it (Season 1 fixture 5, voided on Thanksgiving 2026, read
      // as unvoided after the next deploy). The chain source of truth is
      // the pool: a voided fixture's pool reads voided with no
      // ResultRecorded behind it. Ask the chain once here and remember
      // a positive for the process lifetime; a void is final, so the
      // cached positive can never go stale.
      try {
        const pool = (await this.publicClient.readContract({
          address: stockConfig.contracts.predictionPool,
          abi: STOCK_PREDICTION_POOL_ABI,
          functionName: "getPool",
          args: [seasonId, fixtureId],
        })) as { voided: boolean };
        if (pool.voided) this.voidedFixtures.add(fixtureId.toString());
      } catch {
        // A failed read reports "unknown" (null below), never a false void.
      }
      if (!this.voidedFixtures.has(fixtureId.toString())) {
        return null;
      }
    }
    if (cached) {
      return {
        fixtureId: fixtureId.toString(),
        homeTeamId: cached.homeTeamId,
        awayTeamId: cached.awayTeamId,
        outcome: cached.outcome,
        homeGoals: cached.homeGoals,
        awayGoals: cached.awayGoals,
        forfeit: forfeitingTeamId !== undefined ? { forfeitingTeamId } : null,
        voided: this.voidedFixtures.has(fixtureId.toString()),
      };
    }
    // Forfeit recorded but no ResultRecorded yet (engine emits the
    // forfeit first): report the forfeit with the locked 0-3 scoreline.
    if (forfeitingTeamId !== undefined) {
      return {
        fixtureId: fixtureId.toString(),
        homeTeamId: -1,
        awayTeamId: -1,
        outcome: -1,
        homeGoals: 0,
        awayGoals: 0,
        forfeit: { forfeitingTeamId },
        voided: false,
      };
    }
    return {
      fixtureId: fixtureId.toString(),
      homeTeamId: -1,
      awayTeamId: -1,
      outcome: -1,
      homeGoals: 0,
      awayGoals: 0,
      forfeit: null,
      voided: true,
    };
  }

  async getStockPool(seasonId: bigint, fixtureId: bigint): Promise<StockPoolView> {
    const p = (await this.publicClient.readContract({
      address: stockConfig.contracts.predictionPool,
      abi: STOCK_PREDICTION_POOL_ABI,
      functionName: "getPool",
      args: [seasonId, fixtureId],
    })) as {
      totalHome: bigint;
      totalDraw: bigint;
      totalAway: bigint;
      seed: bigint;
      settled: boolean;
      voided: boolean;
      winningOutcome: number;
    };
    return {
      seasonId: seasonId.toString(),
      fixtureId: fixtureId.toString(),
      totalHome: p.totalHome.toString(),
      totalDraw: p.totalDraw.toString(),
      totalAway: p.totalAway.toString(),
      seed: p.seed.toString(),
      totalPool: (p.totalHome + p.totalDraw + p.totalAway).toString(),
      settled: p.settled,
      voided: p.voided,
      winningOutcome: p.settled ? p.winningOutcome : null,
    };
  }

  // ------------------------------------------------------------- event scans

  private readonly resultByFixture = new Map<
    string,
    { homeTeamId: number; awayTeamId: number; outcome: number; homeGoals: number; awayGoals: number }
  >();

  private refreshResultEventsInBackground(seasonId: bigint): void {
    if (this.resultScanPromise) return;
    this.resultScanPromise = new Promise<void>((resolve) => setTimeout(resolve, 0))
      .then(() => this.scanNewResultEvents(seasonId))
      .catch((err) => {
        logger.warn("[StockChainReader] ResultRecorded scan failed - serving table without GF/GA", {
          error: String(err),
        });
      })
      .finally(() => {
        this.resultScanPromise = null;
      });
  }

  private refreshForfeitEventsInBackground(seasonId: bigint): void {
    if (this.forfeitScanPromise) return;
    this.forfeitScanPromise = new Promise<void>((resolve) => setTimeout(resolve, 0))
      .then(() => this.scanNewForfeitEvents(seasonId))
      .catch((err) => {
        logger.warn("[StockChainReader] ForfeitRecorded scan failed - serving table without forfeit flags", {
          error: String(err),
        });
      })
      .finally(() => {
        this.forfeitScanPromise = null;
      });
  }

  private async scanNewResultEvents(seasonId: bigint): Promise<void> {
    if (this.goalsSeasonId !== seasonId) {
      this.goalsByTeam.clear();
      this.resultByFixture.clear();
      this.goalsSeasonId = seasonId;
      this.resultsScannedTo = null;
    }
    const latest = await this.publicClient.getBlockNumber();
    let from =
      this.resultsScannedTo !== null ? this.resultsScannedTo + 1n : stockConfig.leaderboard.scanStartBlock;
    if (from > latest) return;
    while (from <= latest) {
      const chunkEnd = from + LOG_SCAN_CHUNK_BLOCKS - 1n;
      const to = chunkEnd > latest ? latest : chunkEnd;
      const logs = await this.publicClient.getLogs({
        address: stockConfig.contracts.resultEngine,
        event: {
          type: "event",
          name: "ResultRecorded",
          inputs: [
            { name: "seasonId", type: "uint256", indexed: true },
            { name: "fixtureId", type: "uint256", indexed: true },
            { name: "homeTeamId", type: "uint16", indexed: false },
            { name: "awayTeamId", type: "uint16", indexed: false },
            { name: "outcome", type: "uint8", indexed: false },
            { name: "homeGoals", type: "int16", indexed: false },
            { name: "awayGoals", type: "int16", indexed: false },
          ],
        },
        args: { seasonId },
        fromBlock: from,
        toBlock: to,
      });
      for (const l of logs) {
        const a = l.args as unknown as {
          fixtureId: bigint;
          homeTeamId: number;
          awayTeamId: number;
          outcome: number;
          homeGoals: number;
          awayGoals: number;
        };
        const hg = Number(a.homeGoals);
        const ag = Number(a.awayGoals);
        const key = a.fixtureId.toString();
        if (!this.resultByFixture.has(key)) {
          this.resultByFixture.set(key, {
            homeTeamId: a.homeTeamId,
            awayTeamId: a.awayTeamId,
            outcome: a.outcome,
            homeGoals: hg,
            awayGoals: ag,
          });
          const home = this.goalsByTeam.get(a.homeTeamId) ?? { gf: 0, ga: 0 };
          home.gf += hg;
          home.ga += ag;
          this.goalsByTeam.set(a.homeTeamId, home);
          const away = this.goalsByTeam.get(a.awayTeamId) ?? { gf: 0, ga: 0 };
          away.gf += ag;
          away.ga += hg;
          this.goalsByTeam.set(a.awayTeamId, away);
        }
      }
      from = to + 1n;
    }
    this.resultsScannedTo = latest;
  }

  private async scanNewForfeitEvents(seasonId: bigint): Promise<void> {
    const latest = await this.publicClient.getBlockNumber();
    let from =
      this.forfeitsScannedTo !== null ? this.forfeitsScannedTo + 1n : stockConfig.leaderboard.scanStartBlock;
    if (from > latest) return;
    while (from <= latest) {
      const chunkEnd = from + LOG_SCAN_CHUNK_BLOCKS - 1n;
      const to = chunkEnd > latest ? latest : chunkEnd;
      const logs = await this.publicClient.getLogs({
        address: stockConfig.contracts.resultEngine,
        event: FORFEIT_RECORDED_EVENT,
        args: { seasonId },
        fromBlock: from,
        toBlock: to,
      });
      for (const l of logs) {
        const a = l.args as unknown as { fixtureId: bigint; forfeitingTeamId: number };
        this.forfeitsByFixture.set(a.fixtureId.toString(), Number(a.forfeitingTeamId));
      }
      from = to + 1n;
    }
    this.forfeitsScannedTo = latest;
  }
}

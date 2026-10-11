
import { parseAbiItem, type PublicClient } from "viem";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { publicClient } from "../lib/rpc.js";
import { TICKR_TEAMS } from "@tickr/shared";

const RESULT_ENGINE_ABI = [
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

const PREDICTION_POOL_ABI = [
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
          { name: "winningOutcome", type: "uint8" },

        ],
      },
    ],
  },
] as const;

const PLAYER_STATS_ABI = [
  {
    type: "function",
    name: "getStats",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "wins", type: "uint32" },
          { name: "losses", type: "uint32" },
          { name: "draws", type: "uint32" },
          { name: "currentStreak", type: "uint32" },
          { name: "longestStreak", type: "uint32" },
          { name: "totalStakedTick", type: "uint256" },
          { name: "totalWonTick", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "winRateBps",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const OUTCOME_RECORDED_EVENT = parseAbiItem(
  "event OutcomeRecorded(address indexed player, uint256 indexed seasonId, uint256 fixtureId, bool won, bool isDraw)"
);

export interface TableRow {
  teamId: number;
  name: string;
  symbol: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  goalDifference: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface RecentFormEntry {
  fixtureId: string;
  opponentTeamId: number;
  result: "W" | "D" | "L";
  goalsFor: number;
  goalsAgainst: number;
}

interface RecordedFixtureResult {
  fixtureId: string;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number;
  awayGoals: number;
  blockNumber: bigint;
  logIndex: number;
}

export interface PoolView {
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

export interface PlayerView {
  address: string;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  longestStreak: number;
  totalStakedTick: string;
  totalWonTick: string;
  winRateBps: string;
}

const LEADERBOARD_CACHE_MS = 60_000;

const LOG_SCAN_CHUNK_BLOCKS = 900n;

export class ChainReader {
  private readonly publicClient: PublicClient;
  private leaderboardCache: { at: number; rows: PlayerView[] } | null = null;

  private readonly leaderboardRows = new Map<`0x${string}`, PlayerView>();

  private leaderboardScannedTo: bigint | null = null;

  private readonly goalsByTeam = new Map<number, { gf: number; ga: number }>();
  private readonly resultsByFixture = new Map<string, RecordedFixtureResult>();

  private goalsSeasonId: bigint | null = null;

  private resultsScannedTo: bigint | null = null;
  private resultHistoryReady = false;

  private resultScanPromise: Promise<void> | null = null;

  getRecentForm(seasonId: bigint, homeTeamId: number, awayTeamId: number): {
    ready: boolean;
    home: RecentFormEntry[];
    away: RecentFormEntry[];
  } {
    this.refreshResultEventsInBackground(seasonId);
    const recent = (teamId: number): RecentFormEntry[] => [...this.resultsByFixture.values()]
      .filter((result) => result.homeTeamId === teamId || result.awayTeamId === teamId)
      .sort((a, b) => a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1)
      .slice(0, 5)
      .map((result) => {
        const isHome = result.homeTeamId === teamId;
        const goalsFor = isHome ? result.homeGoals : result.awayGoals;
        const goalsAgainst = isHome ? result.awayGoals : result.homeGoals;
        return {
          fixtureId: result.fixtureId,
          opponentTeamId: isHome ? result.awayTeamId : result.homeTeamId,
          result: goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D",
          goalsFor,
          goalsAgainst,
        };
      });
    return {
      ready: this.goalsSeasonId === seasonId && this.resultHistoryReady,
      home: recent(homeTeamId),
      away: recent(awayTeamId),
    };
  }

  constructor() {

    this.publicClient = publicClient;
  }

  get client(): PublicClient {
    return this.publicClient;
  }

  async getLeagueTable(seasonId: bigint): Promise<TableRow[]> {
    try {
      this.refreshResultEventsInBackground(seasonId);
    } catch (err) {
      logger.warn("[ChainReader] ResultRecorded scan failed — serving table without GF/GA", {
        error: String(err),
      });
    }

    const results = (await this.publicClient.multicall({
      contracts: TICKR_TEAMS.map((team) => ({
        address: config.contracts.resultEngine,
        abi: RESULT_ENGINE_ABI,
        functionName: "getTeamRecord",
        args: [seasonId, team.teamId],
      })),
      allowFailure: true,
    })) as Array<{ status: "success"; result: unknown } | { status: "failure"; error: unknown }>;

    const rows = results.map((result, index) => {
      const team = TICKR_TEAMS[index];
      if (result.status !== "success") {
        throw new Error(`Failed to read team record for ${team.symbol}: ${String(result.error)}`);
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
      return {
        teamId: team.teamId,
        name: team.name,
        symbol: team.symbol,
        played: r.played,
        won: r.won,
        drawn: r.drawn,
        lost: r.lost,
        points: r.points,
        goalDifference: r.goalDifferenceSum,
        goalsFor: g.gf,
        goalsAgainst: g.ga,
      } satisfies TableRow;
    });

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

  private refreshResultEventsInBackground(seasonId: bigint): void {
    if (this.resultScanPromise) return;
    this.resultScanPromise = new Promise<void>((resolve) => setTimeout(resolve, 0))
      .then(() => this.scanNewResultEvents(seasonId))
      .catch((err) => {
        logger.warn("[ChainReader] ResultRecorded scan failed - serving table without GF/GA", {
          error: String(err),
        });
      })
      .finally(() => {
        this.resultScanPromise = null;
      });
  }

  private async scanNewResultEvents(seasonId: bigint): Promise<void> {
    if (this.goalsSeasonId !== seasonId) {
      this.goalsByTeam.clear();
      this.resultsByFixture.clear();
      this.goalsSeasonId = seasonId;
      this.resultsScannedTo = null;
      this.resultHistoryReady = false;
    }
    const latest = await this.publicClient.getBlockNumber();
    let from =
      this.resultsScannedTo !== null ? this.resultsScannedTo + 1n : config.leaderboard.scanStartBlock;
    if (from > latest) {
      if (this.resultsScannedTo === null) this.resultsScannedTo = latest;
      this.resultHistoryReady = true;
      return;
    }
    while (from <= latest) {
      const chunkEnd = from + LOG_SCAN_CHUNK_BLOCKS - 1n;
      const to = chunkEnd > latest ? latest : chunkEnd;
      const logs = await this.publicClient.getLogs({
        address: config.contracts.resultEngine,
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
          homeGoals: number;
          awayGoals: number;
        };
        const hg = Number(a.homeGoals);
        const ag = Number(a.awayGoals);
        this.resultsByFixture.set(String(a.fixtureId), {
          fixtureId: String(a.fixtureId),
          homeTeamId: Number(a.homeTeamId),
          awayTeamId: Number(a.awayTeamId),
          homeGoals: hg,
          awayGoals: ag,
          blockNumber: l.blockNumber,
          logIndex: l.logIndex,
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
      this.resultsScannedTo = to;
      from = to + 1n;
    }
    this.resultHistoryReady = true;
  }

  async getPool(seasonId: bigint, fixtureId: bigint): Promise<PoolView> {
    const p = (await this.publicClient.readContract({
      address: config.contracts.predictionPool,
      abi: PREDICTION_POOL_ABI,
      functionName: "getPool",
      args: [seasonId, fixtureId],
    })) as {
      totalHome: bigint;
      totalDraw: bigint;
      totalAway: bigint;
      seed: bigint;
      settled: boolean;
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

      voided: false,
      winningOutcome: p.settled ? p.winningOutcome : null,
    };
  }

  async getPlayer(address: `0x${string}`): Promise<PlayerView> {
    const [stats, winRate] = await Promise.all([
      this.publicClient.readContract({
        address: config.contracts.playerStats,
        abi: PLAYER_STATS_ABI,
        functionName: "getStats",
        args: [address],
      }),
      this.publicClient.readContract({
        address: config.contracts.playerStats,
        abi: PLAYER_STATS_ABI,
        functionName: "winRateBps",
        args: [address],
      }),
    ]);
    const s = stats as {
      wins: number;
      losses: number;
      draws: number;
      currentStreak: number;
      longestStreak: number;
      totalStakedTick: bigint;
      totalWonTick: bigint;
    };
    return {
      address,
      wins: s.wins,
      losses: s.losses,
      draws: s.draws,
      currentStreak: s.currentStreak,
      longestStreak: s.longestStreak,
      totalStakedTick: s.totalStakedTick.toString(),
      totalWonTick: s.totalWonTick.toString(),
      winRateBps: (winRate as bigint).toString(),
    };
  }

  async getLeaderboard(limit = 100): Promise<PlayerView[]> {
    if (this.leaderboardCache && Date.now() - this.leaderboardCache.at < LEADERBOARD_CACHE_MS) {
      return this.leaderboardCache.rows.slice(0, limit);
    }
    let touched: Set<`0x${string}`>;
    try {
      touched = await this.scanNewOutcomeEvents();
    } catch (err) {
      logger.warn("[ChainReader] event scan for leaderboard failed", { error: String(err) });

      if (this.leaderboardCache) return this.leaderboardCache.rows.slice(0, limit);
      return [];
    }

    const fresh = await Promise.all([...touched].map((p) => this.getPlayer(p)));
    for (const row of fresh) this.leaderboardRows.set(row.address as `0x${string}`, row);

    const rows = [...this.leaderboardRows.values()];
    rows.sort((a, b) => Number(BigInt(b.winRateBps) - BigInt(a.winRateBps)));
    this.leaderboardCache = { at: Date.now(), rows };
    return rows.slice(0, limit);
  }

  private async scanNewOutcomeEvents(): Promise<Set<`0x${string}`>> {
    const touched = new Set<`0x${string}`>();
    const latest = await this.publicClient.getBlockNumber();
    let from =
      this.leaderboardScannedTo !== null
        ? this.leaderboardScannedTo + 1n
        : config.leaderboard.scanStartBlock;
    if (from > latest) return touched;

    let pages = 0;
    while (from <= latest) {
      const chunkEnd = from + LOG_SCAN_CHUNK_BLOCKS - 1n;
      const to = chunkEnd > latest ? latest : chunkEnd;
      const logs = await this.publicClient.getLogs({
        address: config.contracts.playerStats,
        event: OUTCOME_RECORDED_EVENT,
        fromBlock: from,
        toBlock: to,
      });
      for (const l of logs) touched.add(l.args.player as `0x${string}`);
      pages++;
      from = to + 1n;
    }
    this.leaderboardScannedTo = latest;
    logger.debug("[ChainReader] leaderboard event scan complete", {
      pages,
      touched: touched.size,
      knownPlayers: this.leaderboardRows.size,
      scannedTo: latest.toString(),
    });
    return touched;
  }
}

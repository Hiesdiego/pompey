/**
 * On-chain read helpers for the REST API — league table, pools, player stats.
 *
 * The leaderboard is built by indexing PlayerStats.OutcomeRecorded events
 * (the contract can't enumerate players on-chain — sorting an unbounded
 * player set on-chain isn't gas-viable, per the contract's own docs).
 *
 * Base Sepolia's public RPC caps eth_getLogs at 1,000 blocks per call, so the
 * event scan pages through history in 900-block chunks and keeps a watermark:
 * each refresh only fetches blocks since the last scan. Results are cached
 * briefly to avoid re-scanning logs on every request, and only players with
 * new events are re-read (everyone else keeps their cached stats).
 */

import { createPublicClient, http, parseAbiItem, type PublicClient } from "viem";
import { baseSepolia, base } from "viem/chains";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
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
}

export interface PoolView {
  seasonId: string;
  fixtureId: string;
  totalHome: string;
  totalDraw: string;
  totalAway: string;
  totalPool: string;
  settled: boolean;
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
/** eth_getLogs block-range cap on Base Sepolia public RPC is 1,000 — stay under it. */
const LOG_SCAN_CHUNK_BLOCKS = 900n;

export class ChainReader {
  private readonly publicClient: PublicClient;
  private leaderboardCache: { at: number; rows: PlayerView[] } | null = null;
  /** Per-player stats cache — only players with new events are re-read. */
  private readonly leaderboardRows = new Map<`0x${string}`, PlayerView>();
  /** Highest block already scanned for OutcomeRecorded events (null = never). */
  private leaderboardScannedTo: bigint | null = null;

  constructor() {
    const chain = config.chainEnv === "mainnet" ? base : baseSepolia;
    const rpcUrl =
      config.chainEnv === "mainnet" ? config.baseMainnetRpcUrl : config.baseSepoliaRpcUrl;
    // The selected Base chain is runtime-configured. PublicClient's inferred
    // union is stricter than the chain-agnostic client used by this reader.
    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;
  }

  get client(): PublicClient {
    return this.publicClient;
  }

  async getLeagueTable(seasonId: bigint): Promise<TableRow[]> {
    const rows = await Promise.all(
      TICKR_TEAMS.map(async (team) => {
        const r = (await this.publicClient.readContract({
          address: config.contracts.resultEngine,
          abi: RESULT_ENGINE_ABI,
          functionName: "getTeamRecord",
          args: [seasonId, team.teamId],
        })) as {
          played: number;
          won: number;
          drawn: number;
          lost: number;
          points: number;
          goalDifferenceSum: number;
        };
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
        } satisfies TableRow;
      })
    );
    // Football ordering: points, then goal difference.
    rows.sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
    return rows;
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
      settled: boolean;
      winningOutcome: number;
    };
    return {
      seasonId: seasonId.toString(),
      fixtureId: fixtureId.toString(),
      totalHome: p.totalHome.toString(),
      totalDraw: p.totalDraw.toString(),
      totalAway: p.totalAway.toString(),
      totalPool: (p.totalHome + p.totalDraw + p.totalAway).toString(),
      settled: p.settled,
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
      // Serve the last good snapshot instead of wiping the leaderboard.
      if (this.leaderboardCache) return this.leaderboardCache.rows.slice(0, limit);
      return [];
    }
    // Re-read only players with new events (includes brand-new players);
    // everyone else keeps their cached stats — no redundant RPC calls.
    const fresh = await Promise.all([...touched].map((p) => this.getPlayer(p)));
    for (const row of fresh) this.leaderboardRows.set(row.address as `0x${string}`, row);

    const rows = [...this.leaderboardRows.values()];
    rows.sort((a, b) => Number(BigInt(b.winRateBps) - BigInt(a.winRateBps)));
    this.leaderboardCache = { at: Date.now(), rows };
    return rows.slice(0, limit);
  }

  /**
   * Incrementally index OutcomeRecorded events, paging in 900-block chunks
   * (Base Sepolia caps eth_getLogs at 1,000 blocks per call). The watermark
   * means each refresh only fetches blocks since the previous scan.
   *
   * @returns addresses that appeared in the newly scanned range.
   */
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

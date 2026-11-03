import { decodeEventLog, type PublicClient } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { publicClient } from "../lib/rpc.js";
import { getSocialChainId } from "../lib/socialChain.js";
import { runLoop, type LoopHandle } from "../lib/loop.js";

const EVENTS = [
  { type: "event", name: "MatchStaked", inputs: [{ name: "matchId", type: "uint16", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "side", type: "uint8" }, { name: "amount", type: "uint256" }] },
  { type: "event", name: "SpreadStaked", inputs: [{ name: "spreadId", type: "uint256", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "side", type: "uint8" }, { name: "amount", type: "uint256" }] },
  { type: "event", name: "OutrightStaked", inputs: [{ name: "teamId", type: "uint16", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "amount", type: "uint256" }] },
  { type: "event", name: "MatchPoolSettled", inputs: [{ name: "matchId", type: "uint16", indexed: true }, { name: "winner", type: "uint16", indexed: true }, { name: "totalPool", type: "uint256" }] },
  { type: "event", name: "SpreadSettled", inputs: [{ name: "spreadId", type: "uint256", indexed: true }, { name: "covered", type: "bool" }, { name: "totalPool", type: "uint256" }] },
  { type: "event", name: "OutrightSettled", inputs: [{ name: "champion", type: "uint16", indexed: true }, { name: "totalPool", type: "uint256" }] },
] as const;

const MATCH_ABI = [{ type: "function", name: "getMatch", stateMutability: "view", inputs: [{ name: "matchId", type: "uint16" }], outputs: [{ type: "tuple", components: [
  { name: "teamA", type: "uint16" }, { name: "teamB", type: "uint16" }, { name: "feederA", type: "uint16" }, { name: "feederB", type: "uint16" }, { name: "winner", type: "uint16" }, { name: "kickoffTimestamp", type: "uint64" }, { name: "endTimestamp", type: "uint64" }, { name: "state", type: "uint8" }, { name: "goalsA", type: "int16" }, { name: "goalsB", type: "int16" },
] }] }] as const;

export class CupLeaderboardIndexer {
  private loop: LoopHandle | null = null;
  private scanning = false;
  private nextBlock: bigint | null = null;
  private readonly client: PublicClient = publicClient;
  private readonly chainId = getSocialChainId();
  private readonly pool: string;
  private readonly key: string;

  constructor(private readonly db: SupabaseClient | null, poolAddress: `0x${string}` = config.cup.pool) {
    this.pool = poolAddress.toLowerCase();
    this.key = `cup_leaderboard:${this.chainId}:${this.pool}`;
  }

  async start() {
    if (!this.db || !config.cup.enabled || !/^0x[a-f0-9]{40}$/.test(this.pool)) return;
    const { data, error } = await this.db.from("indexer_state").select("last_block").eq("key", this.key).maybeSingle();
    if (error) throw new Error(`Cup leaderboard watermark: ${error.message}`);
    const configured = process.env.CUP_POOL_DEPLOY_BLOCK;
    this.nextBlock = data ? BigInt(data.last_block) + 1n
      : configured && /^\d+$/.test(configured) ? BigInt(configured)
      : await this.findDeployBlock();
    await this.poll().catch((err) => logger.warn("[cup leaderboard] initial scan failed", { error: String(err) }));
    this.loop = runLoop("cup-leaderboard-indexer", 120_000, () => this.poll());
  }

  stop() { this.loop?.stop(); this.loop = null; }

  private async findDeployBlock(): Promise<bigint> {
    let low = 0n;
    let high = await this.client.getBlockNumber();
    while (low < high) {
      const mid = (low + high) / 2n;
      const code = await this.client.getBytecode({ address: this.pool as `0x${string}`, blockNumber: mid });
      if (code && code !== "0x") high = mid;
      else low = mid + 1n;
    }
    logger.info("[cup leaderboard] discovered pool deployment", { block: low.toString() });
    return low;
  }

  private async poll() {
    if (this.scanning || this.nextBlock === null || !this.db) return;
    this.scanning = true;
    try {
      const latest = await this.client.getBlockNumber();
      for (let chunks = 0; this.nextBlock !== null && this.nextBlock <= latest && chunks < 10; chunks++) {
        const from: bigint = this.nextBlock;
        const to: bigint = from + 899n < latest ? from + 899n : latest;
        const logs = await this.client.getLogs({ address: this.pool as `0x${string}`, fromBlock: from, toBlock: to });
        for (const log of logs) {
          if (log.transactionHash === null || log.blockNumber === null || log.logIndex === null) continue;
          let event: ReturnType<typeof decodeEventLog>;
          try { event = decodeEventLog({ abi: EVENTS, data: log.data, topics: log.topics }); }
          catch { continue; }
          const args = event.args as unknown as Record<string, bigint | number | boolean | string>;
          const base = { chain_id: this.chainId, pool_address: this.pool };
          if (event.eventName.endsWith("Staked")) {
            const market_kind = event.eventName === "MatchStaked" ? "match" : event.eventName === "SpreadStaked" ? "spread" : "outright";
            const market_id = market_kind === "match" ? args.matchId : market_kind === "spread" ? args.spreadId : 0;
            const outcome = market_kind === "outright" ? args.teamId : args.side;
            const { error } = await this.db.from("cup_prediction_events").upsert({ ...base, tx_hash: log.transactionHash.toLowerCase(), log_index: log.logIndex, wallet_address: String(args.player).toLowerCase(), market_kind, market_id: String(market_id), outcome: Number(outcome), amount_tick: String(args.amount) }, { onConflict: "chain_id,pool_address,tx_hash,log_index", ignoreDuplicates: true });
            if (error) throw new Error(`Cup stake insert: ${error.message}`);
          } else {
            const market_kind = event.eventName === "MatchPoolSettled" ? "match" : event.eventName === "SpreadSettled" ? "spread" : "outright";
            const market_id = market_kind === "match" ? args.matchId : market_kind === "spread" ? args.spreadId : 0;
            let winning_outcome = market_kind === "spread" ? (args.covered ? 0 : 1) : Number(args.champion);
            if (market_kind === "match") {
              const match = await this.client.readContract({ address: config.cup.registry, abi: MATCH_ABI, functionName: "getMatch", args: [Number(args.matchId)], blockNumber: log.blockNumber });
              winning_outcome = Number(args.winner) === match.teamA ? 0 : 1;
            }
            const { error } = await this.db.from("cup_prediction_results").upsert({ ...base, market_kind, market_id: String(market_id), winning_outcome }, { onConflict: "chain_id,pool_address,market_kind,market_id" });
            if (error) throw new Error(`Cup result insert: ${error.message}`);
          }
        }
        const { error } = await this.db.from("indexer_state").upsert({ key: this.key, last_block: to.toString(), updated_at: new Date().toISOString() }, { onConflict: "key" });
        if (error) throw new Error(`Cup watermark: ${error.message}`);
        this.nextBlock = to + 1n;
      }
    } finally { this.scanning = false; }
  }
}

import "server-only";
import { unstable_cache } from "next/cache";
import { getSupabase } from "./supabaseServer";
import { ACTIVE_CHAIN_ID } from "./contracts";
import { CUP_CONTRACTS } from "./cup";

export interface CupLeaderboardRow {
  walletAddress: string;
  username: string;
  points: number;
  correct: number;
  predictions: number;
  stakeBonus: number;
  convictionBonus: number;
  xBonus: number;
  rank: number;
}

export const getCupLeaderboard = unstable_cache(async (): Promise<CupLeaderboardRow[]> => {
  const db = getSupabase();
  if (!db || !CUP_CONTRACTS.pool) throw new Error("Cup leaderboard is not configured");
  const raw: Array<Record<string, string | number>> = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.rpc("cup_leaderboard", { p_chain_id: ACTIVE_CHAIN_ID, p_pool_address: CUP_CONTRACTS.pool.toLowerCase(), p_match_pool_address: CUP_CONTRACTS.matchPool.toLowerCase() }).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Cup leaderboard query failed: ${error.message}`);
    const page = (data ?? []) as Array<Record<string, string | number>>;
    raw.push(...page);
    if (page.length < pageSize) break;
  }
  let previous = -1;
  let rank = 0;
  return raw.map((row, index) => {
    const points = Number(row.points);
    if (points !== previous) { rank = index + 1; previous = points; }
    return { walletAddress: String(row.wallet_address), username: String(row.username), points,
      correct: Number(row.correct), predictions: Number(row.predictions),
      stakeBonus: Number(row.stake_bonus), convictionBonus: Number(row.conviction_bonus),
      xBonus: Number(row.x_bonus), rank };
  });
}, ["cup-leaderboard-v2"], { revalidate: 30 });

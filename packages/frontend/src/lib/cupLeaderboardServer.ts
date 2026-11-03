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
  const pageSize = 500;
  const oldPool = CUP_CONTRACTS.pool.toLowerCase();
  const matchPool = CUP_CONTRACTS.matchPool.toLowerCase();
  async function readRows(args: { p_chain_id: number; p_pool_address: string; p_match_pool_address?: string }) {
    const rows: Array<Record<string, string | number>> = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await db!.rpc("cup_leaderboard", args).range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as Array<Record<string, string | number>>;
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }
  let raw: Array<Record<string, string | number>>;
  try {
    raw = await readRows({ p_chain_id: ACTIVE_CHAIN_ID, p_pool_address: oldPool, p_match_pool_address: matchPool });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "PGRST202")) throw error;
    const pools = oldPool === matchPool ? [oldPool] : [oldPool, matchPool];
    const perPool = await Promise.all(pools.map((pool) => readRows({ p_chain_id: ACTIVE_CHAIN_ID, p_pool_address: pool })));
    const merged = new Map<string, Record<string, string | number>>();
    for (const rows of perPool) for (const row of rows) {
      const wallet = String(row.wallet_address).toLowerCase();
      const existing = merged.get(wallet);
      const metrics = ["points", "correct", "predictions", "stake_bonus", "conviction_bonus", "x_bonus"] as const;
      const next = existing ?? { ...row };
      if (existing) for (const metric of metrics) next[metric] = Number(existing[metric]) + (metric === "predictions" && Number(row.points) === 0 ? 0 : Number(row[metric]));
      // The original SQL counted a null left-join row as one prediction.
      if (!existing && Number(next.points) === 0) next.predictions = 0;
      merged.set(wallet, next);
    }
    raw = [...merged.values()].sort((a, b) => Number(b.points) - Number(a.points) || Number(b.correct) - Number(a.correct) || Number(b.predictions) - Number(a.predictions) || String(a.wallet_address).localeCompare(String(b.wallet_address)));
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

/** Owner-only predictor rank. No public list or other wallets are returned. */
import { dbOr503 } from "../_shared";
import { requireLinkedWallet } from "@/lib/privyServer";
import { currentSeasonId } from "@/lib/seasonServer";
import { ACTIVE_CHAIN_ID } from "@/lib/contracts";
import { calculatePredictorRanks, type RankStake } from "@/lib/predictorRank";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const wallet = (new URL(req.url).searchParams.get("walletAddress") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return Response.json({ error: "invalid_wallet" }, { status: 400 });
  const auth = await requireLinkedWallet(req, wallet);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const r = dbOr503();
  if ("response" in r) return r.response;
  const season = await currentSeasonId();
  const stakes: RankStake[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await r.db.from("stakes")
      .select("staker,market_id,outcome,markets!inner(state,winner_bitmap)")
      .eq("chain_id", ACTIVE_CHAIN_ID).eq("season_id", season)
      .eq("markets.state", "resolved")
      .order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) {
      console.error("[social] private rank query failed:", error.message);
      return Response.json({ error: "query_failed" }, { status: 500 });
    }
    const rows = (data ?? []) as unknown as RankStake[];
    stakes.push(...rows);
    if (rows.length < pageSize) break;
  }
  const scores = calculatePredictorRanks(stakes);
  const own = scores.find((score) => score.wallet === wallet);
  return Response.json({ season, rank: own?.rank ?? null, participants: scores.length, points: own?.points ?? 0,
    correct: own?.correct ?? 0, settled: own?.settled ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}

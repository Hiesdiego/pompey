/**
 * GET /api/social/analytics?walletAddress=0x…&season=1 — Privy-authenticated.
 * Owner-only by construction: the wallet must be linked to the caller's
 * Privy user. Aggregates the user's stakes into PnL curve, per-template
 * win rates, calibration buckets and headline tiles.
 */

import { dbOr503 } from "../_shared";
import { requireLinkedWallet } from "@/lib/privyServer";
import { currentSeasonId } from "@/lib/seasonServer";
import { ACTIVE_CHAIN_ID } from "@/lib/contracts";

export const dynamic = "force-dynamic"; // private: never cache authed responses
export const runtime = "nodejs";

interface StakeRow {
  market_id: number | string;
  template_id: number;
  amount_tick: string;
  odds_bps: number | null;
  pnl_tick: string | null;
  won: boolean | null;
  block_timestamp: string;
}

export async function GET(req: Request) {
  const r = dbOr503();
  if ("response" in r) return r.response;

  const sp = new URL(req.url).searchParams;
  const walletAddress = (sp.get("walletAddress") ?? "").toLowerCase();
  if (!walletAddress) return Response.json({ error: "wallet_required" }, { status: 400 });

  const auth = await requireLinkedWallet(req, walletAddress);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const season = Number(sp.get("season")) || (await currentSeasonId());

  const { data, error } = await r.db
    .from("stakes")
    .select("market_id, template_id, amount_tick, odds_bps, pnl_tick, won, block_timestamp")
    .eq("chain_id", ACTIVE_CHAIN_ID)
    .eq("staker", walletAddress)
    .eq("season_id", season)
    .order("block_timestamp", { ascending: true })
    .limit(5000);
  if (error) {
    console.error("[social] analytics query failed:", error.message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
  const stakes = (data ?? []) as StakeRow[];

  const settled = stakes.filter((s) => s.won !== null);

  // PnL curve (cumulative, chronological).
  let cum = 0n;
  const pnlCurve = stakes
    .filter((s) => s.pnl_tick !== null)
    .map((s) => {
      cum += BigInt(s.pnl_tick ?? "0");
      return { t: s.block_timestamp, cumPnlTick: cum.toString() };
    });

  // Win rate by template.
  const byTemplate = new Map<number, { wins: number; settled: number }>();
  for (const s of settled) {
    let t = byTemplate.get(s.template_id);
    if (!t) {
      t = { wins: 0, settled: 0 };
      byTemplate.set(s.template_id, t);
    }
    t.settled += 1;
    if (s.won) t.wins += 1;
  }

  // Calibration: decile buckets of odds at stake time vs actual win rate.
  const buckets = new Map<number, { oddsSum: number; wins: number; n: number }>();
  for (const s of settled) {
    if (s.odds_bps === null) continue;
    const bucket = Math.floor(s.odds_bps / 1000) * 1000;
    let b = buckets.get(bucket);
    if (!b) {
      b = { oddsSum: 0, wins: 0, n: 0 };
      buckets.set(bucket, b);
    }
    b.oddsSum += s.odds_bps;
    b.wins += s.won ? 1 : 0;
    b.n += 1;
  }

  const pnls = settled.map((s) => BigInt(s.pnl_tick ?? "0"));
  const volume = stakes.reduce((sum, s) => sum + BigInt(s.amount_tick || "0"), 0n);
  const odds = stakes.map((s) => s.odds_bps).filter((o): o is number => o !== null);

  const { data: stats } = await r.db
    .from("user_season_stats")
    .select("current_streak, best_streak")
    .eq("wallet_address", walletAddress)
    .eq("season_id", season)
    .maybeSingle();

  const settledMarkets = new Set(settled.map((s) => String(s.market_id)));

  return Response.json({
    pnlCurve,
    winRateByTemplate: [...byTemplate.entries()].map(([templateId, t]) => ({
      templateId,
      wins: t.wins,
      settled: t.settled,
    })),
    calibration: [...buckets.entries()].map(([bucketBps, b]) => ({
      bucketBps,
      predictedBps: Math.round(b.oddsSum / b.n),
      actualBps: Math.round((b.wins / b.n) * 10000),
      n: b.n,
    })),
    currentStreak: stats?.current_streak ?? 0,
    bestStreak: stats?.best_streak ?? 0,
    bestWinTick: pnls.length ? pnls.reduce((best, value) => value > best ? value : best).toString() : "0",
    worstLossTick: pnls.length ? pnls.reduce((worst, value) => value < worst ? value : worst).toString() : "0",
    volumeTick: volume.toString(),
    avgOddsBps: odds.length ? Math.round(odds.reduce((a, b) => a + b, 0) / odds.length) : null,
    settled: settledMarkets.size,
  });
}

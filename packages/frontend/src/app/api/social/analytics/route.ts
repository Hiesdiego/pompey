/** Owner-only analytics calculated per market from indexed on-chain settlements. */
import { dbOr503 } from "../_shared";
import { requireLinkedWallet } from "@/lib/privyServer";
import { currentSeasonId } from "@/lib/seasonServer";
import { ACTIVE_CHAIN_ID } from "@/lib/contracts";
import { calculateMarketResults, type IndexedStake } from "@/lib/profileMetrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const r = dbOr503();
  if ("response" in r) return r.response;
  const sp = new URL(req.url).searchParams;
  const wallet = (sp.get("walletAddress") ?? "").toLowerCase();
  if (!wallet) return Response.json({ error: "wallet_required" }, { status: 400 });
  const auth = await requireLinkedWallet(req, wallet);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const season = Number(sp.get("season")) || (await currentSeasonId());

  const stakes: IndexedStake[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await r.db.from("stakes")
      .select("market_id,template_id,outcome,amount_tick,markets!inner(state,winner_bitmap,payout_per_share,resolved_at)")
      .eq("chain_id", ACTIVE_CHAIN_ID)
      .eq("staker", wallet)
      .eq("season_id", season)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error("[social] analytics query failed:", error.message);
      return Response.json({ error: "query_failed" }, { status: 500 });
    }
    const rows = (data ?? []) as unknown as IndexedStake[];
    stakes.push(...rows);
    if (rows.length < pageSize) break;
  }

  const results = calculateMarketResults(stakes);
  const resolved = results.filter((m) => m.state === "resolved" && m.netTick !== null);
  const incompleteSettlements = results.filter((m) => m.state === "resolved" && m.netTick === null).length;
  const byTemplate = new Map<number, { profitable: number; resolved: number }>();
  for (const market of resolved) {
    const row = byTemplate.get(market.templateId) ?? { profitable: 0, resolved: 0 };
    row.resolved++;
    if (market.netTick! > 0n) row.profitable++;
    byTemplate.set(market.templateId, row);
  }
  const chronological = resolved.filter((m) => m.resolvedAt && Number.isFinite(Date.parse(m.resolvedAt)))
    .sort((a, b) => Date.parse(a.resolvedAt!) - Date.parse(b.resolvedAt!) || (BigInt(a.marketId) < BigInt(b.marketId) ? -1 : BigInt(a.marketId) > BigInt(b.marketId) ? 1 : 0));
  let cumulative = 0n;
  const pnlCurve = chronological.map((market) => {
    cumulative += market.netTick!;
    return { t: market.resolvedAt!, cumPnlTick: cumulative.toString() };
  });
  const net = resolved.reduce((sum, m) => sum + m.netTick!, 0n);
  const totalStaked = results.reduce((sum, m) => sum + m.stakeTick, 0n);
  const resolvedStaked = resolved.reduce((sum, m) => sum + m.stakeTick, 0n);
  const openStaked = results.filter((m) => m.state === "open").reduce((sum, m) => sum + m.stakeTick, 0n);
  const profits = resolved.map((m) => m.netTick!);
  return Response.json({
    netPnlTick: net.toString(),
    volumeTick: totalStaked.toString(),
    resolvedStakeTick: resolvedStaked.toString(),
    openStakeTick: openStaked.toString(),
    resolvedMarkets: resolved.length,
    profitableMarkets: resolved.filter((m) => m.netTick! > 0n).length,
    incompleteSettlements,
    undatedSettlements: resolved.length - chronological.length,
    bestMarketTick: profits.length ? profits.reduce((best, p) => p > best ? p : best).toString() : null,
    worstMarketTick: profits.length ? profits.reduce((worst, p) => p < worst ? p : worst).toString() : null,
    pnlCurve,
    byTemplate: [...byTemplate.entries()].map(([templateId, row]) => ({ templateId, ...row })),
    recentResults: [...chronological].reverse().slice(0, 8).map((m) => ({
      marketId: m.marketId,
      templateId: m.templateId,
      stakeTick: m.stakeTick.toString(),
      netTick: m.netTick!.toString(),
      resolvedAt: m.resolvedAt!,
    })),
  });
}

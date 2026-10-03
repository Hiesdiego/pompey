/**
 * GET /api/social/profiles/[username]/predictions?status=all|open|settled&limit=&cursor=
 * Public. Paginated stakes for a user, newest first, with the market's live
 * state, params and creator name embedded via the stakes→markets FK.
 */

import { dbOr503 } from "../../../_shared";
import { ACTIVE_CHAIN_ID } from "@/lib/contracts";

export const revalidate = 60;
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const r = dbOr503();
  if ("response" in r) return r.response;

  const raw = decodeURIComponent((await params).username);
  const username = (raw.startsWith("@") ? raw.slice(1) : raw).toLowerCase();

  const { data: hit } = await r.db
    .from("profiles")
    .select("wallet_address")
    .eq("username", username)
    .maybeSingle();
  if (!hit) return Response.json({ error: "not_found" }, { status: 404 });
  const wallet = (hit as { wallet_address: string }).wallet_address;

  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") ?? "all";
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 25));
  const cursor = sp.get("cursor");

  let q = r.db
    .from("stakes")
    .select(
      "id, market_id, outcome, amount_tick, odds_bps, pnl_tick, won, block_timestamp, template_id, markets!inner(state, params, creator_name)"
    )
    .eq("chain_id", ACTIVE_CHAIN_ID)
    .eq("staker", wallet)
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.lt("id", Number(cursor));
  if (status === "open") q = q.eq("markets.state", "open");
  else if (status === "settled") q = q.in("markets.state", ["resolved", "voided"]);

  const { data, error } = await q;
  if (error) {
    console.error("[social] predictions query failed:", error.message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Array<{
    id: number;
    market_id: number | string;
    outcome: number;
    amount_tick: string;
    odds_bps: number | null;
    pnl_tick: string | null;
    won: boolean | null;
    block_timestamp: string;
    template_id: number;
    markets: { state: string; params: string; creator_name: string };
  }>;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return Response.json({
    items: page.map((s) => ({
      stakeId: s.id,
      marketId: Number(s.market_id),
      templateId: s.template_id,
      params: s.markets.params,
      outcome: s.outcome,
      amountTick: String(s.amount_tick),
      oddsBps: s.odds_bps,
      status: s.markets.state,
      won: s.won,
      pnlTick: s.pnl_tick === null ? null : String(s.pnl_tick),
      stakedAt: s.block_timestamp,
      creatorName: s.markets.creator_name,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}

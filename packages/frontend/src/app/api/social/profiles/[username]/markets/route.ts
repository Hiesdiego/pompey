/**
 * GET /api/social/profiles/[username]/markets?status=all|open|settled&limit=&cursor=
 * Public. Paginated markets created by a user, newest first. Pool depth and
 * bettor counts are aggregated from the stakes table in one extra query.
 */

import { dbOr503 } from "../../../_shared";
import { ACTIVE_CHAIN_ID } from "@/lib/contracts";
import { currentSeasonId } from "@/lib/seasonServer";
import { integerString } from "@/lib/integerString";

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
  const season = await currentSeasonId();

  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") ?? "all";
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 25));
  const cursor = sp.get("cursor");

  let q = r.db
    .from("markets")
    .select(
      "market_id, template_id, params, creator_name, state, betting_close_time, end_time"
    )
    .eq("chain_id", ACTIVE_CHAIN_ID)
    .eq("season_id", season)
    .eq("creator", wallet)
    .order("market_id", { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.lt("market_id", Number(cursor));
  if (status === "open") q = q.eq("state", "open");
  else if (status === "settled") q = q.in("state", ["resolved", "voided"]);

  const { data, error } = await q;
  if (error) {
    console.error("[social] markets query failed:", error.message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    market_id: number | string;
    template_id: number;
    params: string;
    creator_name: string;
    state: string;
    betting_close_time: string;
    end_time: string;
  }>;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const ids = page.map((m) => Number(m.market_id));

  // Aggregate in Postgres instead of transferring every stake row to Node.
  const totals = new Map<number, { staked: string; bettors: number }>();
  if (ids.length > 0) {
    const { data: aggregateRows, error: aggregateError } = await r.db.rpc(
      "social_market_stake_totals",
      { p_chain_id: ACTIVE_CHAIN_ID, p_market_ids: ids.map(String) }
    );
    if (aggregateError) {
      console.error("[social] market stake aggregation failed:", aggregateError.message);
      return Response.json({ error: "query_failed" }, { status: 500 });
    }
    for (const s of (aggregateRows ?? []) as Array<{
      market_id: number | string;
      total_staked_tick: string | number;
      bettors: number | string;
    }>) {
      const id = Number(s.market_id);
      totals.set(id, {
        staked: integerString(s.total_staked_tick) ?? "0",
        bettors: Number(s.bettors) || 0,
      });
    }
  }

  return Response.json({
    items: page.map((m) => {
      const id = Number(m.market_id);
      const t = totals.get(id);
      return {
        marketId: id,
        templateId: m.template_id,
        params: m.params,
        creatorName: m.creator_name,
        state: m.state,
        totalStakedTick: String(t?.staked ?? "0"),
        bettors: t?.bettors ?? 0,
        bettingCloseTime: m.betting_close_time,
        endTime: m.end_time,
      };
    }),
    nextCursor: hasMore ? page[page.length - 1].market_id : null,
  });
}

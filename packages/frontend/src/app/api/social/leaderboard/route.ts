/**
 * GET /api/social/leaderboard?metric=points|created|correct|resolved&season=&limit=
 * Public prediction points leaderboard. Financial performance is private.
 *
 * Scores: 10 points per market created, 3 per correct prediction, 5 per
 * resolved market. Counts are derived from indexed market/stake records.
 */

import { dbOr503 } from "../_shared";
import { currentSeasonId } from "@/lib/seasonServer";

export const revalidate = 30;
export const runtime = "nodejs";

const METRICS = ["points", "created", "correct", "resolved"] as const;
type Metric = (typeof METRICS)[number];

interface StatsRow {
  walletAddress: string;
  created: number;
  correct: number;
  resolved: number;
}

export async function GET(req: Request) {
  const r = dbOr503();
  if ("response" in r) return r.response;

  const sp = new URL(req.url).searchParams;
  const metric = (sp.get("metric") ?? "points") as Metric;
  if (!METRICS.includes(metric)) {
    return Response.json({ error: "invalid_metric" }, { status: 400 });
  }
  const season = Number(sp.get("season")) || (await currentSeasonId());
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 50));

  const [markets, stakes] = await Promise.all([
    r.db.from("markets").select("creator,state").eq("season_id", season),
    r.db.from("stakes").select("staker,won").eq("season_id", season).eq("won", true),
  ]);
  if (markets.error || stakes.error) {
    console.error("[social] leaderboard query failed:", markets.error?.message ?? stakes.error?.message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
  const byWallet = new Map<string, StatsRow>();
  const getRow = (walletAddress: string) => {
    let row = byWallet.get(walletAddress);
    if (!row) { row = { walletAddress, created: 0, correct: 0, resolved: 0 }; byWallet.set(walletAddress, row); }
    return row;
  };
  for (const m of markets.data ?? []) {
    const row = getRow(String(m.creator)); row.created++;
    if (m.state === "resolved") row.resolved++;
  }
  for (const s of stakes.data ?? []) getRow(String(s.staker)).correct++;
  const points = (x: StatsRow) => x.created * 10 + x.correct * 3 + x.resolved * 5;
  const page = [...byWallet.values()].sort((a, b) => {
    const av = metric === "points" ? points(a) : metric === "created" ? a.created : metric === "correct" ? a.correct : a.resolved;
    const bv = metric === "points" ? points(b) : metric === "created" ? b.created : metric === "correct" ? b.correct : b.resolved;
    return bv - av || points(b) - points(a);
  }).slice(0, limit);

  // Left-join profiles for username + favourite team.
  const profileMap = new Map<string, { username: string | null; favouriteTeamId: number | null }>();
  if (page.length > 0) {
    const { data: profs } = await r.db
      .from("profiles")
      .select("wallet_address, username, favourite_team_id")
      .in(
        "wallet_address",
        page.map((x) => x.walletAddress)
      );
    for (const p of (profs ?? []) as Array<{
      wallet_address: string;
      username: string;
      favourite_team_id: number;
    }>) {
      profileMap.set(p.wallet_address, {
        username: p.username,
        favouriteTeamId: p.favourite_team_id,
      });
    }
  }

  return Response.json({
    metric,
    season,
    rows: page.map((x, i) => {
      const prof = profileMap.get(x.walletAddress);
      return {
        rank: i + 1,
        walletAddress: x.walletAddress,
        username: prof?.username ?? null,
        favouriteTeamId: prof?.favouriteTeamId ?? null,
        value: String(
          metric === "points"
            ? points(x)
            : metric === "created"
              ? x.created * 10
              : metric === "correct"
                ? x.correct * 3
                : x.resolved * 5
        ),
        points: points(x),
        created: x.created,
        correct: x.correct,
        resolved: x.resolved,
      };
    }),
  });
}

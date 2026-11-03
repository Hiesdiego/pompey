import { getCupLeaderboard } from "@/lib/cupLeaderboardServer";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await getCupLeaderboard();
    return Response.json({ rows: rows.slice(0, 10), totalUsers: rows.length }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
  } catch (error) {
    console.error("[cup leaderboard]", error);
    return Response.json({ error: "leaderboard_unavailable" }, { status: 503 });
  }
}

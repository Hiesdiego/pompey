import { ImageResponse } from "next/og";
import { Card, Brand, Coins } from "../../_design";
import { cupMatch, cupLogos } from "../../_cup";
import { OG_WIDTH, OG_HEIGHT, OG_FINAL_CACHE, OG_LIVE_CACHE, siteUrl } from "../../_shared";
import { CUP_STATE, CUP_ROUNDS, CUP_TEAM_SYMBOLS, CUP_TBD, cupRoundOf, cupTeamName } from "@/lib/cup";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^(0|[1-9]\d?)$/.test(id) || Number(id) > 62) return new Response("Match not found", { status: 404 });
  const match = await cupMatch(id);
  const settled = match?.state === CUP_STATE.Settled;
  const teams = match ? [match.teamA, match.teamB] : [];
  const knownTeams = teams.filter(team => team !== CUP_TBD);
  const logos = await cupLogos(knownTeams);
  const coins = teams.map(team => ({ symbol: CUP_TEAM_SYMBOLS[team] ?? "TBA", detail: team === CUP_TBD ? "Team to be decided" : cupTeamName(team), logo: team === CUP_TBD ? null : logos[knownTeams.indexOf(team)] }));
  const card = new ImageResponse(<Card gold>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><Brand gold /><span style={{ fontSize: 21, color: "#f5d58a" }}>CRYPTO PRICE WORLD CUP</span></div>
    <div style={{ display: "flex", flexDirection: "column", gap: 28, alignItems: "center" }}>
      <span style={{ color: "#f5d58a", fontSize: 20, letterSpacing: 3 }}>{CUP_ROUNDS[cupRoundOf(Number(id))].name.toUpperCase()} · {settled ? "FULL TIME" : "MATCH"}</span>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 60 }}>
        <Coins gold coins={coins.slice(0, 1)} />
        <span style={{ fontSize: 80, color: "#ffe3a3", fontWeight: 900 }}>{settled ? `${match.goalsA}–${match.goalsB}` : "VS"}</span>
        <Coins gold coins={coins.slice(1)} />
      </div>
      <span style={{ fontSize: 26, color: "#ffe3a3" }}>{settled ? `${cupTeamName(match.winner)} wins` : match ? "Back your team. Climb the table." : "Match details coming soon"}</span>
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #715a30", paddingTop: 18, fontSize: 18, color: "#d7bf8e" }}><span>64 coins. One champion.</span><span>{siteUrl().replace(/^https?:\/\//, "")}</span></div>
  </Card>, { width: OG_WIDTH, height: OG_HEIGHT, headers: { "Cache-Control": settled && coins.length === 2 && coins.every(coin => coin.logo) ? OG_FINAL_CACHE : OG_LIVE_CACHE } });
  return new Response(await card.arrayBuffer(), { headers: card.headers });
}

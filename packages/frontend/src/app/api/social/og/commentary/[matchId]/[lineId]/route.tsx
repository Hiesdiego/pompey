import { ImageResponse } from "next/og";
import { getCommentaryShare } from "@/lib/commentaryShareServer";
import { cupTeamName, CUP_TEAM_SYMBOLS } from "@/lib/cup";
import { cupLogos } from "../../../_cup";
import { Card } from "../../../_design";
import { tickrWordmark } from "../../../_wordmark";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ matchId: string; lineId: string }> }) {
  const { matchId, lineId } = await params;
  try {
    const data = await getCommentaryShare(matchId, lineId);
    if (!data) return new Response("Commentary not found", { status: 404 });
    const { match, line, speaker, score } = data;
    const teams = [match.teamA, match.teamB];
    const logos = await cupLogos(teams);
    const accent = line.voice === "professional" ? "#93c5fd" : "#c4b5fd";
    const card = new ImageResponse(<Card gold>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <img src={tickrWordmark} width={112} height={59} alt="TICKR" />
        <span style={{ fontSize: 16, letterSpacing: 4, color: "#f5d58a" }}>WORLD CUP / FROM THE BOOTH</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 28px", background: "#ffffff08", border: "1px solid #a8813866", borderRadius: 22 }}>
        {teams.map((team, index) => <div key={team} style={{ display: "flex", alignItems: "center", gap: 16, width: 380, justifyContent: "flex-start", flexDirection: index ? "row-reverse" : "row" }}>
          {logos[index] ? <img src={logos[index]!} width={64} height={64} style={{ borderRadius: 32 }} alt="" /> : <span style={{ display: "flex", width: 64, height: 64, alignItems: "center", justifyContent: "center", borderRadius: 32, background: "#73501b", fontSize: 18 }}>{CUP_TEAM_SYMBOLS[team]}</span>}
          <span style={{ fontSize: 27, fontWeight: 700 }}>{cupTeamName(team)}</span>
        </div>)}
        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", width: 220, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 46, fontWeight: 800, color: "#ffe3a3" }}>{score}</span>
          <span style={{ fontSize: 11, letterSpacing: 2, color: "#d7bf8e" }}>{line.eventType === "preview" ? "PRE-MATCH" : line.eventType === "review" || line.eventType === "ft" ? "FULL TIME" : `AT ${line.minute}′ · PROJECTED`}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 16, letterSpacing: 2 }}><span style={{ color: accent, fontWeight: 800 }}>{speaker}</span><span style={{ color: "#a1a1aa", fontSize: 12 }}>{line.voice === "professional" ? "LEAD COMMENTATOR" : "COLOUR COMMENTATOR"} / {line.minute}′</span></div>
        <div style={{ display: "flex", fontSize: line.text.length > 480 ? 17 : line.text.length > 320 ? 21 : line.text.length > 220 ? 27 : line.text.length > 150 ? 31 : 38, lineHeight: 1.35, fontWeight: 600, color: "#fff8eb" }}>“{line.text}”</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #715a30", paddingTop: 18, color: "#d7bf8e", fontSize: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="#f5d58a"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.4-8.5L.8 2h6.5l4.5 6.8L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z" /></svg><span>@tickrbase</span><span style={{ color: "#998c74", fontSize: 14 }}>FOLLOW THE MATCH. JOIN THE CONVERSATION.</span></div>
        <span>tickrbase.top</span>
      </div>
    </Card>, { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=300, s-maxage=86400", "Content-Disposition": `inline; filename="tickr-commentary-${matchId}-${line.minute}.png"` } });
    return new Response(await card.arrayBuffer(), { headers: card.headers });
  } catch {
    return new Response("Could not create the card. Please try again.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

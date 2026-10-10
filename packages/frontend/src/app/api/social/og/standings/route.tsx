import { ImageResponse } from "next/og";
import { TICKR_TEAMS } from "@tickr/shared/teams";
import { backendUrl, logoDataUrl, OG_HEIGHT, OG_WIDTH, siteUrl } from "../_shared";

export const runtime = "nodejs";

interface TableRow {
  teamId: number;
  name: string;
  symbol: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  goalDifference: number;
}

async function getRows(): Promise<TableRow[]> {
  try {
    const response = await fetch(`${backendUrl()}/api/table`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as TableRow[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const rows = (await getRows())
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.won - a.won || a.lost - b.lost)
    .slice(0, 8);
  const logos = await Promise.all(rows.map((row) => {
    const team = TICKR_TEAMS.find((candidate) => candidate.teamId === row.teamId);
    return logoDataUrl(team?.cmcId);
  }));

  return new ImageResponse(
    (
      <div
        style={{
          width: OG_WIDTH,
          height: OG_HEIGHT,
          display: "flex",
          flexDirection: "column",
          padding: "34px 52px",
          background: "radial-gradient(ellipse at 100% 0%, #062b3a 0%, #05090f 42%, #020307 100%)",
          color: "#f4f4f5",
          fontFamily: "system-ui, sans-serif",
          border: "1px solid #17404d",
          borderRadius: 28,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 20, fontWeight: 700, letterSpacing: 4, color: "#22d3ee" }}>
              <span style={{ fontSize: 32, color: "#fff" }}>↑</span>TICKR
            </div>
            <div style={{ fontSize: 13, letterSpacing: 4, color: "#94a3b8" }}>THE CRYPTO FANTASY LEAGUE</div>
          </div>
          <div style={{ display: "flex", padding: "10px 16px", border: "1px solid #155e75", borderRadius: 999, color: "#67e8f9", fontSize: 15, letterSpacing: 2 }}>LIVE LEAGUE TABLE</div>
        </div>
        <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1 }}>TOP 8</div>
          <div style={{ display: "flex", width: 520, justifyContent: "space-between", color: "#64748b", fontSize: 13, letterSpacing: 2, paddingRight: 12 }}><span>P</span><span>W</span><span>D</span><span>L</span><span>GD</span><span>PTS</span></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
          {rows.length ? rows.map((row, index) => (
            <div key={row.teamId} style={{ display: "flex", alignItems: "center", height: 42, padding: "0 12px", borderRadius: 11, background: index === 0 ? "linear-gradient(90deg, rgba(14,116,144,.34), rgba(15,23,42,.72))" : "rgba(15,23,42,.68)", border: index === 0 ? "1px solid rgba(34,211,238,.4)" : "1px solid rgba(51,65,85,.56)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, width: 510 }}>
                <div style={{ display: "flex", width: 28, color: index < 3 ? "#67e8f9" : "#94a3b8", fontSize: 17, fontWeight: 800 }}>{String(index + 1).padStart(2, "0")}</div>
                {logos[index] ? <img src={logos[index]!} width={30} height={30} style={{ borderRadius: 999, background: "#fff" }} /> : <div style={{ display: "flex", width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 999, background: "#13294f", color: "#67e8f9", fontSize: 13, fontWeight: 800 }}>{row.symbol.slice(0, 1)}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 700 }}>{row.name}<span style={{ color: "#64748b", fontSize: 14, fontWeight: 500 }}>{row.symbol}</span></div>
              </div>
              <div style={{ display: "flex", width: 520, justifyContent: "space-between", paddingRight: 12, fontSize: 17, color: "#cbd5e1" }}>
                <span>{row.played}</span><span>{row.won}</span><span>{row.drawn}</span><span>{row.lost}</span><span style={{ color: row.goalDifference > 0 ? "#7fe0bd" : "#cbd5e1" }}>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</span><span style={{ width: 42, textAlign: "right", color: "#22d3ee", fontWeight: 900 }}>{row.points}</span>
              </div>
            </div>
          )) : <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 24 }}>League table is temporarily unavailable</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #18343b", paddingTop: 11, marginTop: 8, color: "#8ca3ad", fontSize: 15 }}><span>Pick your lineup. Back your team.</span><span>{siteUrl().replace(/^https?:\/\//, "")}/standings</span></div>
      </div>
    ),
    { width: OG_WIDTH, height: OG_HEIGHT, headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" } }
  );
}

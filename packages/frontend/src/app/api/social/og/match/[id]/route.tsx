import { Card, Brand } from "../../_design";


import { ImageResponse } from "next/og";
import { leagueScore } from "../../_league";
import { SEASON_ID } from "@/lib/contracts";
import { TICKR_TEAMS } from "@tickr/shared/teams";
import {
  stockLogoCandidates,
  stockDisplaySymbol,
  type StockListItem,
} from "@/lib/stockMarketContracts";
import {
  OG_WIDTH,
  OG_HEIGHT,
  OG_COLORS,
  OG_LIVE_CACHE,
  OG_FINAL_CACHE,
  ogBaseUrl,
  backendUrl,
  logoDataUrl,
  formatTickShort,
  isNumericId,
} from "../../_shared";


export const runtime = "nodejs";

interface FixtureDto {
  fixtureId: string;
  seasonId?: string;
  home: { teamId: number; name: string; symbol: string } | null;
  away: { teamId: number; name: string; symbol: string } | null;
  matchdayIndex: number;
  kickoff: string | null;
  kickoffRevealed: boolean;
  settled: boolean;
}

interface PoolDto {
  seasonId?: string;
  totalHome: string;
  totalDraw: string;
  totalAway: string;
  seed: string;
  settled: boolean;
  winningOutcome: number | null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 30 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const fallbackTitle = new URL(req.url).searchParams.get("title") || "TICKR match";
    const league = new URL(req.url).searchParams.get("league");
    const response = league === "stocks"
      ? await renderStockMatchCard(await params, fallbackTitle)
      : await renderMatchCard(await params, fallbackTitle);
    if (!(response instanceof ImageResponse)) return response;
    return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
  } catch (error) {
    console.error("Match OG image failed", error);
    const fallback = await fallbackMatchCard(new URL(req.url).searchParams.get("title") || "TICKR match");
    return new Response(await fallback.arrayBuffer(), { status: fallback.status, headers: fallback.headers });
  }
}

interface StockFixtureDto {
  fixtureId: string;
  home: { name: string; symbol: string } | null;
  away: { name: string; symbol: string } | null;
  matchdayIndex: number;
  kickoff: string | null;
  settled: boolean;
  voided?: boolean;
  homeGoals?: number | null;
  awayGoals?: number | null;
}

interface StockPoolDto {
  totalHome: string;
  totalDraw: string;
  totalAway: string;
  seed: string;
}

// Stock team logos for the stock match card, copied from the stock
// market OG route (../market/[id]/route.tsx), which is the established
// pattern for stock artwork: the iconUrl for a stock lives on the
// backend stock list (StockListItem.iconUrl), matched by display
// symbol, and the icon bytes are converted with a byte-sniffing fetch
// because metadata.coinbase.com serves its equity icon PNGs as
// binary/octet-stream, so a content-type gate would reject every real
// logo. When no candidate yields drawable bytes the logo is null and
// TeamBlock renders the symbol initial, the same fallback it gives a
// crypto team when logoDataUrl returns null.
async function stockIconUrl(symbol: string): Promise<string | null> {
  try {
    const res = await fetch(`${backendUrl()}/api/stocks/list`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { stocks?: StockListItem[] } | StockListItem[];
    const list = Array.isArray(data) ? data : data.stocks ?? [];
    const display = stockDisplaySymbol(symbol);
    const match = list.find((item) => item?.symbol && stockDisplaySymbol(item.symbol) === display);
    return match?.iconUrl ?? null;
  } catch {
    return null;
  }
}

const STOCK_LOGO_HOSTS = ["icons.duckduckgo.com", "cdn.simpleicons.org", "metadata.coinbase.com"];
const STOCK_LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/gif", "image/webp"];

async function stockImageDataUrl(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !STOCK_LOGO_HOSTS.includes(parsed.hostname)) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > 200_000) return null;
    const bytes = new Uint8Array(buf);
    // The content-type header cannot be trusted on the stock logo
    // hosts: metadata.coinbase.com serves its equity icon PNGs as
    // binary/octet-stream, so a header-only gate rejects every real
    // logo and the card falls back to symbol text. Trust the header
    // when it names a drawable image type; otherwise sniff the
    // actual bytes (magic numbers, and the svg open tag) and use
    // the sniffed type for the data URL.
    const headerType = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    let contentType = headerType && STOCK_LOGO_CONTENT_TYPES.includes(headerType) ? headerType : null;
    if (!contentType) {
      if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) contentType = "image/png";
      else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) contentType = "image/jpeg";
      else if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) contentType = "image/gif";
      else if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) contentType = "image/webp";
      else {
        const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 256)).replace(/^\uFEFF/, "").trimStart().toLowerCase();
        if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) contentType = "image/svg+xml";
      }
    }
    if (!contentType) return null;
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

async function stockLogoDataUrl(symbol: string, iconUrl: string | null): Promise<string | null> {
  for (const candidate of stockLogoCandidates(symbol, iconUrl)) {
    const data = await stockImageDataUrl(candidate);
    if (data) return data;
  }
  return null;
}

async function renderStockMatchCard({ id }: { id: string }, fallbackTitle: string) {
  if (!isNumericId(id)) return new Response("Match not found", { status: 404 });
  const base = backendUrl();
  const [fixture, pool] = await Promise.all([
    fetchJson<StockFixtureDto>(`${base}/api/stocks/fixtures/${id}`),
    fetchJson<StockPoolDto>(`${base}/api/stocks/fixtures/${id}/pool`),
  ]);
  if (!fixture?.home || !fixture?.away) return await fallbackMatchCard(fallbackTitle);

  const [homeIconUrl, awayIconUrl] = await Promise.all([
    stockIconUrl(fixture.home.symbol),
    stockIconUrl(fixture.away.symbol),
  ]);
  const [homeLogo, awayLogo] = await Promise.all([
    stockLogoDataUrl(fixture.home.symbol, homeIconUrl),
    stockLogoDataUrl(fixture.away.symbol, awayIconUrl),
  ]);

  const settled = fixture.settled;
  const score = fixture.homeGoals != null && fixture.awayGoals != null
    ? [fixture.homeGoals, fixture.awayGoals] as const
    : null;
  const winner = score ? score[0] > score[1] ? 0 : score[1] > score[0] ? 2 : 1 : null;
  const totalPool = BigInt(pool?.totalHome ?? "0") + BigInt(pool?.totalDraw ?? "0") + BigInt(pool?.totalAway ?? "0") + BigInt(pool?.seed ?? "0");
  const kickoffLabel = fixture.kickoff ? new Date(fixture.kickoff).toUTCString().slice(0, 22) : "TBA";
  const c = OG_COLORS;

  return new ImageResponse(
    (
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand league="stocks" />
          <div style={{ fontSize: 24, fontWeight: 700, color: settled ? c.greenLight : c.amber, background: settled ? "rgba(29,158,117,.15)" : "rgba(245,158,11,.15)", padding: "10px 24px", borderRadius: 999 }}>
            {settled ? "FULL TIME" : `MATCHDAY ${fixture.matchdayIndex + 1}`}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 48 }}>
          <TeamBlock name={fixture.home.name} symbol={fixture.home.symbol} logo={homeLogo} highlight={winner === 0} dim={winner !== null && winner !== 0} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            {score ? <div style={{ fontSize: 96, fontWeight: 900, letterSpacing: 4 }}>{score[0]}–{score[1]}</div> : <div style={{ fontSize: 64, fontWeight: 800, color: c.zinc400 }}>{settled ? "FT" : "VS"}</div>}
            {settled && <div style={{ fontSize: 21, color: c.greenLight }}>{winner === 0 ? `${fixture.home.symbol} wins` : winner === 2 ? `${fixture.away.symbol} wins` : winner === 1 ? "Draw" : fixture.voided ? "Voided · stakes refunded" : "Result pending"}</div>}
            {!settled && <div style={{ fontSize: 22, color: c.zinc400 }}>{kickoffLabel}</div>}
          </div>
          <TeamBlock name={fixture.away.name} symbol={fixture.away.symbol} logo={awayLogo} highlight={winner === 2} dim={winner !== null && winner !== 2} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 26, color: c.zinc400 }}>{settled ? <>Full-time score: <span style={{ color: c.greenLight, fontWeight: 800 }}>{score ? `${score[0]}–${score[1]}` : fixture.voided ? "VOID" : "FT"}</span></> : <>Pool: <span style={{ color: c.white, fontWeight: 800 }}>{formatTickShort(totalPool)} TICK</span></>}</div>
          <div style={{ fontSize: 22, color: c.zinc500 }}>{ogBaseUrl().replace(/^https?:\/\//, "")}/stocks/match/{id}</div>
        </div>
      </Card>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      headers: { "Cache-Control": settled ? OG_FINAL_CACHE : OG_LIVE_CACHE },
    }
  );
}


async function fallbackMatchCard(title: string): Promise<ImageResponse> {
  const c = OG_COLORS;
  const final = title.match(/^(.+?)\s+(-?\d+)[–-](-?\d+)\s+(.+)$/);
  const finalPending = title.match(/^(.+?)\s+FT\s+(.+)$/);
  const [homeName, awayName] = final ? [final[1], final[4]] : finalPending ? [finalPending[1], finalPending[2]] : title.split(/\s+vs\.?\s+/i, 2);
  const home = (homeName || title || "TICKR Match").slice(0, 42);
  const away = (awayName || "Opponent").slice(0, 42);
  const homeTeam = TICKR_TEAMS.find((team) => team.name.toLowerCase() === home.toLowerCase() || team.symbol.toLowerCase() === home.toLowerCase());
  const awayTeam = TICKR_TEAMS.find((team) => team.name.toLowerCase() === away.toLowerCase() || team.symbol.toLowerCase() === away.toLowerCase());
  const [homeLogo, awayLogo] = await Promise.all([logoDataUrl(homeTeam?.cmcId), logoDataUrl(awayTeam?.cmcId)]);
  return new ImageResponse(
    (
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <Brand />
          <div style={{ color: "#67e8f9", border: "1px solid #155e75", borderRadius: 999, padding: "9px 18px", fontSize: 16, letterSpacing: 2 }}>{final || finalPending ? "FULL TIME" : "FIXTURE"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28, width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: 380 }}><div style={{ width: 118, height: 118, borderRadius: 999, background: "linear-gradient(145deg,#164e63,#0f2934)", border: "1px solid #22d3ee", display: "flex", alignItems: "center", justifyContent: "center", color: "#67e8f9", fontSize: 42, fontWeight: 800 }}>{homeLogo ? <img src={homeLogo} width={118} height={118} style={{ borderRadius: 999, background: "#fff" }} /> : home.slice(0, 1).toUpperCase()}</div><div style={{ fontSize: 34, fontWeight: 800, textAlign: "center" }}>{home}</div></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#22d3ee", fontSize: 44, fontWeight: 900, gap: 16 }}><span>{final ? `${final[2]}–${final[3]}` : finalPending ? "FT" : "VS"}</span><span style={{ color: "#94a3b8", fontSize: 17, fontWeight: 500 }}>BACK YOUR TEAM</span></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: 300 }}><div style={{ width: 118, height: 118, borderRadius: 999, background: "linear-gradient(145deg,#164e63,#0f2934)", border: "1px solid #22d3ee", display: "flex", alignItems: "center", justifyContent: "center", color: "#67e8f9", fontSize: 42, fontWeight: 800 }}>{awayLogo ? <img src={awayLogo} width={118} height={118} style={{ borderRadius: 999, background: "#fff" }} /> : away.slice(0, 1).toUpperCase()}</div><div style={{ fontSize: 34, fontWeight: 800 }}>{away}</div></div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#8ca3ad", fontSize: 18, borderTop: "1px solid #18343b", paddingTop: 18, width: "100%" }}><span>◉  Back your team. Climb the table.</span><span>tickrbase.top</span></div>
      </Card>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      headers: { "Cache-Control": OG_LIVE_CACHE },
    }
  );
}

async function renderMatchCard({ id }: { id: string }, fallbackTitle: string) {
  if (!isNumericId(id)) return new Response("Match not found", { status: 404 });
  const base = backendUrl();
  const c = OG_COLORS;

  const [fixture, pool] = await Promise.all([
    fetchJson<FixtureDto>(`${base}/api/fixtures/${id}`),
    fetchJson<PoolDto>(`${base}/api/fixtures/${id}/pool`),
  ]);

  if (!fixture?.home || !fixture?.away) {
    return await fallbackMatchCard(fallbackTitle);
  }

  const homeTeam = TICKR_TEAMS.find((t) => t.teamId === fixture.home!.teamId);
  const awayTeam = TICKR_TEAMS.find((t) => t.teamId === fixture.away!.teamId);
  const [homeLogo, awayLogo] = await Promise.all([
    logoDataUrl(homeTeam?.cmcId),
    logoDataUrl(awayTeam?.cmcId),
  ]);

  const settled = fixture.settled || pool?.settled || false;
  const seasonId = BigInt(fixture.seasonId ?? pool?.seasonId ?? SEASON_ID.toString());
  const score = settled ? await leagueScore(id, seasonId) : null;
  const totalPool =
    BigInt(pool?.totalHome ?? "0") +
    BigInt(pool?.totalDraw ?? "0") +
    BigInt(pool?.totalAway ?? "0") +
    BigInt(pool?.seed ?? "0");
  const payoutDistributed = settled ? (totalPool * 9300n) / 10000n : 0n;

  const winner =
    score !== null
      ? score[0] > score[1]
        ? 0
        : score[1] > score[0]
          ? 2
          : 1
      : null;

  const kickoffLabel = fixture.kickoff
    ? new Date(fixture.kickoff).toUTCString().slice(0, 22)
    : "TBA";

  return new ImageResponse(
    (
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand />
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: settled ? c.greenLight : c.amber,
              background: settled ? "rgba(29,158,117,.15)" : "rgba(245,158,11,.15)",
              padding: "10px 24px",
              borderRadius: 999,
            }}
          >
            {settled ? "FULL TIME" : `MATCHDAY ${fixture.matchdayIndex + 1}`}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 48 }}>
          <TeamBlock
            name={fixture.home.name}
            symbol={fixture.home.symbol}
            logo={homeLogo}
            highlight={winner === 0}
            dim={winner !== null && winner !== 0}
          />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            {score ? (
              <div style={{ fontSize: 96, fontWeight: 900, letterSpacing: 4 }}>
                {score[0]}–{score[1]}
              </div>
            ) : (
              <div style={{ fontSize: 64, fontWeight: 800, color: c.zinc400 }}>{settled ? "FT" : "VS"}</div>
            )}
            {settled && <div style={{ fontSize: 21, color: c.greenLight }}>{winner === 0 ? `${fixture.home.symbol} wins` : winner === 2 ? `${fixture.away.symbol} wins` : winner === 1 ? "Draw" : pool?.winningOutcome === 0 ? `${fixture.home.symbol} wins` : pool?.winningOutcome === 2 ? `${fixture.away.symbol} wins` : pool?.winningOutcome === 1 ? "Draw" : "Result pending"}</div>}
            {!settled && (
              <div style={{ fontSize: 22, color: c.zinc400 }}>{kickoffLabel}</div>
            )}
          </div>
          <TeamBlock
            name={fixture.away.name}
            symbol={fixture.away.symbol}
            logo={awayLogo}
            highlight={winner === 2}
            dim={winner !== null && winner !== 2}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 26, color: c.zinc400 }}>
            {settled ? (
              <>
                Payout distributed:{" "}
                <span style={{ color: c.greenLight, fontWeight: 800 }}>
                  {formatTickShort(payoutDistributed)} TICK
                </span>
              </>
            ) : (
              <>
                Pool:{" "}
                <span style={{ color: c.white, fontWeight: 800 }}>
                  {formatTickShort(totalPool)} TICK
                </span>
              </>
            )}
          </div>
          <div style={{ fontSize: 22, color: c.zinc500 }}>
            {ogBaseUrl().replace(/^https?:\/\//, "")}/match/{id}
          </div>
        </div>
      </Card>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      headers: { "Cache-Control": settled && score !== null ? OG_FINAL_CACHE : OG_LIVE_CACHE },
    }
  );
}

function TeamBlock({
  name,
  symbol,
  logo,
  highlight,
  dim,
}: {
  name: string;
  symbol: string;
  logo: string | null;
  highlight: boolean;
  dim: boolean;
}) {
  const c = OG_COLORS;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        opacity: dim ? 0.45 : 1,
      }}
    >
      {logo ? (
        <img
          src={logo}
          alt={symbol}
          width={120}
          height={120}
          style={{ borderRadius: 999, background: "#fff" }}
        />
      ) : (
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 999,
            background: `linear-gradient(135deg, ${c.accent} 0%, ${c.accentDark} 100%)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 48,
            fontWeight: 900,
          }}
        >
          {symbol.slice(0, 1)}
        </div>
      )}
      <div style={{ fontSize: 34, fontWeight: 800, color: highlight ? c.greenLight : c.white }}>
        {name}
      </div>
      <div style={{ fontSize: 24, color: c.zinc400 }}>{symbol}</div>
    </div>
  );
}

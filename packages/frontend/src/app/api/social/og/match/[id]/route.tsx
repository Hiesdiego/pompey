

import { ImageResponse } from "next/og";
import { parseAbi } from "viem";
import { getPublicClient } from "@/hooks/usePublicClient";
import { normalizeScoreline } from "@/lib/format";
import { TICKR_TEAMS } from "@tickr/shared/teams";
import {
  OG_WIDTH,
  OG_HEIGHT,
  OG_COLORS,
  ogBaseUrl,
  backendUrl,
  logoDataUrl,
  formatTickShort,
  isNumericId,
} from "../../_shared";


export const runtime = "nodejs";

const PRICE_ORACLE = (process.env.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS || "") as `0x${string}`;
const SEASON_ID = BigInt(process.env.NEXT_PUBLIC_SEASON_ID?.trim() || "2");

const PRICE_ORACLE_ABI = parseAbi([
  "event EndPriceSubmitted(uint256 indexed seasonId, uint256 indexed fixtureId, uint256 homePrice, uint256 awayPrice, int16 homeGoals, int16 awayGoals, uint8 outcome)",
  "function getSnapshot(uint256 seasonId, uint256 fixtureId) external view returns (uint256 homeStart, uint256 awayStart, uint256 homeEnd, uint256 awayEnd, bool startSubmitted, bool endSubmitted)",
]);
const PRICE_ORACLE_DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_PRICE_ORACLE_DEPLOY_BLOCK?.trim() || "0");

function roundedPercentChange(start: bigint, end: bigint): number | null {
  if (start <= 0n || end <= 0n) return null;
  const basisPoints = ((end - start) * 10_000n) / start;
  const adjustment = basisPoints >= 0n ? 25n : -25n;
  return Number((basisPoints + adjustment) / 50n);
}

interface FixtureDto {
  fixtureId: string;
  home: { teamId: number; name: string; symbol: string } | null;
  away: { teamId: number; name: string; symbol: string } | null;
  matchdayIndex: number;
  kickoff: string | null;
  kickoffRevealed: boolean;
  settled: boolean;
}

interface PoolDto {
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
    const response = await renderMatchCard(await params, fallbackTitle);
    if (!(response instanceof ImageResponse)) return response;
    return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
  } catch (error) {
    console.error("Match OG image failed", error);
    const fallback = await fallbackMatchCard(new URL(req.url).searchParams.get("title") || "TICKR match");
    return new Response(await fallback.arrayBuffer(), { status: fallback.status, headers: fallback.headers });
  }
}


async function fallbackMatchCard(title: string): Promise<ImageResponse> {
  const c = OG_COLORS;
  const [homeName, awayName] = title.split(/\s+vs\.?\s+/i, 2);
  const home = (homeName || title || "TICKR Match").slice(0, 42);
  const away = (awayName || "Opponent").slice(0, 42);
  const homeTeam = TICKR_TEAMS.find((team) => team.name.toLowerCase() === home.toLowerCase() || team.symbol.toLowerCase() === home.toLowerCase());
  const awayTeam = TICKR_TEAMS.find((team) => team.name.toLowerCase() === away.toLowerCase() || team.symbol.toLowerCase() === away.toLowerCase());
  const [homeLogo, awayLogo] = await Promise.all([logoDataUrl(homeTeam?.cmcId), logoDataUrl(awayTeam?.cmcId)]);
  return new ImageResponse(
    (
      <div
        style={{
          width: OG_WIDTH,
          height: OG_HEIGHT,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 54,
          background: "radial-gradient(ellipse at 100% 0%, #073847 0%, #071014 48%, #080b10 100%)",
          color: c.white,
          fontFamily: "system-ui, sans-serif",
          border: "1px solid #24434a",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, fontWeight: 800, letterSpacing: 2 }}><span style={{ color: "#22d3ee", fontSize: 38 }}>◈</span> TICKR <span style={{ color: "#22d3ee", fontSize: 18, letterSpacing: 1 }}>• THE CRYPTO FANTASY LEAGUE</span></div>
          <div style={{ color: "#67e8f9", border: "1px solid #155e75", borderRadius: 999, padding: "9px 18px", fontSize: 16, letterSpacing: 2 }}>FIXTURE</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28, width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: 380 }}><div style={{ width: 118, height: 118, borderRadius: 999, background: "linear-gradient(145deg,#164e63,#0f2934)", border: "1px solid #22d3ee", display: "flex", alignItems: "center", justifyContent: "center", color: "#67e8f9", fontSize: 42, fontWeight: 800 }}>{homeLogo ? <img src={homeLogo} width={118} height={118} style={{ borderRadius: 999, background: "#fff" }} /> : home.slice(0, 1).toUpperCase()}</div><div style={{ fontSize: 34, fontWeight: 800, textAlign: "center" }}>{home}</div></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#22d3ee", fontSize: 44, fontWeight: 900, gap: 16 }}><span>VS</span><span style={{ color: "#94a3b8", fontSize: 17, fontWeight: 500 }}>BACK YOUR TEAM</span></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: 300 }}><div style={{ width: 118, height: 118, borderRadius: 999, background: "linear-gradient(145deg,#164e63,#0f2934)", border: "1px solid #22d3ee", display: "flex", alignItems: "center", justifyContent: "center", color: "#67e8f9", fontSize: 42, fontWeight: 800 }}>{awayLogo ? <img src={awayLogo} width={118} height={118} style={{ borderRadius: 999, background: "#fff" }} /> : away.slice(0, 1).toUpperCase()}</div><div style={{ fontSize: 34, fontWeight: 800 }}>{away}</div></div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#8ca3ad", fontSize: 18, borderTop: "1px solid #18343b", paddingTop: 18, width: "100%" }}><span>◉  Pick your lineup. Back your team.</span><span>tickrbase.top</span></div>
      </div>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300" },
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
  let score: [number, number] | null = null;
  if (settled && PRICE_ORACLE) {
    try {
      const client = getPublicClient();
      const logs = await client.getContractEvents({
        address: PRICE_ORACLE,
        abi: PRICE_ORACLE_ABI,
        eventName: "EndPriceSubmitted",
        args: { seasonId: SEASON_ID, fixtureId: BigInt(id) },
        fromBlock: PRICE_ORACLE_DEPLOY_BLOCK,
        toBlock: "latest",
      });
      const settledEvent = logs[logs.length - 1];
      if (settledEvent) {
        const args = settledEvent.args as { homeGoals?: number | bigint; awayGoals?: number | bigint };
        if (args.homeGoals !== undefined && args.awayGoals !== undefined) {
          score = normalizeScoreline(Number(args.homeGoals), Number(args.awayGoals));
        }
      }
      if (!score) {
        const snapshot = await client.readContract({
          address: PRICE_ORACLE,
          abi: PRICE_ORACLE_ABI,
          functionName: "getSnapshot",
          args: [SEASON_ID, BigInt(id)],
        });
        if (snapshot[5]) {
          const homeGoals = roundedPercentChange(snapshot[0], snapshot[2]);
          const awayGoals = roundedPercentChange(snapshot[1], snapshot[3]);
          if (homeGoals !== null && awayGoals !== null) score = normalizeScoreline(homeGoals, awayGoals);
        }
      }
    } catch {
      score = null;
    }
  }
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
      <div
        style={{
          width: OG_WIDTH,
          height: OG_HEIGHT,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "radial-gradient(ellipse at 100% 0%, #062b3a 0%, #05090f 42%, #020307 100%)",
          color: c.white,
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: 64,
          border: "1px solid #17404d",
          borderRadius: 28,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                background: "linear-gradient(145deg, #23d5f4 0%, #1474ff 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
                fontWeight: 900,
              }}
            >
              ↑
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 2 }}>TICKR</div>
          </div>
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
              <div style={{ fontSize: 64, fontWeight: 800, color: c.zinc400 }}>VS</div>
            )}
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
      </div>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300" },
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

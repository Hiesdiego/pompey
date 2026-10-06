/**
 * Dynamic OG image for a match: /api/og/match/[id]
 *
 * Mirrors the desktop match card:
 *  - Unresolved: teams + logos, VS (or live score), matchday, pool size
 *  - Resolved: FT score, winner highlight, payout distributed
 *
 * 1200×630 PNG generated at request time via Next's ImageResponse.
 */

import { ImageResponse } from "next/og";
import { parseAbi } from "viem";
import { getPublicClient } from "@/hooks/usePublicClient";
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

/**
 * NOTE: Node.js runtime (not edge) — viem's RPC calls fail on the edge
 * runtime, which broke all chain reads. OG images are cached by crawlers
 * anyway, so the edge speed advantage doesn't matter here.
 */
export const runtime = "nodejs";

const PRICE_ORACLE = (process.env.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS || "") as `0x${string}`;
// `||` not `??` — an empty env var must fall back too; BigInt("") throws at module load.
const SEASON_ID = BigInt(process.env.NEXT_PUBLIC_SEASON_ID?.trim() || "2");

const SNAPSHOT_ABI = parseAbi([
  "function getSnapshot(uint256 seasonId, uint256 fixtureId) external view returns (uint256 homeStart, uint256 awayStart, uint256 homeEnd, uint256 awayEnd, bool startSubmitted, bool endSubmitted)",
]);

const PRICE_DECIMALS = 8;

function pctOf(start: bigint, end: bigint): number | null {
  if (start <= 0n || end <= 0n) return null;
  const s = Number(start) / 10 ** PRICE_DECIMALS;
  const e = Number(end) / 10 ** PRICE_DECIMALS;
  if (s <= 0) return null;
  return ((e - s) / s) * 100;
}

/** Same oracle rounding as the app: 1 goal = 0.5% price move. */
function goalsFor(pct: number): number {
  const sign = pct < 0 ? -1 : 1;
  const abs = Math.abs(pct);
  // 0.5% per goal, dead zone below 0.25%
  if (abs < 0.25) return 0;
  return sign * Math.round(abs / 0.5);
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
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const response = await renderMatchCard(await params);
    if (!(response instanceof ImageResponse)) return response;
    // Rendering is lazy. Consume the image here so Satori errors reach this catch.
    return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
  } catch (error) {
    console.error("Match OG image failed", error);
    const fallback = fallbackMatchCard("TICKR Match");
    return new Response(await fallback.arrayBuffer(), { status: fallback.status, headers: fallback.headers });
  }
}

/** Minimal fallback card — guaranteed to render. */
function fallbackMatchCard(title: string): ImageResponse {
  const c = OG_COLORS;
  return new ImageResponse(
    (
      <div
        style={{
          width: OG_WIDTH,
          height: OG_HEIGHT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: c.bg,
          color: c.white,
          fontFamily: "system-ui, sans-serif",
          fontSize: 72,
          fontWeight: 900,
        }}
      >
        {title}
      </div>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300" },
    }
  );
}

async function renderMatchCard({ id }: { id: string }) {
  if (!isNumericId(id)) return new Response("Match not found", { status: 404 });
  const base = backendUrl();
  const c = OG_COLORS;

  const [fixture, pool] = await Promise.all([
    fetchJson<FixtureDto>(`${base}/api/fixtures/${id}`),
    fetchJson<PoolDto>(`${base}/api/fixtures/${id}/pool`),
  ]);

  if (!fixture?.home || !fixture?.away) {
    return fallbackMatchCard("Match not found");
  }

  const homeTeam = TICKR_TEAMS.find((t) => t.teamId === fixture.home!.teamId);
  const awayTeam = TICKR_TEAMS.find((t) => t.teamId === fixture.away!.teamId);
  // Pre-fetch logos as data URLs — never let Satori fetch external images
  // during render (a blocked CDN kills the whole image).
  const [homeLogo, awayLogo] = await Promise.all([
    logoDataUrl(homeTeam?.cmcId),
    logoDataUrl(awayTeam?.cmcId),
  ]);

  const settled = fixture.settled || pool?.settled || false;

  // FT score from the oracle snapshot (same source as the app).
  let score: [number, number] | null = null;
  if (settled && PRICE_ORACLE) {
    try {
      const client = getPublicClient();
      const snap = await client.readContract({
        address: PRICE_ORACLE,
        abi: SNAPSHOT_ABI,
        functionName: "getSnapshot",
        args: [SEASON_ID, BigInt(id)],
      });
      if (snap[5]) {
        const hg = pctOf(snap[0], snap[2]);
        const ag = pctOf(snap[1], snap[3]);
        if (hg !== null && ag !== null) score = [goalsFor(hg), goalsFor(ag)];
      }
    } catch {
      /* snapshot unavailable — card renders without score */
    }
  }

  // Payout distributed = total pool minus platform fee (matches claim math).
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
          background: `linear-gradient(135deg, ${c.bg} 0%, ${c.bgAlt} 100%)`,
          color: c.white,
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: 64,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: `linear-gradient(135deg, ${c.accent} 0%, ${c.accentDark} 100%)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
                fontWeight: 900,
              }}
            >
              ✓
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

        {/* Teams + score */}
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

        {/* Footer */}
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
        // eslint-disable-next-line @next/next/no-img-element
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

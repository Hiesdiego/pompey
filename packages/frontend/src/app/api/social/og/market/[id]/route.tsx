

import { ImageResponse } from "next/og";
import {
  parseAbi,
  decodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { getPublicClient } from "@/hooks/usePublicClient";
import { TICKR_TEAMS } from "@tickr/shared/teams";
import {
  OG_WIDTH,
  OG_HEIGHT,
  OG_COLORS,
  ogBaseUrl,
  backendUrl,
  formatTickShort,
  handleForAddress,
  isNumericId,
  logoDataUrl,
} from "../../_shared";


export const runtime = "nodejs";

const FACTORY = (process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS || "") as `0x${string}`;
const FACTORY_DEPLOY_BLOCK = BigInt(process.env.MARKET_FACTORY_DEPLOY_BLOCK?.trim() || "0");

const FACTORY_ABI = parseAbi([
  "function marketInfo(uint256 marketId) external view returns (uint8 templateId, address creator, string creatorName, uint64 createdAt, uint64 bettingCloseTime, uint64 endTime, uint64 voidAfter, bytes params, uint8 outcomeCount)",
  "function marketSettlement(uint256 marketId) external view returns (uint256 seedAmount, uint256 totalStaked, uint8 state, uint256 winnerBitmap, uint256 payoutPerShare)",
  "function outcomeTotals(uint256 marketId, uint256 outcome) external view returns (uint256)",
  "event MarketResolved(uint256 indexed marketId, uint256 winnerBitmap, uint256 payoutPerShare, address resolver)",
]);

const TEMPLATES = { TOP_GAINER: 0, CHAMPION: 1, H2H: 2, TARGET: 3, SPREAD: 4 } as const;
const TEMPLATE_NAMES: Record<number, string> = {
  0: "Top Gainer",
  1: "Champion",
  2: "Head-to-Head",
  3: "Price Target",
  4: "Spread",
};

function teamSymbol(teamId: number | bigint): string {
  const id = Number(teamId);
  return TICKR_TEAMS.find((t) => t.teamId === id)?.symbol ?? `#${id}`;
}

function teamName(teamId: number | bigint): string {
  const id = Number(teamId);
  return TICKR_TEAMS.find((t) => t.teamId === id)?.name ?? `Team #${id}`;
}

async function questionFor(templateId: number, params: `0x${string}`): Promise<string> {
  try {
    if (templateId === TEMPLATES.TOP_GAINER) {
      const [, md] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), params);
      return `Which coin gains the most on matchday ${Number(md) + 1}?`;
    }
    if (templateId === TEMPLATES.CHAMPION) return "Who will win the season championship?";
    if (templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), params);
      return `Will ${teamName(a)} outperform ${teamName(b)}?`;
    }
    if (templateId === TEMPLATES.TARGET) {
      const [teamId, target, , above] = decodeAbiParameters(
        parseAbiParameters("uint16, uint256, uint64, bool"),
        params
      );
      return `Will ${teamSymbol(teamId)} finish ${above ? "above" : "below"} $${(Number(target) / 1e8).toLocaleString()}?`;
    }
    if (templateId === TEMPLATES.SPREAD) {
      const [, fixtureId, spread] = decodeAbiParameters(parseAbiParameters("uint256, uint256, int16"), params);
      const res = await fetch(`${backendUrl()}/api/fixtures/${fixtureId}`, {
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const fixture = (await res.json()) as { home?: { symbol?: string } | null; away?: { symbol?: string } | null };
        if (fixture.home?.symbol && fixture.away?.symbol) {
          const points = Math.abs(Number(spread));
          const goalWord = points === 1 ? "goal" : "goals";
          return Number(spread) >= 0
            ? `Will ${fixture.home.symbol} beat ${fixture.away.symbol} by more than ${points} ${goalWord}?`
            : `Will ${fixture.home.symbol} avoid losing to ${fixture.away.symbol} by ${points}+ ${goalWord}?`;
        }
      }
      return "Will the home team cover the fixture spread?";
    }
  } catch {
    return TEMPLATE_NAMES[templateId] ?? "Market";
  }
  return TEMPLATE_NAMES[templateId] ?? "Market";
}

function outcomeLabels(
  templateId: number,
  params: `0x${string}`,
  outcomeCount: number
): string[] {
  try {
    if (templateId === TEMPLATES.TOP_GAINER || templateId === TEMPLATES.CHAMPION) {
      return TICKR_TEAMS.slice(0, outcomeCount).map((t) => t.symbol);
    }
    if (templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), params);
      return [`${teamSymbol(a)} gains more`, `${teamSymbol(b)} gains more`];
    }
    return ["Yes", "No"];
  } catch {
    return Array.from({ length: outcomeCount }, (_, i) => `Outcome ${i}`);
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const response = await renderMarketCard(await params, new URL(req.url).searchParams.get("title") || "TICKR prediction market");
    if (!(response instanceof ImageResponse)) return response;
    return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
  } catch (error) {
    console.error("Market OG image failed", error);
    const fallback = fallbackMarketCard(new URL(req.url).searchParams.get("title") || "TICKR prediction market");
    return new Response(await fallback.arrayBuffer(), { status: fallback.status, headers: fallback.headers });
  }
}


function fallbackMarketCard(title: string, resolution?: { status: string; outcome: string }): ImageResponse {
  const c = OG_COLORS;
  const safeTitle = title.slice(0, 110);
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, fontWeight: 800, letterSpacing: 2 }}>
            <span style={{ color: "#22d3ee", fontSize: 38 }}>◈</span> TICKR <span style={{ color: "#22d3ee", fontSize: 18, letterSpacing: 1 }}>• THE CRYPTO FANTASY LEAGUE</span>
          </div>
          <div style={{ color: resolution ? "#7fe0bd" : "#67e8f9", border: `1px solid ${resolution ? "#1d9e75" : "#155e75"}`, borderRadius: 999, padding: "9px 18px", fontSize: 16, letterSpacing: 2 }}>{resolution?.status ?? "LIVE MARKET"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 570, gap: 22 }}>
            <div style={{ color: "#22d3ee", fontSize: 17, letterSpacing: 3, fontWeight: 700 }}>{resolution ? "FINAL RESULT" : "PICK YOUR LINEUP"}</div>
            <div style={{ fontSize: 47, lineHeight: 1.14, fontWeight: 800 }}>{safeTitle}</div>
            <div style={{ color: "#67e8f9", fontSize: resolution ? 25 : 19, letterSpacing: 1, fontWeight: resolution ? 800 : 500 }}>{resolution?.outcome ?? "BACK YOUR TEAM. CLIMB THE TABLE."}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", width: 400, padding: 24, borderRadius: 20, background: "#0b1117", border: "1px solid #164e63", gap: 14 }}>
            <div style={{ color: "#94a3b8", fontSize: 16, letterSpacing: 2 }}>CHOOSE AN OUTCOME</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 17, borderRadius: 12, background: "#101b20", border: "1px solid #17434b", fontSize: 23 }}><span style={{ color: "#4ade80" }}>● Yes</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 17, borderRadius: 12, background: "#10171c", border: "1px solid #29353a", fontSize: 23 }}><span style={{ color: "#fb7185" }}>● No</span></div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#8ca3ad", fontSize: 18, borderTop: "1px solid #18343b", paddingTop: 18 }}><span>◉  A market for every prediction</span><span>tickrbase.top</span></div>
      </div>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300" },
    }
  );
}

async function marketFallback(id: string, title: string): Promise<ImageResponse> {
  try {
    const response = await fetch(`${backendUrl()}/api/chain/markets/${id}`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return fallbackMarketCard(title);
    const payload = (await response.json()) as {
      data?: { market?: { templateId: number; params: string; state: number; winnerBitmap: string; outcomeCount: number } };
    };
    const market = payload.data?.market;
    if (!market) return fallbackMarketCard(title);
    const params = market.params as `0x${string}`;
    const question = await questionFor(market.templateId, params);
    if (market.state === 1) {
      const labels = outcomeLabels(market.templateId, params, market.outcomeCount);
      const bitmap = BigInt(market.winnerBitmap);
      const winners = labels.filter((_, index) => ((bitmap >> BigInt(index)) & 1n) === 1n);
      return fallbackMarketCard(question, { status: "RESOLVED", outcome: winners.length ? `Resolved: ${winners.join(" · ")}` : "Settlement recorded" });
    }
    if (market.state === 2) return fallbackMarketCard(question, { status: "VOIDED", outcome: "Market voided · stakes returned" });
    return fallbackMarketCard(question);
  } catch {
    return fallbackMarketCard(title);
  }
}

async function renderMarketCard({ id }: { id: string }, fallbackTitle: string) {
  const c = OG_COLORS;
  if (!isNumericId(id)) return new Response("Market not found", { status: 404 });
  const marketId = BigInt(id);

  if (!FACTORY) {
    return marketFallback(id, fallbackTitle);
  }

  const client = getPublicClient();
  const reads = await Promise.all([
    client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "marketInfo", args: [marketId] }),
    client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "marketSettlement", args: [marketId] }),
  ]).catch(() => null);
  if (!reads) return marketFallback(id, fallbackTitle);
  const [info, settlement] = reads;

  const [templateId, creator, creatorName, , bettingCloseTime, , , marketParams, outcomeCount] = info;
  const [seedAmount, totalStaked, state, winnerBitmap] = settlement;
  const resolved = state === 1;
  const voided = state === 2;

  let question = await questionFor(templateId, marketParams);
  if (templateId === TEMPLATES.SPREAD && (question === "Spread" || question === "Will the home team cover the fixture spread?")) question = fallbackTitle;
  const labels = outcomeLabels(templateId, marketParams, outcomeCount);
  const totals = await Promise.all(
    labels.map((_, i) =>
      client
        .readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "outcomeTotals", args: [marketId, BigInt(i)] })
        .catch(() => 0n)
    )
  );
  const totalForOdds = totals.reduce((s, v) => s + v, 0n) + seedAmount;
  const pct = (i: number) =>
    totalForOdds > 0n ? Number((totals[i] * 10000n) / totalForOdds) / 100 : 0;
  const ranked = labels
    .map((label, i) => ({ label, i, pct: pct(i) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);
  const rankedLogos = await Promise.all(ranked.map(({ i }) =>
    templateId === TEMPLATES.TOP_GAINER || templateId === TEMPLATES.CHAMPION
      ? logoDataUrl(TICKR_TEAMS[i]?.cmcId)
      : Promise.resolve(null)
  ));
  const winners: number[] = [];
  if (resolved) {
    for (let i = 0; i < labels.length; i++) {
      if ((winnerBitmap >> BigInt(i)) & 1n) winners.push(i);
    }
  }
  let resolverHandle: string | null = null;
  if (resolved) {
    try {
      const logs = await client.getLogs({
        address: FACTORY,
        event: FACTORY_ABI[3],
        args: { marketId },
        fromBlock: FACTORY_DEPLOY_BLOCK > 0n ? FACTORY_DEPLOY_BLOCK : undefined,
      });
      const resolver = (logs[0]?.args as { resolver?: `0x${string}` } | undefined)?.resolver;
      if (resolver) resolverHandle = await handleForAddress(resolver);
    } catch {
      resolverHandle = null;
    }
  }

  const creatorHandle = creatorName?.trim()
    ? `@${creatorName.trim().replace(/^@/, "")}`
    : await handleForAddress(creator);

  const closeLabel = (() => {
    const secs = Number(bettingCloseTime) - Math.floor(Date.now() / 1000);
    if (secs <= 0) return "Betting closed";
    const h = Math.floor(secs / 3600);
    if (h < 24) return `Closes in ${h}h`;
    return `Closes in ${Math.floor(h / 24)}d`;
  })();

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
              color: resolved ? c.greenLight : voided ? c.zinc400 : c.amber,
              background: resolved
                ? "rgba(29,158,117,.15)"
                : voided
                  ? "rgba(161,161,170,.15)"
                  : "rgba(245,158,11,.15)",
              padding: "10px 24px",
              borderRadius: 999,
            }}
          >
            {resolved ? "RESOLVED" : voided ? "VOIDED" : TEMPLATE_NAMES[templateId]?.toUpperCase() ?? "MARKET"}
          </div>
        </div>
        <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.2 }}>
          {question.length > 90 ? question.slice(0, 87) + "…" : question}
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {voided ? (
            <div style={{ fontSize: 30, fontWeight: 700, color: c.zinc400, background: "rgba(161,161,170,.12)", padding: "16px 28px", borderRadius: 16 }}>
              Market voided · stakes returned
            </div>
          ) : resolved
            ? winners.map((i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    fontSize: 36,
                    fontWeight: 800,
                    color: c.greenLight,
                    background: "rgba(29,158,117,.12)",
                    padding: "16px 32px",
                    borderRadius: 16,
                  }}
                >
                  ✓ {labels[i]}
                </div>
              ))
            : ranked.map((o) => (
                <div
                  key={o.i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    background: c.card,
                    padding: "16px 28px",
                    borderRadius: 16,
                  }}
                >
                  {rankedLogos[ranked.indexOf(o)] ? <img src={rankedLogos[ranked.indexOf(o)]!} width={42} height={42} style={{ borderRadius: 999, background: "#fff" }} /> : null}
                  <span style={{ fontSize: 30, fontWeight: 700, color: c.zinc100 }}>{o.label}</span>
                  <span style={{ fontSize: 34, fontWeight: 900, color: c.accent }}>
                    {o.pct.toFixed(0)}%
                  </span>
                </div>
              ))}
          {winners.length === 0 && resolved && (
            <div style={{ fontSize: 30, color: c.zinc400 }}>No winning outcome</div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 32, fontSize: 24, color: c.zinc400 }}>
            <span>
              Created by <span style={{ color: c.white, fontWeight: 700 }}>{creatorHandle}</span>
            </span>
            {resolverHandle && (
              <span>
                Resolved by <span style={{ color: c.greenLight, fontWeight: 700 }}>{resolverHandle}</span>
              </span>
            )}
            {!resolved && !voided && <span>{closeLabel}</span>}
          </div>
          <div style={{ fontSize: 22, color: c.zinc500 }}>
            {ogBaseUrl().replace(/^https?:\/\//, "")}/markets/{id}
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

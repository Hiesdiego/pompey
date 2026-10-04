/**
 * Dynamic OG image for a market: /api/og/market/[id]
 *
 * Mirrors the desktop market card:
 *  - Unresolved: question, top outcomes + odds, "created by @creator", close time
 *  - Resolved: question, winning outcome, "resolved by @resolver", "created by @creator"
 *
 * 1200×630 PNG generated at request time via Next's ImageResponse.
 */

import { ImageResponse } from "next/og";
import {
  createPublicClient,
  http,
  parseAbi,
  decodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { baseSepolia } from "viem/chains";
import { TICKR_TEAMS } from "@tickr/shared/teams";
import {
  OG_WIDTH,
  OG_HEIGHT,
  OG_COLORS,
  ogBaseUrl,
  formatTickShort,
  handleForAddress,
  isNumericId,
} from "../../_shared";

/**
 * NOTE: Node.js runtime (not edge) — viem's RPC calls fail on the edge
 * runtime, which broke all chain reads. OG images are cached by crawlers
 * anyway, so the edge speed advantage doesn't matter here.
 */
export const runtime = "nodejs";

const FACTORY = (process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS || "") as `0x${string}`;
// `||` not `??` — an empty env var must fall back too; BigInt("") throws at module load.
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

function questionFor(templateId: number, params: `0x${string}`): string {
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
    if (templateId === TEMPLATES.SPREAD) return "Will the home team cover the fixture spread?";
  } catch {
    /* fall through */
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
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const response = await renderMarketCard(await params);
    if (!(response instanceof ImageResponse)) return response;
    // Rendering is lazy. Consume the image here so Satori errors reach this catch.
    return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
  } catch (error) {
    console.error("Market OG image failed", error);
    const fallback = fallbackMarketCard("TICKR Market");
    return new Response(await fallback.arrayBuffer(), { status: fallback.status, headers: fallback.headers });
  }
}

/** Minimal fallback card — guaranteed to render. */
function fallbackMarketCard(title: string): ImageResponse {
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
          fontSize: 56,
          fontWeight: 900,
          padding: 64,
          textAlign: "center",
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

async function renderMarketCard({ id }: { id: string }) {
  const c = OG_COLORS;
  if (!isNumericId(id)) return new Response("Market not found", { status: 404 });
  const marketId = BigInt(id);

  if (!FACTORY) {
    return fallbackMarketCard("TICKR Market");
  }

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http("https://sepolia.base.org", { timeout: 5000, retryCount: 0 }),
  });

  // A non-existent market reverts — render the fallback card, not a 500.
  const reads = await Promise.all([
    client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "marketInfo", args: [marketId] }),
    client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "marketSettlement", args: [marketId] }),
  ]).catch(() => null);
  if (!reads) return fallbackMarketCard("Market not found");
  const [info, settlement] = reads;

  const [templateId, creator, creatorName, , bettingCloseTime, , , marketParams, outcomeCount] = info;
  const [seedAmount, totalStaked, state, winnerBitmap] = settlement;
  // state: 0 = Open, 1 = Resolved, 2 = Voided
  const resolved = state === 1;
  const voided = state === 2;

  const question = questionFor(templateId, marketParams);
  const labels = outcomeLabels(templateId, marketParams, outcomeCount);

  // Outcome totals for odds.
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

  // Top 3 outcomes by stake for the card.
  const ranked = labels
    .map((label, i) => ({ label, i, pct: pct(i) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  // Winning outcome indices from the bitmap.
  const winners: number[] = [];
  if (resolved) {
    for (let i = 0; i < labels.length; i++) {
      if ((winnerBitmap >> BigInt(i)) & 1n) winners.push(i);
    }
  }

  // Resolver: from the MarketResolved event.
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
      /* resolver unknown — card renders without it */
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

        {/* Question */}
        <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.2 }}>
          {question.length > 90 ? question.slice(0, 87) + "…" : question}
        </div>

        {/* Outcomes */}
        <div style={{ display: "flex", gap: 24 }}>
          {resolved || voided
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
                  <span style={{ fontSize: 30, fontWeight: 700, color: c.zinc100 }}>{o.label}</span>
                  <span style={{ fontSize: 34, fontWeight: 900, color: c.accent }}>
                    {o.pct.toFixed(0)}%
                  </span>
                </div>
              ))}
          {winners.length === 0 && (resolved || voided) && (
            <div style={{ fontSize: 30, color: c.zinc400 }}>No winning outcome</div>
          )}
        </div>

        {/* Footer */}
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

import { Card, Brand, Coins, type CoinArt } from "../../_design";
import { cupCmcId } from "../../_cup";


import { ImageResponse } from "next/og";
import {
  parseAbi,
  decodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { getPublicClient } from "@/hooks/usePublicClient";
import { TICKR_TEAMS } from "@tickr/shared/teams";
import { TARGET_COINS, targetCoinById } from "@/lib/targetCoins";
import { marketFromRoute, MARKET_FACTORY_ADDRESS } from "@/lib/marketFactory";
import { priceTargetQuestion } from "@/lib/priceTargetQuestion";
import {
  OG_WIDTH,
  OG_HEIGHT,
  OG_LIVE_CACHE,
  OG_FINAL_CACHE,
  ogBaseUrl,
  backendUrl,
  logoDataUrl,
} from "../../_shared";


export const runtime = "nodejs";



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
      const [teamId, target, atTime, above] = decodeAbiParameters(
        parseAbiParameters("uint16, uint256, uint64, bool"),
        params
      );
      return priceTargetQuestion(targetCoinById(Number(teamId))?.symbol ?? teamSymbol(teamId), Number(target) / 1e8, above, new Date(Number(atTime) * 1000));
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

async function artwork(templateId: number, params: `0x${string}`, ranked: number[] = []): Promise<CoinArt[]> {
  let coins: { symbol: string; cmcId?: number }[] = [];
  if (templateId === TEMPLATES.TARGET) {
    const [id] = decodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), params);
    const coin = targetCoinById(Number(id));
    if (coin) coins = [{ symbol: coin.symbol, cmcId: coin.cupTeamId !== undefined ? cupCmcId(coin.cupTeamId) : TICKR_TEAMS.find(t => t.teamId === coin.teamId)?.cmcId }];
  } else if (templateId === TEMPLATES.H2H) {
    const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), params);
    coins = [a, b].map(id => TICKR_TEAMS.find(t => t.teamId === Number(id))).filter((t): t is typeof TICKR_TEAMS[number] => !!t);
  } else if (templateId === TEMPLATES.SPREAD) {
    const [, id] = decodeAbiParameters(parseAbiParameters("uint256, uint256, int16"), params);
    const response = await fetch(`${backendUrl()}/api/fixtures/${id}`, { next: { revalidate: 30 }, signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const fixture = await response.json();
      coins = [fixture.home, fixture.away].filter(Boolean).map(t => ({ symbol: t.symbol, cmcId: TICKR_TEAMS.find(team => team.teamId === t.teamId)?.cmcId }));
    }
  } else coins = ranked.map(i => TICKR_TEAMS[i]).filter(Boolean);
  return Promise.all(coins.map(async coin => ({ symbol: coin.symbol, logo: await logoDataUrl(coin.cmcId) })));
}

async function marketCard(title: string, status = "PREDICTION MARKET", coins: CoinArt[] = [], outcome?: string) {
  // The metadata title can still identify a target coin when both data sources are unavailable.
  if (!coins.length) {
    const symbol = title.match(/^Will ([A-Z0-9]+) finish/)?.[1];
    const coin = TARGET_COINS.find(c => c.symbol === symbol);
    if (coin) coins = [{ symbol: coin.symbol, logo: await logoDataUrl(coin.cupTeamId !== undefined ? cupCmcId(coin.cupTeamId) : TICKR_TEAMS.find(t => t.teamId === coin.teamId)?.cmcId) }];
  }
  return new ImageResponse(<Card>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><Brand /><span style={{ color: "#9ac2ff", fontSize: 18 }}>{status}</span></div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 38 }}>
      <div style={{ display: "flex", flexDirection: "column", width: coins.length ? 660 : 1050, gap: 24 }}>
        <div style={{ fontSize: title.length > 100 ? 42 : 49, lineHeight: 1.15, fontWeight: 800 }}>{title}</div>
        {outcome && <div style={{ fontSize: 27, color: "#7fe0bd" }}>{outcome}</div>}
      </div>
      <Coins coins={coins} />
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #365171", paddingTop: 20, color: "#9bb0cc", fontSize: 19 }}><span>A market for every prediction</span><span>{ogBaseUrl().replace(/^https?:\/\//, "")}</span></div>
  </Card>, { width: OG_WIDTH, height: OG_HEIGHT, headers: { "Cache-Control": outcome ? OG_FINAL_CACHE : OG_LIVE_CACHE } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const route = marketFromRoute(id);
  if (!route) return new Response("Market not found", { status: 404 });
  let title = new URL(req.url).searchParams.get("title") || "TICKR prediction market";
  let card: ImageResponse;
  try {
    const client = getPublicClient();
    let market: { templateId: number; params: `0x${string}`; state: number; winnerBitmap: bigint; outcomeCount: number };
    try {
      const [info, settlement] = await Promise.all([
        client.readContract({ address: route.factory, abi: FACTORY_ABI, functionName: "marketInfo", args: [route.id] }),
        client.readContract({ address: route.factory, abi: FACTORY_ABI, functionName: "marketSettlement", args: [route.id] }),
      ]);
      market = { templateId: info[0], params: info[7], outcomeCount: info[8], state: settlement[2], winnerBitmap: settlement[3] };
    } catch (error) {
      if (route.factory.toLowerCase() !== MARKET_FACTORY_ADDRESS?.toLowerCase()) throw error;
      const response = await fetch(`${backendUrl()}/api/chain/markets/${id}`, { next: { revalidate: 30 }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw error;
      const payload = await response.json();
      market = payload.data?.market;
      if (!market) throw error;
      market.winnerBitmap = BigInt(market.winnerBitmap);
    }
    if (route.factory.toLowerCase() === MARKET_FACTORY_ADDRESS?.toLowerCase()) {
      try {
        const response = await fetch(`${backendUrl()}/api/chain/markets/${id}`, { next: { revalidate: 10 }, signal: AbortSignal.timeout(5000) });
        const cached = response.ok ? (await response.json()).data?.market : null;
        if (cached && (cached.state === 1 || cached.state === 2)) market = { ...cached, winnerBitmap: BigInt(cached.winnerBitmap) };
      } catch { /* Direct chain reads remain usable. */ }
    }
    title = await questionFor(market.templateId, market.params);
    const labels = outcomeLabels(market.templateId, market.params, market.outcomeCount);
    const totals = await Promise.all(labels.map((_, i) => client.readContract({ address: route.factory, abi: FACTORY_ABI, functionName: "outcomeTotals", args: [route.id, BigInt(i)] }).catch(() => null)));
    // Do not invent pool leaders when totals could not be read.
    const ranked = totals.every(t => t !== null) ? totals.map((total, i) => ({ total: total!, i })).sort((a, b) => a.total > b.total ? -1 : a.total < b.total ? 1 : a.i - b.i).slice(0, 3).map(t => t.i) : [];
    const coins = await artwork(market.templateId, market.params, ranked);
    const winners = labels.filter((_, i) => (market.winnerBitmap & (1n << BigInt(i))) !== 0n);
    const outcome = market.state === 2 ? "Market voided · stakes returned" : market.state === 1 ? `Result: ${winners.join(" · ") || "No winning outcome"}` : undefined;
    card = await marketCard(title, market.state === 1 ? "RESOLVED" : market.state === 2 ? "VOIDED" : TEMPLATE_NAMES[market.templateId].toUpperCase(), coins, outcome);
  } catch (error) {
    console.error("Market OG data unavailable", error);
    card = await marketCard(title);
  }
  try {
    return new Response(await card.arrayBuffer(), { headers: card.headers });
  } catch {
    const fallback = await marketCard(title);
    return new Response(await fallback.arrayBuffer(), { headers: fallback.headers });
  }
}



import type { Metadata } from "next";
import { parseAbi, decodeAbiParameters, parseAbiParameters } from "viem";
import { getPublicClient } from "../../../hooks/usePublicClient";
import { backendUrl, siteUrl } from "../../api/social/og/_shared";
import { targetCoinById } from "../../../lib/targetCoins";
import { marketFromRoute } from "../../../lib/marketFactory";
import { priceTargetQuestion } from "../../../lib/priceTargetQuestion";
import {
  isStockMarketRoute,
  stockMarketFromRoute,
  STOCK_MARKET_FACTORY_ABI,
  normalizeStockMarketInfo,
  stockDisplaySymbol,
  stockPriceTargetQuestion,
} from "../../../lib/stockMarketContracts";

export const revalidate = 60;

const FACTORY_ABI = parseAbi([
  "function marketInfo(uint256 marketId) external view returns (uint8 templateId, address creator, string creatorName, uint64 createdAt, uint64 bettingCloseTime, uint64 endTime, uint64 voidAfter, bytes params, uint8 outcomeCount)",
]);

async function marketQuestion(marketId: bigint, factory: `0x${string}`): Promise<string | null> {
  try {
    if (!factory) return null;
    const client = getPublicClient();
    const info = await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "marketInfo",
      args: [marketId],
    });
    const [templateId, , creatorName, , , , , params] = info;
    const { TICKR_TEAMS } = await import("@tickr/shared/teams");
    const sym = (id: number | bigint) =>
      TICKR_TEAMS.find((t) => t.teamId === Number(id))?.symbol ?? `#${Number(id)}`;
    const nm = (id: number | bigint) =>
      TICKR_TEAMS.find((t) => t.teamId === Number(id))?.name ?? `Team #${Number(id)}`;
    if (templateId === 0) {
      const [, md] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), params);
      return `Which coin gains the most on matchday ${Number(md) + 1}?`;
    }
    if (templateId === 1) return "Who will win the season championship?";
    if (templateId === 2) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), params);
      return `Will ${nm(a)} outperform ${nm(b)}?`;
    }
    if (templateId === 3) {
      const [teamId, target, atTime, above] = decodeAbiParameters(
        parseAbiParameters("uint16, uint256, uint64, bool"),
        params
      );
      return priceTargetQuestion(targetCoinById(Number(teamId))?.symbol ?? sym(teamId), Number(target) / 1e8, above, new Date(Number(atTime) * 1000));
    }
    if (templateId === 4) {
      const [, fixtureId, spread] = decodeAbiParameters(parseAbiParameters("uint256, uint256, int16"), params);
      const response = await fetch(`${backendUrl()}/api/fixtures/${fixtureId}`, { next: { revalidate: 60 } });
      if (response.ok) {
        const fixture = (await response.json()) as { home?: { symbol?: string } | null; away?: { symbol?: string } | null };
        if (fixture.home?.symbol && fixture.away?.symbol) {
          const points = Math.abs(Number(spread));
          const goals = points === 1 ? "goal" : "goals";
          return Number(spread) >= 0
            ? `Will ${fixture.home.symbol} beat ${fixture.away.symbol} by more than ${points} ${goals}?`
            : `Will ${fixture.home.symbol} avoid losing to ${fixture.away.symbol} by ${points}+ ${goals}?`;
        }
      }
      return "Will the home team cover the fixture spread?";
    }
    void creatorName;
    return "TICKR prediction market";
  } catch {
    return null;
  }
}

// Stock price target markets carry their terms directly on the
// StockMarketFactory marketInfo tuple (token, symbol, direction,
// targetPrice, creator, creatorName, createdAt, bettingCloseTime,
// endTime, voidAfter, outcomeCount), so the question is built from
// those fields with stockPriceTargetQuestion, the same formatter the
// stock detail page and the stock market cards use. The read mirrors
// marketQuestion above: same public client, same try/catch fallback
// to null, which keeps the generic metadata fallback below intact
// when the factory read fails or the market does not exist. A market
// id that was never created reads back as zero values (empty symbol,
// zero target, zero endTime), so those are treated as missing too.
async function stockMarketQuestion(marketId: bigint, factory: `0x${string}`): Promise<string | null> {
  try {
    if (!factory) return null;
    const client = getPublicClient();
    const info = await client.readContract({
      address: factory,
      abi: STOCK_MARKET_FACTORY_ABI,
      functionName: "marketInfo",
      args: [marketId],
    });
    const normalized = normalizeStockMarketInfo(info);
    if (!normalized.symbol || normalized.targetPrice === 0n || normalized.endTime === 0n) return null;
    return stockPriceTargetQuestion(
      stockDisplaySymbol(normalized.symbol),
      normalized.targetPrice,
      normalized.above,
      new Date(Number(normalized.endTime) * 1000)
    );
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const site = siteUrl();
  const stockRoute = isStockMarketRoute(id) ? stockMarketFromRoute(id) : null;
  const route = stockRoute ? null : marketFromRoute(id);
  const question = stockRoute
    ? await stockMarketQuestion(stockRoute.id, stockRoute.factory)
    : route
      ? await marketQuestion(route.id, route.factory)
      : null;
  const title = question ? `${question} — TICKR` : `Market ${id} — TICKR`;
  const description = question
    ? stockRoute
      ? `${question} Predict stock prices on TICKR.`
      : `${question} Predict crypto prices on TICKR.`
    : "Crypto Price Prediction League.";

  const safeId = encodeURIComponent(id);
  const ogImage = `${site}/api/social/og/market/${safeId}?v=2&title=${encodeURIComponent(question ?? "TICKR prediction market")}`;
  const url = `${site}/markets/${safeId}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "TICKR",
      type: "website",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    alternates: { canonical: url },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return children;
}

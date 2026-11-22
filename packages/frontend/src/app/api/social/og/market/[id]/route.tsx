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
  isStockMarketRoute,
  stockMarketFromRoute,
  STOCK_MARKET_FACTORY_ABI,
  normalizeStockMarketInfo,
  stockDisplaySymbol,
  stockPriceTargetQuestion,
  stockLogoCandidates,
  type StockListItem,
} from "@/lib/stockMarketContracts";
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

// Stock price target markets are the stock equivalent of the crypto
// TARGET template: a single asset, Yes/No outcomes, one piece of art.
// The helpers below mirror the crypto TARGET artwork path step for
// step, with the stock logo sources in place of the CoinMarketCap id.
//
// The iconUrl for a stock lives on the backend stock list
// (StockListItem.iconUrl). stockMarketApi in lib/stockMarketContracts
// cannot be used from this server route: it builds its URL from
// BACKEND_API_URL in lib/contracts, which is the relative
// "/backend-api" browser proxy path, and a relative fetch URL throws
// on the server. So the list is fetched the way this route already
// fetches backend data server side (the SPREAD fixture fetch above
// and cupDirectory in ../_cup): backendUrl() plus a revalidate hint
// and a 5 second timeout. The response unwrapping accepts both the
// enveloped { stocks } shape and a bare array, exactly like
// stockMarketApi.list does.
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

// Mirror of imageDataUrl in ../_shared, with the stock logo hosts and
// the image types the OG renderer can draw. imageDataUrl itself
// only allows the crypto logo hosts, so it returns null for every
// stock logo URL. The fetch, timeout, size cap and base64 conversion
// are copied from it unchanged. Drawable types are png, jpeg, svg,
// gif and webp, taken from the content-type header when it names
// one and otherwise sniffed from the bytes, because
// metadata.coinbase.com serves its PNG icons as
// binary/octet-stream. The DuckDuckGo league logos are .ico
// files, which the renderer cannot draw and the sniffer does not
// accept, so the walk in
// stockLogoDataUrl skips them and falls through to the next
// candidate (the Coinbase PNG icon), the same candidate walk
// StockLogo performs in the browser on image error. When no
// candidate yields drawable bytes the logo is null and Coins renders
// the symbol text inside the same circle, which is the same fallback
// Coins gives a crypto coin when logoDataUrl returns null.
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

// Single CoinArt for a stock market, in the same shape the crypto
// TARGET branch of artwork() returns: one entry, display symbol,
// logo as a data URL or null. ranked is accepted for parity with
// artwork() and ignored, exactly as the TARGET branch ignores it:
// the art for a single asset market is fixed by the asset itself.
async function stockArtwork(symbol: string, ranked: number[] = []): Promise<CoinArt[]> {
  void ranked;
  const iconUrl = await stockIconUrl(symbol);
  const logo = await stockLogoDataUrl(symbol, iconUrl);
  return [{ symbol: stockDisplaySymbol(symbol), logo }];
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

// Stock branch of GET, mirroring the crypto flow below step for
// step: read marketInfo and marketSettlement from the factory, build
// the question, read outcomeTotals for both outcomes, derive the
// ranked outcomes, build the artwork, derive the outcome line from
// state and winnerBitmap, and render through the same marketCard
// helper with the same status wording the crypto TARGET template
// produces ("PRICE TARGET" while open, "RESOLVED" or "VOIDED" once
// settled). A market id that was never created reads back as zero
// values from the factory, so it is treated as missing and falls
// back to the generic card, and any read failure does the same,
// exactly like the crypto catch block below.
async function stockMarketCard(req: Request, id: string): Promise<Response> {
  const stockRoute = stockMarketFromRoute(id);
  if (!stockRoute) return new Response("Market not found", { status: 404 });
  let title = new URL(req.url).searchParams.get("title") || "TICKR prediction market";
  let card: ImageResponse;
  try {
    const client = getPublicClient();
    const [infoRaw, settlementRaw] = await Promise.all([
      client.readContract({ address: stockRoute.factory, abi: STOCK_MARKET_FACTORY_ABI, functionName: "marketInfo", args: [stockRoute.id] }),
      client.readContract({ address: stockRoute.factory, abi: STOCK_MARKET_FACTORY_ABI, functionName: "marketSettlement", args: [stockRoute.id] }),
    ]);
    const info = normalizeStockMarketInfo(infoRaw);
    if (!info.symbol || info.targetPrice === 0n || info.endTime === 0n) throw new Error("Stock market not found");
    const settlement = settlementRaw as unknown as { state?: number; winnerBitmap?: bigint } & readonly unknown[];
    const state = Number(settlement.state ?? settlement[2] ?? 0);
    const winnerBitmap = BigInt(
      settlement.winnerBitmap ?? (settlement[3] as bigint | number | string | undefined) ?? 0n
    );
    title = stockPriceTargetQuestion(stockDisplaySymbol(info.symbol), info.targetPrice, info.above, new Date(Number(info.endTime) * 1000));
    const labels = ["Yes", "No"];
    const totals = await Promise.all(labels.map((_, i) => client.readContract({ address: stockRoute.factory, abi: STOCK_MARKET_FACTORY_ABI, functionName: "outcomeTotals", args: [stockRoute.id, BigInt(i)] }).catch(() => null)));
    // Do not invent pool leaders when totals could not be read.
    const ranked = totals.every(t => t !== null) ? totals.map((total, i) => ({ total: total!, i })).sort((a, b) => a.total > b.total ? -1 : a.total < b.total ? 1 : a.i - b.i).slice(0, 3).map(t => t.i) : [];
    const coins = await stockArtwork(info.symbol, ranked);
    const winners = labels.filter((_, i) => (winnerBitmap & (1n << BigInt(i))) !== 0n);
    const outcome = state === 2 ? "Market voided · stakes returned" : state === 1 ? `Result: ${winners.join(" · ") || "No winning outcome"}` : undefined;
    card = await marketCard(title, state === 1 ? "RESOLVED" : state === 2 ? "VOIDED" : "PRICE TARGET", coins, outcome);
  } catch (error) {
    console.error("Stock market OG data unavailable", error);
    card = await marketCard(title);
  }
  try {
    return new Response(await card.arrayBuffer(), { headers: card.headers });
  } catch {
    const fallback = await marketCard(title);
    return new Response(await fallback.arrayBuffer(), { headers: fallback.headers });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isStockMarketRoute(id)) return stockMarketCard(req, id);
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

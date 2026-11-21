import { Card, Brand, Coins, type CoinArt } from "../../_design";

import { ImageResponse } from "next/og";
import {
  stockDisplaySymbol,
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
  isNumericId,
} from "../../_shared";

export const runtime = "nodejs";

// One clash as served by GET /api/arena/clashes/:id, the detail
// endpoint in the backend arena router (api/arenaRoutes.ts). The
// route answers { ok: true, data: { clash, userPosition? } }, the
// same envelope as the stock market detail, and the clash itself is
// the ArenaClashSummary from services/arenaClashReader.ts: chain
// fields from the MemeClashFactory plus the names and logos the
// chain does not know, which the reader injects from the BaseStonk
// registry (memes) and the stock list (stock opponents). Only the
// fields this card reads are declared here.
interface ArenaClashOg {
  id: number;
  memeSymbol: string;
  memeName: string | null;
  memeLogoUrl: string | null;
  opponentKind: "stock" | "meme";
  opponentSymbol: string;
  opponentName: string | null;
  opponentLogoUrl: string | null;
  windowDuration: number;
  cupTie: boolean;
  featured: boolean;
  /** 0 Open, 1 Resolved, 2 Voided (market factory state order). */
  state: number;
  status: "upcoming" | "inplay" | "settled" | "voided";
  /** Winning outcome from winnerBitmap once resolved: 0 = Yes, 1 = No. */
  winner: 0 | 1 | null;
  memeMovePct: number | null;
  oppMovePct: number | null;
  liveMemeMovePct: number | null;
  liveOppMovePct: number | null;
}

function displaySymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

// The clash question, verbatim shape from the locked Arena spec and
// arenaClashQuestion in lib/arenaContracts.ts: "Will [MEME]
// outperform [OPPONENT] over the next 24 hours?", with blitz windows
// reading "in the next hour". Mirrored here for the same reason the
// market route builds its questions locally: the OG route never
// pulls the client API layer into a server render.
function clashQuestion(clash: ArenaClashOg): string {
  const meme = displaySymbol(clash.memeSymbol);
  const opponent = displaySymbol(clash.opponentSymbol);
  if (clash.windowDuration === 3600) {
    return `Will ${meme} outperform ${opponent} in the next hour?`;
  }
  return `Will ${meme} outperform ${opponent} over the next 24 hours?`;
}

function moveDetail(movePct: number | null): string | undefined {
  if (movePct === null || !Number.isFinite(movePct)) return undefined;
  const sign = movePct > 0 ? "+" : "";
  return `${sign}${movePct.toFixed(2)}%`;
}

// Server side clash read, following the market route's own backend
// pattern (the SPREAD fixture fetch there and stockIconUrl below):
// backendUrl() plus a revalidate hint and a 5 second timeout. The
// response unwrapping accepts the enveloped { ok, data: { clash } }
// shape the arena router sends, the inner { clash } shape, and a
// bare clash, exactly like arenaApi.clash in lib/arenaContracts.ts.
// A clash whose symbols are missing is treated as not found, the
// same zero value guard the stock branch of the market route applies
// to a market id that was never created.
async function fetchClash(id: string): Promise<ArenaClashOg | null> {
  const res = await fetch(`${backendUrl()}/api/arena/clashes/${id}`, {
    next: { revalidate: 30 },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as
    | { data?: { clash?: ArenaClashOg } }
    | { clash?: ArenaClashOg }
    | ArenaClashOg;
  const clash =
    "data" in payload && payload.data
      ? payload.data.clash
      : "clash" in payload
        ? payload.clash
        : (payload as ArenaClashOg);
  if (!clash || !clash.memeSymbol || !clash.opponentSymbol) return null;
  return clash;
}

// The iconUrl for a stock lives on the backend stock list
// (StockListItem.iconUrl). Copied from stockIconUrl in the market
// route, comment included in substance: stockMarketApi in
// lib/stockMarketContracts cannot be used from this server route
// because it builds its URL from the relative "/backend-api" browser
// proxy path, so the list is fetched server side via backendUrl().
// The unwrapping accepts both the enveloped { stocks } shape and a
// bare array, exactly like stockMarketApi.list does.
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

// Drawable image fetch with byte sniffing, copied from the fixed
// stockImageDataUrl in the market route (the Nov 21 fix). The
// content-type header cannot be trusted on the logo hosts:
// metadata.coinbase.com serves its equity icon PNGs as
// binary/octet-stream, so a header-only gate rejects every real logo
// and the card falls back to symbol text. Trust the header when it
// names a drawable image type; otherwise sniff the actual bytes
// (magic numbers, and the svg open tag) and use the sniffed type for
// the data URL. The fetch, timeout, size cap and base64 conversion
// are copied from the market route unchanged.
//
// Host gating is the one deliberate difference, and it follows the
// market route's own split: the market route gates the crypto logos
// to the CoinMarketCap and CoinGecko hosts in imageDataUrl in
// ../_shared and the stock logos to STOCK_LOGO_HOSTS in
// stockImageDataUrl. Here the stock opponent keeps the exact stock
// host list, passed in as allowedHosts. The meme side passes null:
// a meme logo URL comes from the backend clash payload, which the
// backend registry built from the BaseStonk API (logoUrl, or the
// derived https://api.basestonk.io/api/img/{address} URL), and
// BaseStonk full view records can point at image hosts that are not
// known ahead of time, so any https URL the backend itself served is
// accepted. The protocol is still restricted to https and the size
// cap still applies.
//
// The DuckDuckGo league logos are .ico files, which the renderer
// cannot draw and the sniffer does not accept, so a walk over
// candidates skips them and falls through to the next candidate (the
// Coinbase PNG icon), the same candidate walk StockLogo performs in
// the browser on image error. When no candidate yields drawable
// bytes the logo is null and Coins renders the symbol text inside
// the same circle, which is the same fallback Coins gives a crypto
// coin when logoDataUrl returns null.
const STOCK_LOGO_HOSTS = ["icons.duckduckgo.com", "cdn.simpleicons.org", "metadata.coinbase.com"];
const LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/gif", "image/webp"];

async function arenaImageDataUrl(url: string, allowedHosts: string[] | null): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (allowedHosts && !allowedHosts.includes(parsed.hostname)) return null;
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
    const headerType = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    let contentType = headerType && LOGO_CONTENT_TYPES.includes(headerType) ? headerType : null;
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

// Meme logo walk. The clash payload carries exactly one meme image
// field, memeLogoUrl, which the backend reader fills from the
// registry entry's logoUrl (the BaseStonk full view logoUrl, or the
// derived BaseStonk img URL when the API sent none). There is no
// second meme candidate in the payload, so the walk is that single
// URL, then null and the Coins symbol text fallback.
async function memeLogoDataUrl(logoUrl: string | null): Promise<string | null> {
  if (!logoUrl?.trim()) return null;
  return arenaImageDataUrl(logoUrl.trim(), null);
}

// Stock opponent logo walk, mirroring stockLogoDataUrl in the market
// route: stockLogoCandidates from lib/stockMarketContracts gives the
// order, league logoPath first (DuckDuckGo or Simple Icons for the
// 12 league stocks), then the iconUrl. Two icon sources feed that
// second slot, in order: the clash payload's opponentLogoUrl, which
// the backend reader took from the stock list, and the stock list
// iconUrl fetched here, when it differs. The .ico league candidates
// fail the sniffer and the walk continues, exactly as in the market
// route.
async function stockOpponentLogoDataUrl(clash: ArenaClashOg): Promise<string | null> {
  const listIconUrl = await stockIconUrl(clash.opponentSymbol);
  const candidates: string[] = [];
  for (const iconUrl of [clash.opponentLogoUrl, listIconUrl]) {
    for (const candidate of stockLogoCandidates(clash.opponentSymbol, iconUrl)) {
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }
  }
  for (const candidate of candidates) {
    const data = await arenaImageDataUrl(candidate, STOCK_LOGO_HOSTS);
    if (data) return data;
  }
  return null;
}

// Both sides of the clash as CoinArt, in the same shape artwork() in
// the market route returns: meme first, opponent second, display
// symbols, logo as a data URL or null. The detail line carries the
// percent move Coins renders under the symbol: the live move while
// in play, the settled move once resolved, nothing before the
// window starts. A meme opponent walks the meme logo path, a stock
// opponent walks the stock candidate chain.
async function clashArtwork(clash: ArenaClashOg): Promise<CoinArt[]> {
  const memeMove = clash.status === "inplay" ? clash.liveMemeMovePct : clash.memeMovePct;
  const oppMove = clash.status === "inplay" ? clash.liveOppMovePct : clash.oppMovePct;
  const [memeLogo, opponentLogo] = await Promise.all([
    memeLogoDataUrl(clash.memeLogoUrl),
    clash.opponentKind === "stock"
      ? stockOpponentLogoDataUrl(clash)
      : memeLogoDataUrl(clash.opponentLogoUrl),
  ]);
  return [
    { symbol: displaySymbol(clash.memeSymbol), logo: memeLogo, detail: moveDetail(memeMove) },
    {
      symbol:
        clash.opponentKind === "stock"
          ? stockDisplaySymbol(clash.opponentSymbol)
          : displaySymbol(clash.opponentSymbol),
      logo: opponentLogo,
      detail: moveDetail(oppMove),
    },
  ];
}

// The marketCard composition from the market route, kept line for
// line in structure: Brand plus the status line on top, the question
// as the headline with the outcome line under it, Coins beside the
// text, and the same footer. The footer tagline is the one wording
// change, naming the Arena the card belongs to. Cache behaviour
// matches the market route: a card with an outcome line is final and
// takes OG_FINAL_CACHE, a live card takes OG_LIVE_CACHE.
async function clashCard(title: string, status = "MEME CLASH", coins: CoinArt[] = [], outcome?: string) {
  return new ImageResponse(<Card>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><Brand /><span style={{ color: "#9ac2ff", fontSize: 18 }}>{status}</span></div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 38 }}>
      <div style={{ display: "flex", flexDirection: "column", width: coins.length ? 660 : 1050, gap: 24 }}>
        <div style={{ fontSize: title.length > 100 ? 42 : 49, lineHeight: 1.15, fontWeight: 800 }}>{title}</div>
        {outcome && <div style={{ fontSize: 27, color: "#7fe0bd" }}>{outcome}</div>}
      </div>
      <Coins coins={coins} />
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #365171", paddingTop: 20, color: "#9bb0cc", fontSize: 19 }}><span>Will the meme outperform the stock?</span><span>{ogBaseUrl().replace(/^https?:\/\//, "")}</span></div>
  </Card>, { width: OG_WIDTH, height: OG_HEIGHT, headers: { "Cache-Control": outcome ? OG_FINAL_CACHE : OG_LIVE_CACHE } });
}

// Status wording, mirroring the market route's derivation: RESOLVED
// or VOIDED once settled, otherwise the clash kind, where the crypto
// route shows the template name. A cup tie outranks the blitz tag,
// and a live clash reads LIVE, the state the market route has no
// word for because its markets have no in-play window.
function clashStatus(clash: ArenaClashOg): string {
  if (clash.state === 1) return "RESOLVED";
  if (clash.state === 2) return "VOIDED";
  if (clash.cupTie) return "MEME CUP";
  if (clash.status === "inplay") return "LIVE CLASH";
  if (clash.windowDuration === 3600) return "BLITZ CLASH";
  return "MEME CLASH";
}

// GET, mirroring the market route's GET step for step: the title
// starts from the ?title= param the clash layout sends, the clash is
// read, the question replaces the title, the artwork is built, the
// outcome line is derived from state and winner with the market
// route's exact outcome wording ("Result: ..." once resolved,
// "Market voided · stakes returned" once voided), and any read
// failure falls back to the generic card, exactly like the market
// route's catch block. The winner label comes from the payload's
// winner field (0 = Yes, the meme outperformed, 1 = No), which the
// backend reader derived from winnerBitmap alone.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isNumericId(id)) return new Response("Clash not found", { status: 404 });
  let title = new URL(req.url).searchParams.get("title") || "TICKR prediction market";
  let card: ImageResponse;
  try {
    const clash = await fetchClash(id);
    if (!clash) throw new Error("Arena clash not found");
    title = clashQuestion(clash);
    const coins = await clashArtwork(clash);
    const outcome =
      clash.state === 2
        ? "Market voided · stakes returned"
        : clash.state === 1
          ? `Result: ${clash.winner === 0 ? "Yes" : clash.winner === 1 ? "No" : "No winning outcome"}`
          : undefined;
    card = await clashCard(title, clashStatus(clash), coins, outcome);
  } catch (error) {
    console.error("Clash OG data unavailable", error);
    card = await clashCard(title);
  }
  try {
    return new Response(await card.arrayBuffer(), { headers: card.headers });
  } catch {
    const fallback = await clashCard(title);
    return new Response(await fallback.arrayBuffer(), { headers: fallback.headers });
  }
}

/**
 * Shared helpers for the dynamic OG image routes (/api/og/*).
 * Underscore-prefixed so Next.js doesn't treat it as a route.
 *
 * The OG images mirror the app's desktop cards:
 *  - Unresolved match: teams, VS / live score, matchday, pool size
 *  - Resolved match: FT score, winner, payout distributed
 *  - Unresolved market: question, outcomes + odds, creator, close time
 *  - Resolved market: question, winning outcome, resolver, creator
 */

import "server-only";

/** Standard OG image dimensions. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** TICKR brand palette (matches the app's dark theme). */
export const OG_COLORS = {
  bg: "#0B1B3D",
  bgAlt: "#0E2247",
  card: "#13294F",
  accent: "#2E7CF6",
  accentDark: "#1D4ED8",
  green: "#1D9E75",
  greenLight: "#7FE0BD",
  red: "#EF4444",
  amber: "#F59E0B",
  white: "#FFFFFF",
  zinc100: "#F4F4F5",
  zinc400: "#A1A1AA",
  zinc500: "#71717A",
} as const;

/** Production origin — used when no env var pins the site URL. */
const PRODUCTION_SITE_URL = "https://tickr-rouge.vercel.app";

/** Canonical frontend origin for absolute metadata and links. */
export function siteUrl(): string {
  const v =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    // Vercel's auto-provided canonical production domain (set on prod deploys).
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    PRODUCTION_SITE_URL;
  try {
    const url = new URL(v.startsWith("http://") || v.startsWith("https://") ? v : `https://${v}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return PRODUCTION_SITE_URL;
    return url.origin;
  } catch {
    return PRODUCTION_SITE_URL;
  }
}

/** Base URL for absolute links in OG cards (no trailing slash). */
export const ogBaseUrl = siteUrl;

/** Accept canonical non-negative decimal identifiers only. */
export function isNumericId(id: string): boolean {
  return /^(0|[1-9]\d{0,77})$/.test(id);
}

/** Backend API base (server-side only). */
export function backendUrl(): string {
  return (process.env.BACKEND_API_URL || "https://tickr-backend-3aca.onrender.com").replace(/\/$/, "");
}

/** CoinMarketCap static logo (absolute URL, works in OG renders). */
export function teamLogoUrl(cmcId: number | null | undefined): string | null {
  if (typeof cmcId === "number" && cmcId > 0) {
    return `https://s2.coinmarketcap.com/static/img/coins/64x64/${cmcId}.png`;
  }
  return null;
}


export function shortAddress(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/** Format a TICK amount (wei string) for display, e.g. "1,250". */
export function formatTickShort(wei: string | bigint | null | undefined): string {
  if (wei === null || wei === undefined) return "0";
  try {
    const n = Number(BigInt(wei)) / 1e18;
    return n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 });
  } catch {
    return "0";
  }
}

/** Look up a username by wallet address via Supabase (null when unknown). */
export async function usernameForAddress(
  address: string
): Promise<string | null> {
  try {
    const url = new URL(
      `/api/social/profiles/by-wallet/${encodeURIComponent(address)}?usernameOnly=1`,
      siteUrl()
    );
    const response = await fetch(url, { next: { revalidate: 60 } });
    if (!response.ok) return null;
    const data = (await response.json()) as { username?: unknown };
    const u = typeof data.username === "string" ? data.username.trim() : "";
    return u ? `@${u.replace(/^@/, "")}` : null;
  } catch {
    return null;
  }
}

/** Display handle: @username when known, else truncated address. */
export async function handleForAddress(address: string): Promise<string> {
  return (await usernameForAddress(address)) ?? shortAddress(address);
}

/**
 * Fetch a team logo and embed as a data URL. Satori fetches <img> srcs
 * during render — a slow or blocked CDN would kill the whole image, so we
 * pre-fetch here with a short timeout and fall back to null (the card then
 * renders the letter avatar instead). Never throws.
 */
export async function logoDataUrl(cmcId: number | null | undefined): Promise<string | null> {
  if (typeof cmcId !== "number" || cmcId <= 0) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`https://s2.coinmarketcap.com/static/img/coins/64x64/${cmcId}.png`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > 200_000) return null;
    // btoa, not Buffer — Buffer doesn't exist on the edge runtime.
    const bytes = new Uint8Array(buf);
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

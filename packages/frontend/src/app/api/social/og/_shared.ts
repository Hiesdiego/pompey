

import "server-only";
import { siteUrl } from "../../../../lib/siteUrl";


export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;


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


export { siteUrl };


export const ogBaseUrl = siteUrl;



export function isNumericId(id: string): boolean {
  return /^(0|[1-9]\d{0,77})$/.test(id);
}


export function backendUrl(): string {
  return (process.env.BACKEND_API_URL || "https://tickr-backend-3aca.onrender.com").replace(/\/$/, "");
}


export function teamLogoUrl(cmcId: number | null | undefined): string | null {
  if (typeof cmcId === "number" && cmcId > 0) {
    return `https://s2.coinmarketcap.com/static/img/coins/64x64/${cmcId}.png`;
  }
  return null;
}


export function shortAddress(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}


export function formatTickShort(wei: string | bigint | null | undefined): string {
  if (wei === null || wei === undefined) return "0";
  try {
    const n = Number(BigInt(wei)) / 1e18;
    return n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 });
  } catch {
    return "0";
  }
}


export async function usernameForAddress(
  address: string
): Promise<string | null> {
  try {
    const url = new URL(
      `/api/social/profiles/by-wallet/${encodeURIComponent(address)}?usernameOnly=1`,
      siteUrl()
    );
    const response = await fetch(url, { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data = (await response.json()) as { username?: unknown };
    const u = typeof data.username === "string" ? data.username.trim() : "";
    return u ? `@${u.replace(/^@/, "")}` : null;
  } catch {
    return null;
  }
}


export async function handleForAddress(address: string): Promise<string> {
  return (await usernameForAddress(address)) ?? shortAddress(address);
}


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

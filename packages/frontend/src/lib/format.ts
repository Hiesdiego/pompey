/**
 * Formatting helpers shared across the TICKR frontend.
 */

import { formatUnits, parseUnits } from "viem";
import { TICK_DECIMALS } from "./contracts";
import { OUTCOME } from "@tickr/shared/constants";
import { integerString } from "./integerString";

/** "1234.56" from 18-decimal TICK wei. */
export function formatTick(wei: bigint | string | null | undefined, digits = 2): string {
  if (wei === null || wei === undefined) return "—";
  const normalized = typeof wei === "string" ? integerString(wei) : null;
  if (typeof wei === "string" && normalized === null) return "—";
  const v = typeof wei === "string" ? BigInt(normalized!) : wei;
  const s = formatUnits(v, TICK_DECIMALS);
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Parse a user-typed TICK amount into wei. Returns null when invalid. */
export function parseTickInput(input: string): bigint | null {
  const t = input.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  try {
    const v = parseUnits(t, TICK_DECIMALS);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export function truncateAddress(addr: string, chars = 4): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

/** +2.35% / -0.40% */
export function formatSignedPct(pct: number, digits = 2): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}

/**
 * Round a raw % change to goals exactly like
 * PriceOracle._roundedPercentChange (v0.3: 1 goal = 0.5%, round-half-up on
 * |bps| at the 25bps threshold).
 */
export function roundPctLikeOracle(pct: number): number {
  const bps = Math.round(Math.abs(pct) * 100);
  const goals = Math.floor((bps + 25) / 50);
  return pct < 0 ? -goals : goals;
}

/**
 * Mirror of PriceOracle._normalizeScoreline: no negative scorelines.
 * Each side's negative goals become plus-goals for the opponent
 * (e.g. 0:-1 -> 1:0). Margin-preserving, so winners are unaffected.
 */
export function normalizeScoreline(homeGoals: number, awayGoals: number): [number, number] {
  const home = Math.max(0, homeGoals) + Math.max(0, -awayGoals);
  const away = Math.max(0, awayGoals) + Math.max(0, -homeGoals);
  return [home, away];
}

export const OUTCOME_LABELS = ["Home win", "Draw", "Away win"] as const;
export const OUTCOME_SHORT = ["1", "X", "2"] as const;

export function outcomeLabel(o: number): string {
  return OUTCOME_LABELS[o] ?? "Unknown";
}

/** Compact countdown parts from a millisecond delta. */
export function countdownParts(ms: number): { d: number; h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

/** "2d 4h", "3h 12m", "04:33" style human countdown. */
export function formatCountdown(ms: number): string {
  const { d, h, m, s } = countdownParts(ms);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function isoToMs(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Win rate as "62.5%" from PlayerStats winRateBps (string). */
export function formatWinRateBps(bps: string | null | undefined): string {
  if (!bps) return "—";
  return `${(Number(bps) / 100).toFixed(1)}%`;
}

export { OUTCOME };

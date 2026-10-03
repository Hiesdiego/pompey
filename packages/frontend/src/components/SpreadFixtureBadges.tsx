"use client";

import { decodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import { TEMPLATES } from "../lib/marketFactory";
import type { ApiFixture } from "../lib/api";
import { TeamBadge } from "./TeamBadge";
import { cn } from "../lib/cn";

export interface SpreadFixture {
  fixtureId: string;
  spread: number;
  home: { teamId: number; name: string; symbol: string } | null;
  away: { teamId: number; name: string; symbol: string } | null;
}

/**
 * Extract the fixture (home/away teams) backing a SPREAD market.
 * Works with both ApiFixture[] and Map<string, ApiFixture>.
 */
export function getSpreadFixture(
  market: { templateId: number; params: string },
  fixtures: ApiFixture[] | Map<string, ApiFixture>
): SpreadFixture | null {
  if (market.templateId !== TEMPLATES.SPREAD) return null;
  try {
    const [, fixtureId, spread] = decodeAbiParameters(
      parseAbiParameters("uint256, uint256, int16"),
      market.params as Hex
    );
    const f = Array.isArray(fixtures)
      ? fixtures.find((x) => x.fixtureId === fixtureId.toString())
      : fixtures.get(fixtureId.toString());
    if (!f?.home || !f?.away) return null;
    return {
      fixtureId: fixtureId.toString(),
      spread,
      home: f.home,
      away: f.away,
    };
  } catch {
    return null;
  }
}

/**
 * Coin logos + names for the fixture behind a SPREAD market.
 * Use on market cards (home, markets list) so users see which coins
 * the spread is about without reading the question text.
 */
export function SpreadFixtureBadges({
  market,
  fixtures,
  size = 28,
  className,
}: {
  market: { templateId: number; params: string };
  fixtures: ApiFixture[] | Map<string, ApiFixture>;
  size?: number;
  className?: string;
}) {
  const info = getSpreadFixture(market, fixtures);
  if (!info?.home || !info?.away) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5", className)}>
      <span className="inline-flex items-center gap-1.5">
        <TeamBadge teamId={info.home.teamId} size={size} showName={false} />
        <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
          {info.home.symbol}
        </span>
      </span>
      <span className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-400">
        vs
      </span>
      <span className="inline-flex items-center gap-1.5">
        <TeamBadge teamId={info.away.teamId} size={size} showName={false} />
        <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
          {info.away.symbol}
        </span>
      </span>
      <span className="rounded-lg bg-rose-500/10 px-2 py-0.5 text-[11px] font-extrabold text-rose-600 dark:text-rose-400">
        {info.spread > 0
          ? `−${Math.abs(info.spread)}`
          : info.spread < 0
            ? `+${Math.abs(info.spread)}`
            : "PK"}
      </span>
    </div>
  );
}

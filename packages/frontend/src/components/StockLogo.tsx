/**
 * StockLogo, the stock equivalent of the crypto coin logo.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/StockLogo.tsx
 *
 * It sits in exactly the slot TeamBadge occupies on crypto surfaces:
 * the MarketCard target-coin row, the detail hero outcome stack, the
 * odds rows and the create picker rows. Same size prop, same rounded
 * treatment, so swapping a crypto card for a stock card moves nothing.
 *
 * Logo source order (locked spec):
 *   1. the verified remote logo in lib/stockTeams.ts for the 12 league
 *      stocks
 *   2. the iconUrl from the dynamic list API (metadata.coinbase.com PNG)
 *   3. the letter avatar, never a broken image, never an invented URL
 *
 * Rendering uses a plain img element with an onError walk, exactly the
 * StockTeamBadge pattern in components/StockLeagueTable.tsx. It does
 * NOT use next/image: next.config.mjs only allows
 * assets.coingecko.com in images.remotePatterns, so next/image would
 * reject the DuckDuckGo, Simple Icons and metadata.coinbase.com hosts.
 * See the delivery report for the exact next.config change that would
 * let this component switch to next/image later.
 */

"use client";

import { useEffect, useState } from "react";
import { stockLogoCandidates, stockDisplaySymbol } from "../lib/stockMarketContracts";
import { cn } from "../lib/cn";

export function StockLogo({
  symbol,
  iconUrl,
  size = 40,
  className = "",
}: {
  symbol: string;
  iconUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const candidates = stockLogoCandidates(symbol, iconUrl);
  const [stage, setStage] = useState(0);

  // Reset the walk when the stock or its API icon changes.
  useEffect(() => {
    setStage(0);
  }, [symbol, iconUrl]);

  const display = stockDisplaySymbol(symbol);
  if (stage < candidates.length) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={candidates[stage]}
        src={candidates[stage]}
        alt={display}
        width={size}
        height={size}
        onError={() => setStage((s) => s + 1)}
        className={cn("shrink-0 rounded-full bg-white object-contain ring-1 ring-black/10 dark:ring-white/10", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2E7CF6] to-[#1D4ED8] font-display font-bold text-white shadow-[0_0_12px_rgba(46,124,246,.35)]",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-label={display}
    >
      {display.slice(0, 1)}
    </span>
  );
}

/**
 * Stock badge with an optional name and symbol, the direct analogue of
 * TeamBadge for stock surfaces. Used on the detail hero and the create
 * summary, where crypto shows TeamBadge with showName.
 */
export function StockBadge({
  symbol,
  name,
  iconUrl,
  size = 32,
  showName = true,
  showSymbol = false,
  className = "",
}: {
  symbol: string;
  name?: string;
  iconUrl?: string | null;
  size?: number;
  showName?: boolean;
  showSymbol?: boolean;
  className?: string;
}) {
  const display = stockDisplaySymbol(symbol);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <StockLogo symbol={symbol} iconUrl={iconUrl} size={size} />
      {showName && (
        <span className="font-semibold text-zinc-800 dark:text-zinc-100">{name ?? display}</span>
      )}
      {showSymbol && <span className="text-xs text-zinc-500">{display}</span>}
    </span>
  );
}

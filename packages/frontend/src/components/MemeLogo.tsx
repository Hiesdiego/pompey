/**
 * MemeLogo, the meme equivalent of the stock coin logo.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/MemeLogo.tsx
 *
 * It sits in exactly the slot StockLogo occupies on stock surfaces:
 * clash cards, the clash detail hero, the create picker rows and the
 * arena rankings table. Same size prop, same rounded treatment, so
 * swapping a stock card for a meme card moves nothing.
 *
 * Logo source order:
 *   1. logoUrl from the backend (registry or clash summary)
 *   2. imageUrl from the backend, when it differs
 *   3. the letter avatar, never a broken image, never an invented URL
 *
 * Rendering uses a plain img element with an onError walk, exactly the
 * StockLogo pattern. It does NOT use next/image, for the same reason
 * StockLogo does not: the meme image hosts are not in
 * images.remotePatterns in next.config.mjs.
 */

"use client";

import { useEffect, useState } from "react";
import { arenaDisplaySymbol } from "../lib/arenaContracts";
import { cn } from "../lib/cn";

export function memeLogoCandidates(
  logoUrl?: string | null,
  imageUrl?: string | null
): string[] {
  const out: string[] = [];
  for (const candidate of [imageUrl, logoUrl]) {
    if (!candidate?.trim()) continue;
    let url = candidate.trim();
    if (url.startsWith("ipfs://")) url = `https://ipfs.io/ipfs/${url.slice(7).replace(/^ipfs\//, "")}`;
    else if (url.startsWith("/")) url = new URL(url, "https://basestonk.io").href;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

export function MemeLogo({
  symbol,
  logoUrl,
  imageUrl,
  size = 40,
  className = "",
}: {
  symbol: string;
  logoUrl?: string | null;
  imageUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const candidates = memeLogoCandidates(logoUrl, imageUrl);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    setStage(0);
  }, [symbol, logoUrl, imageUrl]);

  const display = arenaDisplaySymbol(symbol || "?");
  if (stage < candidates.length) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={candidates[stage]}
        src={candidates[stage]}
        alt={display}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setStage((s) => s + 1)}
        className={cn("shrink-0 rounded-full bg-white object-cover ring-1 ring-black/10 dark:ring-white/10", className)}
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
 * Meme badge with an optional name and symbol, the direct analogue of
 * StockBadge for meme surfaces. Used on the detail hero and the create
 * summary, where stock shows StockBadge with showName.
 */
export function MemeBadge({
  symbol,
  name,
  logoUrl,
  imageUrl,
  size = 32,
  showName = true,
  showSymbol = false,
  className = "",
}: {
  symbol: string;
  name?: string;
  logoUrl?: string | null;
  imageUrl?: string | null;
  size?: number;
  showName?: boolean;
  showSymbol?: boolean;
  className?: string;
}) {
  const display = arenaDisplaySymbol(symbol);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <MemeLogo symbol={symbol} logoUrl={logoUrl} imageUrl={imageUrl} size={size} />
      {showName && (
        <span className="font-semibold text-zinc-800 dark:text-zinc-100">{name ?? display}</span>
      )}
      {showSymbol && <span className="text-xs text-zinc-500">{display}</span>}
    </span>
  );
}

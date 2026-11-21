"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, ShieldCheck } from "lucide-react";
import {
  ARENA_CLASH_FACTORY_ADDRESS,
  ARENA_SPIKE_LIMIT_PCT,
  arenaDisplaySymbol,
  type ClashDetail,
} from "../lib/arenaContracts";
import { ACTIVE_CHAIN } from "../lib/contracts";
import { formatSignedPct } from "../lib/format";

/**
 * ArenaOracleAuditCard, full-time audit for meme clashes.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/ArenaOracleAuditCard.tsx
 *
 * This is the Arena mirror of StockOracleAuditCard in
 * ./StockOracleAuditCard.tsx: same layout, same copy-or-explorer
 * address box, same window start and window end rows with the percent
 * change, same settled scoreline paragraph. It cannot reuse the stock
 * card directly because that card is typed on StockApiFixture and a
 * bigint oracle snapshot at 1e8 from the StockPriceOracle. A clash
 * carries its four snapshot prices on the clash detail itself, as
 * decimal USD strings submitted by the resolver to the
 * MemeClashFactory, so this card takes the clash detail.
 *
 * Locked Arena content in this card: the snapshot sources are named
 * per side (meme from BaseStonk priceUsd, a stock opponent from the
 * Coinbase NAV source, a meme opponent from BaseStonk priceUsd), and
 * the breaker is explained: a raw move of 30 percent or more on either
 * side voids the clash and stakes refund 1:1, and a missing snapshot
 * price also voids.
 */

function priceLabel(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "pending";
  const n = Number(value);
  if (!Number.isFinite(n)) return "pending";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function priceChange(start: string | number | null, end: string | number | null): number | null {
  if (start === null || end === null) return null;
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s <= 0) return null;
  return ((e - s) / s) * 100;
}

export function ArenaOracleAuditCard({
  clash, scoreline,
}: {
  clash: ClashDetail;
  scoreline: { memeGoals: number; oppGoals: number } | null;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const factory = ARENA_CLASH_FACTORY_ADDRESS;
  const explorer = ACTIVE_CHAIN.blockExplorers?.default.url;
  const settled =
    clash.memeStartPrice !== null && clash.memeEndPrice !== null &&
    clash.oppStartPrice !== null && clash.oppEndPrice !== null;
  const memeName = clash.memeName ?? arenaDisplaySymbol(clash.memeSymbol);
  const oppName = clash.opponentName ?? arenaDisplaySymbol(clash.opponentSymbol);
  const oppSource = clash.opponentKind === "stock" ? "Coinbase NAV" : "BaseStonk priceUsd";
  const rows = [
    { name: memeName, source: "BaseStonk priceUsd", start: clash.memeStartPrice, end: clash.memeEndPrice, move: clash.memeMovePct },
    { name: oppName, source: oppSource, start: clash.oppStartPrice, end: clash.oppEndPrice, move: clash.oppMovePct },
  ];

  const copyAddress = async () => {
    if (!factory) return;
    try {
      await navigator.clipboard.writeText(factory);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return <section className="glass mb-6 rounded-3xl p-5 sm:p-6" aria-labelledby="arena-audit-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[.18em] text-[#1D4ED8] dark:text-[#7db3ff]"><ShieldCheck className="h-4 w-4" /> Full-time audit</p>
        <h2 id="arena-audit-title" className="mt-1 font-display text-lg font-extrabold">Check the result yourself</h2>
      </div>
      <span className="rounded-full bg-[#2E7CF6]/10 px-3 py-1 text-xs font-bold text-[#1D4ED8] dark:text-[#7db3ff]">{ACTIVE_CHAIN.name} · Clash {clash.id}</span>
    </div>

    <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
      The result is calculated by the MemeClashFactory contract from the four snapshot prices submitted by TICKR&apos;s authorized resolver.
      The meme price comes from BaseStonk priceUsd. {clash.opponentKind === "stock" ? "The stock opponent price comes from the Coinbase NAV source." : "The opponent meme price also comes from BaseStonk priceUsd."} The on-chain record makes the inputs and the percent comparison auditable, but does not independently prove the external prices were correct.
      Breaker: a raw move of {ARENA_SPIKE_LIMIT_PCT} percent or more on either side inside the window voids the clash, the scoreline is ignored and stakes are refunded 1:1. A missing snapshot price also voids the clash, with the same refund.
    </p>

    {settled ? <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {rows.map((row) => {
        const change = row.move ?? priceChange(row.start, row.end);
        return <div key={row.name} className="rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
          <p className="mb-2 text-sm font-bold">{row.name} <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">· {row.source}</span></p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-zinc-500">Window start</dt><dd className="text-right font-mono tabular-nums">{priceLabel(row.start)}</dd>
            <dt className="text-zinc-500">Window end</dt><dd className="text-right font-mono tabular-nums">{priceLabel(row.end)}</dd>
            <dt className="text-zinc-500">Change</dt><dd className="text-right font-bold tabular-nums">{change === null ? "–" : formatSignedPct(change)}</dd>
          </dl>
        </div>;
      })}
    </div> : <p className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">The snapshot prices could not be loaded here. Open the contract below to inspect this clash directly.</p>}

    {scoreline ? <p className="mt-3 text-sm">Settled scoreline <strong className="font-display tabular-nums">{scoreline.memeGoals}–{scoreline.oppGoals}</strong>. One goal equals 0.5% price movement, half-up, with no negative scores. Yes wins only when the meme percent move is strictly greater than the opponent move, an exact tie is No, and the winner is read from the raw moves, not the rounded goals. The scoreline comes from the backend clash record; check the contract&apos;s events for this clash on the explorer to verify it on-chain.</p> : <p className="mt-3 text-xs text-zinc-500">The settled scoreline is unavailable in this view. Check the contract&apos;s events for this clash on the explorer.</p>}

    <div className="mt-4 rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">MemeClashFactory contract address</p>
      {factory ? <div className="mt-1 flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all text-xs font-semibold">{factory}</code>
        <button type="button" onClick={() => void copyAddress()} className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-2 py-1 text-xs font-semibold hover:text-[#1D4ED8] dark:border-white/10" aria-label="Copy factory contract address"><Copy className="h-3.5 w-3.5" /> {copyStatus === "copied" ? "Copied" : "Copy"}</button>
      </div> : <p className="mt-1 text-xs text-zinc-500">Factory address is not configured for this deployment.</p>}
      {copyStatus === "failed" && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Could not copy. Select the address above to copy it manually.</p>}
    </div>
    <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold">
      {factory && explorer && <a href={`${explorer}/address/${factory}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#1D4ED8] hover:underline dark:text-[#7db3ff]">View factory contract <ExternalLink className="h-3.5 w-3.5" /></a>}
      <Link href="/about#audit" className="text-[#1D4ED8] hover:underline dark:text-[#7db3ff]">How the result is calculated</Link>
    </div>
  </section>;
}

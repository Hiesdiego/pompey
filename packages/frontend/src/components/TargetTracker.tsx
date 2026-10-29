"use client";

import { useMemo, useState } from "react";
import { Target } from "lucide-react";
import { useSharedPrices } from "../lib/price/useSharedPrices";
import { decodeTargetTerms, formatUsd } from "../lib/targetMarket";
import { formatPriceTargetTimeUtc } from "../lib/priceTargetQuestion";
import { formatUtcTime } from "../lib/utcTime";
import { TradingViewChart } from "./TradingViewChart";

export function TargetTracker({ params, symbol, settled = false }: {
  params: `0x${string}`;
  symbol: string;
  settled?: boolean;
}) {
  const terms = useMemo(() => decodeTargetTerms(params), [params]);
  const [chartOpen, setChartOpen] = useState(false);
  const { prices, status, updatedAt } = useSharedPrices(!settled);
  const symbolUpdatedAt = updatedAt[symbol] ?? 0;
  const price = status !== "stale" && Date.now() - symbolUpdatedAt < 60_000 && !settled ? prices[symbol] : undefined;

  if (!terms) return null;

  const distance = price === undefined ? null : price - terms.target;
  const yesNow = price === undefined ? null : terms.above ? price >= terms.target : price <= terms.target;

  return <section className="mb-6 overflow-hidden rounded-[1.75rem] border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[.08] via-white to-blue-500/[.04] p-5 dark:via-[#101821] sm:p-7" aria-label="Price target tracker">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.17em] text-emerald-600 dark:text-emerald-400"><Target className="h-4 w-4" /> Target tracker</p><h2 className="mt-2 font-display text-2xl font-black">{symbol} <span className="text-zinc-400">/</span> USD</h2></div>
      <span className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-bold dark:border-white/10">{settled ? "Settled" : status === "stale" ? "Price unavailable" : status === "live" ? "Live spot price" : "Updating spot price"}</span>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl bg-white/80 p-4 dark:bg-white/[.05]"><p className="text-xs font-semibold text-zinc-500">Current spot</p><p className="mt-1 font-display text-2xl font-black tabular-nums">{price === undefined ? "—" : formatUsd(price)}</p></div>
      <div className="rounded-2xl bg-white/80 p-4 dark:bg-white/[.05]"><p className="text-xs font-semibold text-zinc-500">{terms.above ? "Finish at or above" : "Finish at or below"}</p><p className="mt-1 font-display text-2xl font-black tabular-nums">{formatUsd(terms.target)}</p></div>
      <div className="rounded-2xl bg-white/80 p-4 dark:bg-white/[.05]"><p className="text-xs font-semibold text-zinc-500">Distance to target</p><p className="mt-1 font-display text-2xl font-black tabular-nums">{distance === null ? "—" : `${distance >= 0 ? "+" : "−"}${formatUsd(Math.abs(distance))}`}</p><p className="text-xs text-zinc-500">{distance === null ? "Waiting for a fresh price" : `${Math.abs(distance / terms.target * 100).toFixed(2)}% ${distance >= 0 ? "above" : "below"} target`}</p></div>
    </div>
    <details onToggle={(event) => setChartOpen(event.currentTarget.open)} className="group mt-4 rounded-2xl border border-black/[.06] bg-white/70 p-3 dark:border-white/[.07] dark:bg-black/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-display text-sm font-bold marker:hidden"><span>Recent price movements</span><span className="text-xs font-semibold text-[#2E7CF6] group-open:hidden">Show chart</span><span className="hidden text-xs font-semibold text-[#2E7CF6] group-open:inline">Hide chart</span></summary>
      <div className="mt-3">
        {chartOpen && <TradingViewChart teamId={terms.teamId} height={280} />}
        <div className="flex flex-wrap justify-between gap-1 text-[11px] font-semibold text-zinc-500"><span>TradingView · spot market · 5-minute chart</span><span className="text-emerald-600">Target: {formatUsd(terms.target)}</span></div>
      </div>
    </details>
    <p className="mt-3 text-sm font-semibold">{yesNow === null ? "Waiting for a fresh spot quote" : yesNow ? "Yes is currently on side" : "No is currently on side"} <span className="font-normal text-zinc-500">· The result uses the latest available hourly oracle checkpoint at or before {formatPriceTargetTimeUtc(new Date(terms.atTime * 1000))}. {symbolUpdatedAt && !settled ? `Spot updated ${formatUtcTime(symbolUpdatedAt)}.` : ""}</span></p>
  </section>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Target, TrendingUp } from "lucide-react";
import { BACKEND_API_URL } from "../lib/contracts";
import { usePriceFeed } from "../lib/price/usePriceFeed";
import { decodeTargetTerms, formatUsd } from "../lib/targetMarket";

type Point = { t: number; p: number };

export function TargetTracker({ params, symbol, settled = false }: {
  params: `0x${string}`;
  symbol: string;
  settled?: boolean;
}) {
  const terms = useMemo(() => decodeTargetTerms(params), [params]);
  const { prices, status, updatedAt } = usePriceFeed(!settled);
  const [history, setHistory] = useState<Point[]>([]);
  const symbolUpdatedAt = updatedAt[symbol] ?? 0;
  const price = status !== "stale" && Date.now() - symbolUpdatedAt < 60_000 && !settled ? prices[symbol] : undefined;

  useEffect(() => {
    let alive = true;
    if (!symbol || settled) return;
    setHistory([]);
    fetch(`${BACKEND_API_URL}/api/price-history/${encodeURIComponent(symbol)}`, {
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.ok ? r.json() : null).then((rows: Point[] | null) => {
      if (alive && Array.isArray(rows)) setHistory(rows.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.p)));
    }).catch(() => {});
    return () => { alive = false; };
  }, [symbol, settled]);

  const points = useMemo(() => {
    if (!price) return history;
    return [...history.filter((p) => p.t < Date.now() - 60_000), { t: Date.now(), p: price }];
  }, [history, price]);
  if (!terms) return null;

  const distance = price === undefined ? null : price - terms.target;
  const yesNow = price === undefined ? null : terms.above ? price >= terms.target : price <= terms.target;
  const min = Math.min(terms.target, ...points.map((p) => p.p));
  const max = Math.max(terms.target, ...points.map((p) => p.p));
  const span = Math.max(max - min, terms.target * 0.001);
  const y = (value: number) => 104 - ((value - min) / span) * 88;
  const x = (i: number) => points.length < 2 ? 300 : 12 + (i / (points.length - 1)) * 576;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");

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
    <div className="mt-4 rounded-2xl border border-black/[.06] bg-white/70 p-3 dark:border-white/[.07] dark:bg-black/20">
      {points.length > 1 ? <svg viewBox="0 0 600 120" className="h-32 w-full" role="img" aria-label={`${symbol} price movement over the last 24 hours with target line`} preserveAspectRatio="none"><line x1="0" x2="600" y1={y(terms.target)} y2={y(terms.target)} stroke="#10b981" strokeWidth="2" strokeDasharray="6 5" /><path d={path} fill="none" stroke="#2E7CF6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg> : <div className="flex h-32 items-center justify-center gap-2 text-sm text-zinc-500"><TrendingUp className="h-4 w-4" /> Price history is loading</div>}
      <div className="flex justify-between text-[11px] font-semibold text-zinc-500"><span>Last 24 hours · Binance spot</span><span className="text-emerald-600">Dashed line = target</span></div>
    </div>
    <p className="mt-3 text-sm font-semibold">{yesNow === null ? "Waiting for a fresh spot quote" : yesNow ? "Yes is currently on side" : "No is currently on side"} <span className="font-normal text-zinc-500">· The result uses the latest available hourly oracle checkpoint at or before {new Date(terms.atTime * 1000).toLocaleString()}. {symbolUpdatedAt && !settled ? `Spot updated ${new Date(symbolUpdatedAt).toLocaleTimeString()}.` : ""}</span></p>
  </section>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleHelp, Share2 } from "lucide-react";
import { CONTRACTS } from "../lib/contracts";
import { getPublicClient } from "../hooks/usePublicClient";
import { decodeTargetTerms, formatUsd } from "../lib/targetMarket";
import { formatTick } from "../lib/format";
import { ShareButtons } from "./ShareButtons";
import { PRICE_ORACLE_V2_ABI } from "../lib/marketFactory";

export function TargetSettlementReplay({ marketId, params, symbol, state, winnerBitmap, payoutPerShare, userStakes }: {
  marketId: string;
  params: `0x${string}`;
  symbol: string;
  state: number;
  winnerBitmap: bigint;
  payoutPerShare: bigint;
  userStakes: bigint[] | null;
}) {
  const terms = useMemo(() => decodeTargetTerms(params), [params]);
  const [checkpoint, setCheckpoint] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!terms || state !== 1 || !CONTRACTS.priceOracle) { setLoading(false); return; }
    let alive = true;
    getPublicClient().readContract({ address: CONTRACTS.priceOracle as `0x${string}`, abi: PRICE_ORACLE_V2_ABI, functionName: "getPriceAt", args: [terms.teamId, BigInt(terms.atTime)] })
      .then(([found, price]) => { if (alive) setCheckpoint(found ? price : null); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [terms, state]);
  if (!terms || state === 0) return null;
  const winner = winnerBitmap & 1n ? "Yes" : "No";
  const winningIndex = winner === "Yes" ? 0 : 1;
  const winningStake = userStakes?.[winningIndex] ?? 0n;
  const payout = state === 2 ? (userStakes ?? []).reduce((sum, stake) => sum + stake, 0n) : winningStake * payoutPerShare / 10n ** 18n;
  const actual = checkpoint === null ? null : Number(checkpoint) / 1e8;
  const comparison = actual === null ? null : terms.above ? actual >= terms.target : actual <= terms.target;

  return <section className="mb-6 rounded-[1.75rem] border border-emerald-500/25 bg-emerald-500/[.04] p-5 sm:p-7" aria-label="Settlement replay">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-extrabold uppercase tracking-[.15em] text-emerald-600 dark:text-emerald-400">Settlement replay</p><h2 className="mt-1 font-display text-2xl font-black">{state === 2 ? "Market voided" : `${winner} won`}</h2></div><ShareButtons path={`/markets/${marketId}`} text={`${symbol} price target result on TICKR: ${state === 2 ? "voided" : `${winner} won`}`} compact /></div>
    {state === 1 ? <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-white p-4 dark:bg-white/[.05]"><p className="text-xs text-zinc-500">1 · Selected oracle price</p><p className="mt-1 text-xl font-black tabular-nums">{loading ? "Loading…" : actual === null ? "Unavailable" : formatUsd(actual)}</p><p className="mt-1 text-xs text-zinc-500">For target time {new Date(terms.atTime * 1000).toLocaleString()}</p></div><div className="rounded-2xl bg-white p-4 dark:bg-white/[.05]"><p className="text-xs text-zinc-500">2 · Compare with target</p><p className="mt-1 text-xl font-black tabular-nums">{terms.above ? "≥" : "≤"} {formatUsd(terms.target)}</p><p className="mt-1 text-xs text-zinc-500">{comparison === null ? "On-chain winner shown at right" : comparison ? "Condition met" : "Condition not met"}</p></div><div className="rounded-2xl bg-white p-4 dark:bg-white/[.05]"><p className="text-xs text-zinc-500">3 · Result</p><p className="mt-1 flex items-center gap-2 text-xl font-black"><CheckCircle2 className="h-5 w-5 text-emerald-500" /> {winner}</p><p className="mt-1 text-xs text-zinc-500">Recorded by the market contract</p></div></div> : <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500"><CircleHelp className="h-4 w-4" /> A voided market refunds each player&apos;s stakes.</p>}
    {userStakes && <div className="mt-4 rounded-2xl border border-black/[.06] p-4 text-sm dark:border-white/[.07]"><div className="flex justify-between gap-3"><span>Your {state === 2 ? "total stake" : `winning ${winner} stake`}</span><strong>{formatTick(state === 2 ? (userStakes ?? []).reduce((sum, stake) => sum + stake, 0n) : winningStake)} TICK</strong></div>{state === 1 && <div className="mt-2 flex justify-between gap-3"><span>Final payout multiplier</span><strong>{(Number(payoutPerShare) / 1e18).toFixed(3)}×</strong></div>}<div className="mt-3 flex justify-between gap-3 border-t border-black/10 pt-3 text-base dark:border-white/10"><span>{state === 2 ? "Refund" : "Calculated payout"}</span><strong>{formatTick(payout)} TICK</strong></div></div>}
  </section>;
}

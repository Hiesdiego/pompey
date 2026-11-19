"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock3, Target } from "lucide-react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getPublicClient } from "../hooks/usePublicClient";
import { useTickr } from "../hooks/useTickr";
import { useContractWrite } from "../hooks/useContractWrite";
import { useMarketFees } from "../lib/query/useMarketFees";
import { qks } from "../lib/query/keys";
import { queryClient } from "../lib/query/queryClient";
import { stockMarketApi, STOCK_MARKET_FACTORY_ABI, STOCK_MARKET_FACTORY_ADDRESS, stockDisplaySymbol, stockPriceTargetQuestion } from "../lib/stockMarketContracts";
import { formatTick } from "../lib/format";
import { formatUtcDateTime } from "../lib/utcTime";
import { StockLogo } from "./StockLogo";
import { QuickStakeChips, QuickStakeSheet, type QuickStakeOutcome } from "./QuickStake";
import { toast } from "./Toast";

export function StockMarketDetailPanel() {
  const params = useParams();
  const routeKey = String(params.id ?? "");
  const idText = routeKey.startsWith("s-") ? routeKey.slice(2) : "";
  const validId = /^(0|[1-9]\d*)$/.test(idText);
  const id = validId ? BigInt(idText) : 0n;
  const { playerAddress, authenticated, login } = useTickr();
  const { write, pending } = useContractWrite();
  const { feesBps } = useMarketFees(STOCK_MARKET_FACTORY_ADDRESS);
  const [stakes, setStakes] = useState<[bigint, bigint]>([0n, 0n]);
  const [claimed, setClaimed] = useState(false);
  const [quickPick, setQuickPick] = useState<QuickStakeOutcome | null>(null);
  const marketQuery = useQuery({
    queryKey: qks.stockMarket(id),
    enabled: Boolean(STOCK_MARKET_FACTORY_ADDRESS && validId),
    queryFn: () => stockMarketApi.market(id),
    refetchInterval: 15_000,
  });
  const market = marketQuery.data;
  const totals = useMemo(() => market?.outcomeTotals.map((value) => BigInt(value)) ?? [0n, 0n], [market]);
  const question = market ? stockPriceTargetQuestion(stockDisplaySymbol(market.symbol), market.targetPrice, market.above, market.endTime * 1000) : "Stock price target";
  const bettingOpen = Boolean(market && market.state === 0 && market.bettingCloseTime > Math.floor(Date.now() / 1000));
  const canClaim = Boolean(market && playerAddress && market.state !== 0 && !claimed && (market.state === 2 ? stakes.some((value) => value > 0n) : stakes.some((value, index) => value > 0n && (BigInt(market.winnerBitmap) & (1n << BigInt(index))) !== 0n)));

  useEffect(() => {
    let alive = true;
    if (!market || !playerAddress || !STOCK_MARKET_FACTORY_ADDRESS) { setStakes([0n, 0n]); setClaimed(false); return; }
    const client = getPublicClient();
    Promise.all([
      client.readContract({ address: STOCK_MARKET_FACTORY_ADDRESS, abi: STOCK_MARKET_FACTORY_ABI, functionName: "stakes", args: [id, playerAddress, 0n] }),
      client.readContract({ address: STOCK_MARKET_FACTORY_ADDRESS, abi: STOCK_MARKET_FACTORY_ABI, functionName: "stakes", args: [id, playerAddress, 1n] }),
      client.readContract({ address: STOCK_MARKET_FACTORY_ADDRESS, abi: STOCK_MARKET_FACTORY_ABI, functionName: "claimed", args: [id, playerAddress] }),
    ]).then(([yes, no, isClaimed]) => { if (alive) { setStakes([yes as bigint, no as bigint]); setClaimed(Boolean(isClaimed)); } }).catch(() => {});
    return () => { alive = false; };
  }, [market, playerAddress, id]);

  const outcomes = totals.map((total, index) => ({ index, label: index === 0 ? "Yes" : "No", total, teamId: null, share: market?.totalStaked ? Number(total * 10_000n / BigInt(market.totalStaked)) / 100 : 0, odds: null })) as QuickStakeOutcome[];

  async function claim() {
    if (!market || !playerAddress) return;
    try {
      await write({ address: STOCK_MARKET_FACTORY_ADDRESS, abi: STOCK_MARKET_FACTORY_ABI, functionName: "claim", args: [id], label: "Claim stock market payout" });
      setClaimed(true);
      toast.success("Market payout claimed");
      void queryClient.invalidateQueries({ queryKey: qks.stockMarkets });
      void queryClient.invalidateQueries({ queryKey: qks.balance(playerAddress.toLowerCase()) });
    } catch { /* useContractWrite surfaces the error */ }
  }

  if (marketQuery.isPending) return <div className="surface-card mx-auto max-w-3xl animate-pulse rounded-3xl p-8">Loading stock market…</div>;
  if (marketQuery.isError || !market) return <div className="mx-auto max-w-3xl py-12"><Link href="/markets" className="text-sm font-semibold text-[#2E7CF6]">← Markets</Link><div className="surface-card mt-5 rounded-3xl p-8">Could not load this stock market. Check that the stock markets API is enabled.</div></div>;

  return <main className="mx-auto max-w-4xl pb-16">
    <Link href="/markets" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-[#2E7CF6]"><ArrowLeft className="h-4 w-4" /> All markets</Link>
    <section className="surface-card rounded-3xl p-6 sm:p-9">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#2E7CF6]/10 text-[#2E7CF6]"><Target className="h-5 w-5" /></span><span className="text-xs font-extrabold uppercase tracking-[.16em] text-[#2E7CF6]">Stock Price Target</span><span className="ml-auto rounded-full bg-black/[.05] px-3 py-1 text-xs font-bold dark:bg-white/[.08]">{market.state === 0 ? bettingOpen ? "Open" : "Awaiting settlement" : market.state === 1 ? "Resolved" : "Voided"}</span></div>
      <h1 className="mt-6 font-display text-3xl font-black leading-tight text-zinc-950 dark:text-white sm:text-4xl">{question}</h1>
      <div className="mt-5 flex items-center gap-3"><StockLogo symbol={market.symbol} iconUrl={market.iconUrl} size={48} /><div><p className="font-bold text-zinc-900 dark:text-white">{market.name}</p><p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{stockDisplaySymbol(market.symbol)} · Base tokenized stock</p></div></div>
      <div className="mt-7 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-black/[.03] p-4 dark:bg-white/[.04]"><p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Total pool</p><p className="mt-1 text-xl font-black">{formatTick(BigInt(market.totalStaked) + BigInt(market.seedAmount))} TICK</p></div><div className="rounded-2xl bg-black/[.03] p-4 dark:bg-white/[.04]"><p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Deadline</p><p className="mt-1 text-sm font-bold">{formatUtcDateTime(market.endTime * 1000)}</p></div><div className="rounded-2xl bg-black/[.03] p-4 dark:bg-white/[.04]"><p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Betting closes</p><p className="mt-1 flex items-center gap-2 text-sm font-bold"><Clock3 className="h-4 w-4 text-zinc-400" />{formatUtcDateTime(market.bettingCloseTime * 1000)}</p></div></div>
      <div className="mt-7 grid gap-3 sm:grid-cols-2">{outcomes.map((outcome) => <div key={outcome.index} className="rounded-2xl border border-black/[.08] p-5 dark:border-white/[.1]"><div className="flex justify-between"><span className="font-extrabold">{outcome.label}</span><span className="font-bold">{formatTick(totals[outcome.index] ?? 0n)} TICK</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]"><div className="h-full rounded-full bg-[#2E7CF6]" style={{ width: `${Math.min(100, outcome.share)}%` }} /></div><p className="mt-2 text-xs text-zinc-500">Your stake: {formatTick(stakes[outcome.index] ?? 0n)} TICK</p></div>)}</div>
      <div className="mt-4"><QuickStakeChips outcomes={outcomes} bettingOpen={bettingOpen} onPick={setQuickPick} /></div>
      <div className="mt-6 flex flex-wrap gap-3">{canClaim && <button onClick={() => void claim()} disabled={pending} className="rounded-xl bg-[#2E7CF6] px-5 py-3 font-bold text-white disabled:opacity-50">{pending ? "Claiming…" : market.state === 2 ? "Claim refund" : "Claim winnings"}</button>}{!authenticated && bettingOpen && <button onClick={login} className="rounded-xl border border-black/10 px-5 py-3 font-bold dark:border-white/10">Connect to stake</button>}</div>
      <p className="mt-6 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">The final price is the stock NAV at the deadline, or the last NAV published within 24 hours when the feed is healthy. If no eligible NAV exists, the market is void and stakes can be refunded. Above is strictly above the target; exactly on the line resolves No.</p>
    </section>
    <QuickStakeSheet marketId={id} marketKey={market.marketKey} factoryAddress={STOCK_MARKET_FACTORY_ADDRESS} question={question} outcome={quickPick} outcomeTotals={totals} totalStaked={BigInt(market.totalStaked)} seedAmount={BigInt(market.seedAmount)} feesBps={feesBps} variant="stock-target" onClose={() => setQuickPick(null)} />
  </main>;
}

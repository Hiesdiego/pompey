"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Address } from "viem";
import { ArrowLeft, Search, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTickr } from "../../../../hooks/useTickr";
import { useTickBalance } from "../../../../lib/query/useTickBalance";
import { useMyProfile } from "../../../../hooks/useMyProfile";
import { useContractWrite } from "../../../../hooks/useContractWrite";
import { getPublicClient } from "../../../../hooks/usePublicClient";
import { CONTRACTS, TICK_TOKEN_ABI } from "../../../../lib/contracts";
import { stockMarketApi, STOCK_MARKET_FACTORY_ABI, STOCK_MARKET_FACTORY_ADDRESS, STOCK_CREATION_SEED_TICK, MAX_TARGET_TIME, directionFromAbove, parseNavPrice, scaleTargetPrice, stockDisplaySymbol, stockPriceTargetQuestion } from "../../../../lib/stockMarketContracts";
import { qks } from "../../../../lib/query/keys";
import { queryClient } from "../../../../lib/query/queryClient";
import { StockLogo } from "../../../../components/StockLogo";
import { toast } from "../../../../components/Toast";

export default function StockMarketCreatePage() {
  const router = useRouter();
  const { playerAddress, authenticated, login } = useTickr();
  const { balance } = useTickBalance(playerAddress ?? null);
  const { profile } = useMyProfile();
  const { write, writeBatch, pending } = useContractWrite();
  const [search, setSearch] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [target, setTarget] = useState("");
  const [above, setAbove] = useState(true);
  const [deadline, setDeadline] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stocksQuery = useQuery({ queryKey: ["stockTargetList"], queryFn: stockMarketApi.list, enabled: Boolean(STOCK_MARKET_FACTORY_ADDRESS), staleTime: 60_000, refetchInterval: 60_000 });
  const stocks = stocksQuery.data ?? [];
  const selected = stocks.find((stock) => stock.symbol === selectedSymbol);
  const filtered = useMemo(() => stocks.filter((stock) => `${stock.name} ${stock.symbol}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 50), [stocks, search]);
  const deadlineDate = deadline ? new Date(`${deadline}:00Z`) : null;
  const deadlineSeconds = deadlineDate && Number.isFinite(deadlineDate.getTime()) ? Math.floor(deadlineDate.getTime() / 1000) : 0;
  const targetScaled = (() => { const n = Number(target); return Number.isFinite(n) && n > 0 ? scaleTargetPrice(n) : 0n; })();
  const enoughBalance = balance === null || balance >= BigInt(STOCK_CREATION_SEED_TICK) * 10n ** 18n;
  const ready = Boolean(playerAddress && selected?.hasNav && targetScaled > 0n && deadlineSeconds > Math.floor(Date.now() / 1000) + 3600 && deadlineSeconds <= MAX_TARGET_TIME && (creatorName.trim() || profile?.username) && enoughBalance && STOCK_MARKET_FACTORY_ADDRESS);
  const preview = selected && targetScaled > 0n && deadlineDate ? stockPriceTargetQuestion(stockDisplaySymbol(selected.symbol), targetScaled, above, deadlineDate) : "Choose a stock, direction, target and deadline to preview your question.";

  async function create() {
    if (!playerAddress || !selected || !ready) return;
    setError(null);
    const seed = BigInt(STOCK_CREATION_SEED_TICK) * 10n ** 18n;
    const client = getPublicClient();
    const factory = STOCK_MARKET_FACTORY_ADDRESS as Address;
    const tickToken = CONTRACTS.tickToken as Address;
    try {
      const allowance = await client.readContract({ address: tickToken, abi: TICK_TOKEN_ABI, functionName: "allowance", args: [playerAddress, factory] });
      const approve = { address: tickToken, abi: TICK_TOKEN_ABI, functionName: "approve", args: [factory, seed], label: "TICK seed approval" };
      const createCall = { address: factory, abi: STOCK_MARKET_FACTORY_ABI, functionName: "createMarket", args: [selected.contractAddress as `0x${string}`, stockDisplaySymbol(selected.symbol), directionFromAbove(above), targetScaled, BigInt(deadlineSeconds), (profile?.username || creatorName).slice(0, 32)], label: "Create stock price target" };
      if (allowance < seed) await writeBatch([approve, createCall], { label: "Approve and create stock market" });
      else await write(createCall);
      toast.success("Stock price target created", { detail: `${STOCK_CREATION_SEED_TICK} TICK seed added to the pool` });
      void queryClient.invalidateQueries({ queryKey: qks.stockMarkets });
      router.push("/markets");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create this market.");
    }
  }

  if (!STOCK_MARKET_FACTORY_ADDRESS) return <main className="mx-auto max-w-3xl py-12"><Link href="/markets/create" className="text-sm font-semibold text-[#2E7CF6]">← Crypto market formats</Link><div className="surface-card mt-5 rounded-3xl p-8"><h1 className="font-display text-2xl font-black">Stock price targets are not deployed yet</h1><p className="mt-2 text-sm text-zinc-500">The stock market factory must be deployed and configured before markets can be created.</p></div></main>;

  return <main className="mx-auto max-w-6xl pb-16">
    <Link href="/markets/create" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-[#2E7CF6]"><ArrowLeft className="h-4 w-4" /> Other market formats</Link>
    <header className="relative mb-8 overflow-hidden rounded-[2rem] bg-[#0d224b] p-7 text-white sm:p-10"><div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[#2E7CF6]/40 blur-3xl" /><div className="relative"><p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[.2em] text-[#93c0ff]"><TrendingUp className="h-4 w-4" /> Stock price targets</p><h1 className="mt-3 max-w-2xl font-display text-4xl font-black leading-tight sm:text-5xl">Set the target. Let the market decide.</h1><p className="mt-4 max-w-xl text-sm leading-6 text-white/70">Choose a Base tokenized stock and ask whether its NAV will finish above or below your target. Creating a market adds a {STOCK_CREATION_SEED_TICK} TICK seed to its pool.</p></div></header>
    <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="surface-card rounded-3xl p-5 sm:p-7">
        <label className="text-sm font-bold">Choose a stock</label><div className="relative mt-2"><Search className="absolute left-3 top-3.5 h-4 w-4 text-zinc-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ticker or company" className="w-full rounded-xl border border-black/10 bg-transparent py-3 pl-10 pr-3 outline-none focus:border-[#2E7CF6] dark:border-white/10" /></div>
        <div className="mt-3 max-h-64 divide-y divide-black/[.06] overflow-y-auto rounded-xl border border-black/[.06] dark:divide-white/[.07] dark:border-white/[.07]">{stocksQuery.isPending ? <p className="p-4 text-sm text-zinc-500">Loading Base tokenized stocks…</p> : filtered.map((stock) => <button key={stock.contractAddress} type="button" disabled={!stock.hasNav} onClick={() => { setSelectedSymbol(stock.symbol); setTarget(parseNavPrice(stock.navPrice)?.toString() ?? ""); }} className={`flex w-full items-center gap-3 p-3 text-left ${selectedSymbol === stock.symbol ? "bg-[#2E7CF6]/[.07]" : "hover:bg-black/[.03] dark:hover:bg-white/[.03]"} disabled:cursor-not-allowed disabled:opacity-45`}><StockLogo symbol={stock.symbol} iconUrl={stock.iconUrl} size={36} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{stock.name} <span className="text-zinc-500">({stockDisplaySymbol(stock.symbol)})</span></span><span className="block text-xs text-zinc-500">{stock.hasNav ? `$${Number(stock.navPrice).toLocaleString("en-US", { maximumFractionDigits: 6 })} NAV` : "Not available yet · no live NAV"}</span></span></button>)}</div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2"><fieldset><legend className="text-sm font-bold">Direction</legend><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => setAbove(true)} className={`rounded-xl border p-3 text-sm font-bold ${above ? "border-[#2E7CF6] bg-[#2E7CF6]/10 text-[#2E7CF6]" : "border-black/10 dark:border-white/10"}`}>Above</button><button type="button" onClick={() => setAbove(false)} className={`rounded-xl border p-3 text-sm font-bold ${!above ? "border-[#2E7CF6] bg-[#2E7CF6]/10 text-[#2E7CF6]" : "border-black/10 dark:border-white/10"}`}>Below</button></div><p className="mt-2 text-xs text-zinc-500">Above is strict: exactly on the target resolves No. Below includes the target.</p></fieldset><label className="text-sm font-bold">Target price (USD)<input type="number" min="0.00000001" step="any" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={selected?.navPrice ? String(selected.navPrice) : "e.g. 150"} className="mt-2 block w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 outline-none focus:border-[#2E7CF6] dark:border-white/10" /></label><label className="text-sm font-bold sm:col-span-2">Deadline (UTC)<input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} max="2026-12-31T23:59" className="mt-2 block w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 outline-none focus:border-[#2E7CF6] dark:border-white/10" /><span className="mt-1 block text-xs text-zinc-500">Betting closes 5 minutes before the deadline.</span></label></div>
        {!profile?.username && <label className="mt-5 block text-sm font-bold">Display name<input value={creatorName} onChange={(event) => setCreatorName(event.target.value.slice(0, 32))} className="mt-2 block w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 outline-none focus:border-[#2E7CF6] dark:border-white/10" /></label>}
      </section>
      <aside className="surface-card h-fit rounded-3xl p-5 sm:p-6"><p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#2E7CF6]">Question preview</p><h2 className="mt-3 font-display text-xl font-black leading-snug">{preview}</h2><div className="mt-5 rounded-2xl bg-black/[.03] p-4 text-sm dark:bg-white/[.04]"><p className="font-bold">Seed liquidity</p><p className="mt-1 text-zinc-500">{STOCK_CREATION_SEED_TICK} TICK is added at creation. Winners share the eligible pool after fees.</p><p className="mt-3 text-xs text-zinc-500">Your balance: {balance === null ? "Checking…" : `${(Number(balance) / 1e18).toLocaleString()} TICK`}</p></div>{error && <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}<button type="button" onClick={() => authenticated ? void create() : login()} disabled={authenticated && (!ready || pending)} className="mt-5 w-full rounded-xl bg-[#2E7CF6] px-5 py-3 font-extrabold text-white disabled:opacity-50">{!authenticated ? "Connect wallet" : pending ? "Creating market…" : `Create and seed · ${STOCK_CREATION_SEED_TICK} TICK`}</button></aside>
    </div>
  </main>;
}

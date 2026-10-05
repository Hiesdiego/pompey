"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { ArrowRight, Clock3, ListChecks, Wallet } from "lucide-react";
import { useMyProfile } from "../hooks/useMyProfile";
import { useTickr } from "../hooks/useTickr";
import { getPublicClient } from "../hooks/usePublicClient";
import { social, type SocialPrediction } from "../lib/social";
import { CONTRACTS, PREDICTION_POOL_ABI } from "../lib/contracts";
import { TEMPLATES, TEMPLATE_NAMES, MARKET_FACTORY_ABI, MARKET_FACTORY_ADDRESS } from "../lib/marketFactory";
import { decodeTargetTerms, formatUsd } from "../lib/targetMarket";
import { formatTick } from "../lib/format";
import { useWatchlist } from "../lib/watchlist";
import type { MarketSummary } from "../lib/chainDirect";
import type { ApiFixture } from "../lib/api";

type FixturePick = { fixture: ApiFixture; stakes: bigint[] };

export function MyPicksDashboard({ markets, fixtures, teams }: {
  markets: MarketSummary[];
  fixtures: ApiFixture[];
  teams: Array<{ teamId: number; symbol: string }>;
}) {
  const { authenticated, playerAddress } = useTickr();
  const { getAccessToken } = usePrivy();
  const { profile } = useMyProfile();
  const { notices, entries } = useWatchlist();
  const [predictions, setPredictions] = useState<SocialPrediction[]>([]);
  const [fixturePicks, setFixturePicks] = useState<FixturePick[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [claimable, setClaimable] = useState<{ count: number; amount: bigint; firstId: number | null }>({ count: 0, amount: 0n, firstId: null });

  useEffect(() => {
    if (!profile?.username) { setPredictions([]); return; }
    let alive = true;
    const load = () => social.predictions(profile.username, "all", 100, undefined, getAccessToken).then((r) => { if (alive) setPredictions(r.items); }).catch(() => {});
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [profile?.username, getAccessToken]);

  const relevant = useMemo(() => fixtures.filter((f) => {
    const time = Date.parse(f.kickoff ?? f.scheduledKickoff ?? "");
    return Number.isFinite(time) && time > Date.now() - 24 * 3_600_000 && time < Date.now() + 48 * 3_600_000;
  }).slice(0, 36), [fixtures]);

  useEffect(() => {
    if (!authenticated || !playerAddress || !CONTRACTS.predictionPool || !relevant.length) { setLoaded(true); return; }
    let alive = true;
    const scan = async () => {
      try {
        const calls = relevant.flatMap((f) => [0, 1, 2].map((outcome) => ({ address: CONTRACTS.predictionPool as `0x${string}`, abi: PREDICTION_POOL_ABI, functionName: "getStake" as const, args: [BigInt(f.seasonId), BigInt(f.fixtureId), playerAddress, outcome] as const })));
        const results = await getPublicClient().multicall({ contracts: calls, allowFailure: true });
        const picks = relevant.map((fixture, i) => ({ fixture, stakes: [0, 1, 2].map((o) => (results[i * 3 + o]?.result ?? 0n) as bigint) })).filter((p) => p.stakes.some((s) => s > 0n));
        if (alive) setFixturePicks(picks);
      } catch { /* Keep the last good snapshot. */ }
      finally { if (alive) setLoaded(true); }
    };
    void scan();
    const timer = window.setInterval(scan, 45_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [authenticated, playerAddress, relevant]);

  useEffect(() => {
    if (!playerAddress || !MARKET_FACTORY_ADDRESS || !predictions.length) { setClaimable({ count: 0, amount: 0n, firstId: null }); return; }
    const byMarket = [...new Set(predictions.map((p) => p.marketId))].map((id) => ({ id, market: markets.find((m) => m.id === id) })).filter((row) => row.market && row.market.state !== 0);
    if (!byMarket.length) { setClaimable({ count: 0, amount: 0n, firstId: null }); return; }
    let alive = true;
    getPublicClient().multicall({ contracts: byMarket.map(({ id }) => ({ address: MARKET_FACTORY_ADDRESS, abi: MARKET_FACTORY_ABI, functionName: "claimed" as const, args: [BigInt(id), playerAddress] as const })), allowFailure: true }).then((results) => {
      let count = 0;
      let amount = 0n;
      let firstId: number | null = null;
      byMarket.forEach(({ id, market }, i) => {
        if (!market || results[i]?.status !== "success" || results[i].result === true) return;
        const positions = predictions.filter((p) => p.marketId === id && p.amountTick !== null);
        const value = market.state === 2
          ? positions.reduce((sum, p) => sum + BigInt(p.amountTick!), 0n)
          : positions.reduce((sum, p) => (BigInt(market.winnerBitmap) & (1n << BigInt(p.outcome))) !== 0n ? sum + BigInt(p.amountTick!) * BigInt(market.payoutPerShare) / 10n ** 18n : sum, 0n);
        if (value > 0n) { count++; amount += value; firstId ??= id; }
      });
      if (alive) setClaimable({ count, amount, firstId });
    }).catch(() => {});
    return () => { alive = false; };
  }, [playerAddress, predictions, markets]);

  if (!authenticated) return null;
  const unique = [...new Map(predictions.map((p) => [p.marketId, p])).values()];
  const active = unique.map((p) => ({ prediction: p, market: markets.find((m) => m.id === p.marketId) })).filter((p) => p.market?.state === 0).sort((a, b) => (a.market?.bettingCloseTime ?? Infinity) - (b.market?.bettingCloseTime ?? Infinity));
  const nextFixture = fixturePicks.filter((p) => !p.fixture.settled).sort((a, b) => Date.parse(a.fixture.kickoff ?? a.fixture.scheduledKickoff ?? "") - Date.parse(b.fixture.kickoff ?? b.fixture.scheduledKickoff ?? ""));

  return <section className="overflow-hidden rounded-[1.75rem] border border-[#2E7CF6]/20 bg-gradient-to-br from-[#2E7CF6]/[.08] via-white to-white p-5 dark:via-[#101821] dark:to-[#101821] sm:p-7" aria-label="Your picks today">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#2E7CF6]">Your matchday</p><h2 className="mt-1 font-display text-2xl font-black">Your picks today</h2><p className="mt-1 text-xs text-zinc-500">Markets and fixtures you have joined, with live closing and settlement status.</p></div><Link href="/watchlist" className="rounded-xl border border-[#2E7CF6]/30 px-3 py-2 text-xs font-bold text-[#2E7CF6]">Watchlist · {entries.length}{notices.length ? ` · ${notices.length} updates` : ""}</Link></div>
    <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">{[["Open markets", active.length], ["Upcoming fixtures", nextFixture.length], ["Recent claims", claimable.count]].map(([label, count]) => <div key={label} className="rounded-2xl bg-white/90 p-3 dark:bg-white/[.05]"><p className="text-[11px] text-zinc-500">{label}</p><p className="mt-1 font-display text-2xl font-black tabular-nums">{count}</p></div>)}</div>
    {claimable.amount > 0n && <Link href={`/markets/${claimable.firstId}`} className="mt-3 flex items-center justify-between rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-700 dark:text-emerald-300"><span>{formatTick(claimable.amount)} TICK ready to claim from recent market picks</span><ArrowRight className="h-4 w-4" /></Link>}
    <div className="mt-5 grid gap-3 md:grid-cols-2">{active.slice(0, 3).map(({ prediction, market }) => { if (!market) return null; const terms = market.templateId === TEMPLATES.TARGET ? decodeTargetTerms(market.params as `0x${string}`) : null; const symbol = teams.find((t) => t.teamId === terms?.teamId)?.symbol; return <Link key={prediction.marketId} href={`/markets/${prediction.marketId}`} className="group rounded-2xl border border-black/[.07] bg-white/80 p-4 transition hover:border-[#2E7CF6]/50 dark:border-white/[.08] dark:bg-white/[.04]"><div className="flex justify-between gap-3"><span className="text-xs font-bold text-[#2E7CF6]">{TEMPLATE_NAMES[market.templateId] ?? "Market"} #{market.id}</span><ArrowRight className="h-4 w-4 group-hover:translate-x-1" /></div><p className="mt-2 font-bold">{terms && symbol ? `${symbol} ${terms.above ? "≥" : "≤"} ${formatUsd(terms.target)}` : `Your pick: outcome ${prediction.outcome + 1}`}</p><p className="mt-2 flex items-center gap-1 text-xs text-zinc-500"><Clock3 className="h-3.5 w-3.5" /> Closes {new Date(market.bettingCloseTime * 1000).toLocaleString()}{prediction.amountTick !== null ? ` · ${formatTick(BigInt(prediction.amountTick))} TICK staked` : ""}</p></Link>; })}{nextFixture.slice(0, 2).map(({ fixture, stakes }) => <Link key={fixture.fixtureId} href={`/match/${fixture.fixtureId}`} className="group rounded-2xl border border-black/[.07] bg-white/80 p-4 transition hover:border-[#2E7CF6]/50 dark:border-white/[.08] dark:bg-white/[.04]"><div className="flex justify-between gap-3"><span className="text-xs font-bold text-[#2E7CF6]">Fixture #{fixture.fixtureId}</span><ArrowRight className="h-4 w-4 group-hover:translate-x-1" /></div><p className="mt-2 font-bold">{fixture.home?.symbol ?? "TBA"} vs {fixture.away?.symbol ?? "TBA"}</p><p className="mt-2 text-xs text-zinc-500">{stakes.map((s, i) => s > 0n ? `${["Home", "Draw", "Away"][i]} ${formatTick(s)} TICK` : "").filter(Boolean).join(" · ")}</p></Link>)}</div>
    {loaded && !active.length && !fixturePicks.length && <p className="mt-5 flex items-center gap-2 text-sm text-zinc-500"><ListChecks className="h-4 w-4" /> No picks in the current window. <Link href="/markets" className="font-bold text-[#2E7CF6]">Explore markets</Link></p>}
    <div className="mt-5 flex flex-wrap gap-3 border-t border-black/[.08] pt-4 text-xs font-bold dark:border-white/[.08]"><Link href="/claims" className="inline-flex items-center gap-1 text-[#2E7CF6]"><Wallet className="h-4 w-4" /> Check claimable payouts <ArrowRight className="h-3 w-3" /></Link>{profile?.username && <Link href={`/${profile.username}`} className="text-zinc-500">Full prediction record →</Link>}</div>
  </section>;
}

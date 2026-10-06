"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Clock3, Flame, Radio, Sparkles, Trophy, Zap } from "lucide-react";
import { TEMPLATES, TEMPLATE_NAMES } from "../lib/marketFactory";
import { api, type ApiFixture, type ApiTableRow } from "../lib/api";
import { useMarkets } from "../lib/query/useMarkets";
import { useTeams } from "../hooks/useTeams";
import { useTickr } from "../hooks/useTickr";
import { TeamBadge } from "../components/TeamBadge";
import { SpreadFixtureBadges } from "../components/SpreadFixtureBadges";
import { LeagueTable, LeagueTableSkeleton } from "../components/LeagueTable";
import { FixtureCard, fixtureStatus } from "../components/FixtureCard";
import { Countdown } from "../components/Countdown";
import { formatTick } from "../lib/format";
import type { MarketSummary } from "../lib/chainDirect";
import { CONTRACTS, PRICE_ORACLE_ABI, SEASON_ID } from "../lib/contracts";
import { getPublicClient } from "../hooks/usePublicClient";
import { usePriceFeed } from "../lib/price/usePriceFeed";
import { normalizeScoreline, roundPctLikeOracle, formatSignedPct } from "../lib/format";
import { getMatchDurationMs } from "../lib/matchConfig";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { TICKR_TEAMS } from "@tickr/shared/teams";
import { QuickStakeChips, QuickStakeSheet, type QuickStakeOutcome } from "../components/QuickStake";
import { MyPicksDashboard } from "../components/MyPicksDashboard";
import { TargetCardStatus } from "../components/TargetCardStatus";
import { marketOdds, formatMarketOdds, isHighPayout } from "../lib/marketOdds";
import { useMarketFees } from "../lib/query/useMarketFees";
import { useFactoryEvents } from "../lib/query/useFactoryEvents";

const card = "surface-card";
const open = (m: MarketSummary) => m.state === 0 && m.bettingCloseTime * 1000 > Date.now();
const pool = (m: MarketSummary) => BigInt(m.totalStaked || "0") + BigInt(m.seedAmount || "0");
const duration = (m: MarketSummary) => Math.max(0, m.bettingCloseTime * 1000 - Date.now());

function PriceTicker({ prices }: { prices: Record<string, number> }) {
  const items = useMemo(() => TICKR_TEAMS
    .filter((team) => prices[team.symbol] !== undefined)
    .map((team) => ({ teamId: team.teamId, symbol: team.symbol, price: prices[team.symbol] }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol)), [prices]);
  if (items.length === 0) return null;
  const row = (key: string) => <div key={key} className="flex shrink-0 items-center" aria-hidden={key !== "a"}>{items.map((p) => <span key={`${key}-${p.teamId}`} className="mx-4 inline-flex items-center gap-1.5 font-display text-xs font-semibold tabular-nums text-zinc-500 dark:text-zinc-400"><span className="text-zinc-700 dark:text-zinc-300">{p.symbol}</span><span>${Number(p.price).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span><span className="h-1 w-1 rounded-full bg-[#2E7CF6]/60" /></span>)}</div>;
  return <div className="relative mb-6 overflow-hidden rounded-2xl border border-black/8 bg-black/[.02] py-2.5 dark:border-white/8 dark:bg-white/[.02]"><div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-white to-transparent dark:from-black" /><div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-white to-transparent dark:from-black" /><div className="flex w-max animate-marquee">{row("a")}{row("b")}</div></div>;
}

function outcomeLabel(m: MarketSummary, i: number, teams: { symbol: string }[]) {
  if (m.templateId === TEMPLATES.TOP_GAINER || m.templateId === TEMPLATES.CHAMPION) return teams[i]?.symbol ?? `Team ${i + 1}`;
  return i === 0 ? "Yes" : "No";
}

function priceTargetTeamId(market: MarketSummary): number | null {
  if (market.templateId !== TEMPLATES.TARGET) return null;
  try {
    const [teamId] = decodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), market.params as `0x${string}`);
    return Number(teamId);
  } catch {
    return null;
  }
}

function marketQuestion(market: MarketSummary, teams: { symbol: string }[], fixtures: ApiFixture[]) {
  try {
    if (market.templateId === TEMPLATES.TOP_GAINER) {
      const [, matchday] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), market.params as `0x${string}`);
      return `Which coin gains the most on matchday ${Number(matchday) + 1}?`;
    }
    if (market.templateId === TEMPLATES.CHAMPION) return "Who will win the season championship?";
    if (market.templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params as `0x${string}`);
      return `Will ${teams[Number(a)]?.symbol ?? `Team ${a}`} outperform ${teams[Number(b)]?.symbol ?? `Team ${b}`}?`;
    }
    if (market.templateId === TEMPLATES.TARGET) {
      const [team, target, , above] = decodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), market.params as `0x${string}`);
      return `Will ${teams[Number(team)]?.symbol ?? `Team ${team}`} finish ${above ? "at or above" : "at or below"} $${(Number(target) / 1e8).toLocaleString()}?`;
    }
    if (market.templateId === TEMPLATES.SPREAD) {
      const [, fixtureId, spread] = decodeAbiParameters(parseAbiParameters("uint256, uint256, int16"), market.params as `0x${string}`);
      const fixture = fixtures.find((f) => f.fixtureId === fixtureId.toString());
      if (fixture?.home && fixture.away) {
        const goals = Math.abs(spread);
        return spread >= 0
          ? `Will ${fixture.home.symbol} beat ${fixture.away.symbol} by more than ${goals} ${goals === 1 ? "goal" : "goals"}?`
          : `Will ${fixture.home.symbol} avoid losing to ${fixture.away.symbol} by ${goals}+ ${goals === 1 ? "goal" : "goals"}?`;
      }
      return "Will the home team cover the fixture spread?";
    }
  } catch {
    return TEMPLATE_NAMES[market.templateId] ?? "Prediction market";
  }
  return TEMPLATE_NAMES[market.templateId] ?? "Prediction market";
}

function marketSubheading(market: MarketSummary, teams: { symbol: string }[]) {
  try {
    if (market.templateId === TEMPLATES.TOP_GAINER) {
      const [, matchday] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), market.params as `0x${string}`);
      return `Matchday ${Number(matchday) + 1} · ${market.outcomeCount} coins`;
    }
    if (market.templateId === TEMPLATES.CHAMPION) return `Season market · ${teams.length} teams competing`;
    if (market.templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params as `0x${string}`);
      return `${teams[Number(a)]?.symbol ?? `Team ${a}`} vs ${teams[Number(b)]?.symbol ?? `Team ${b}`}`;
    }
    if (market.templateId === TEMPLATES.TARGET) {
      const [team, target, , above] = decodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), market.params as `0x${string}`);
      return `${teams[Number(team)]?.symbol ?? `Team ${team}`} target · ${above ? "≥" : "≤"} $${(Number(target) / 1e8).toLocaleString()}`;
    }
  } catch {
    return `${market.outcomeCount} outcomes`;
  }
  return `${market.outcomeCount} outcomes`;
}

function MarketCard({ market, teams, fixtures, prices, priceFresh, featured = false }: { market: MarketSummary; teams: { symbol: string }[]; fixtures: ApiFixture[]; prices: Record<string, number>; priceFresh: boolean; featured?: boolean }) {
  const { feesBps } = useMarketFees();
  const { dataUpdatedAt: quoteAsOf } = useMarkets();
  const total = market.outcomeTotals.reduce((a, v) => a + BigInt(v), 0n);
  const poolAmount = pool(market);
  const largest = market.outcomeTotals.reduce((best, v, i, arr) => BigInt(v) > BigInt(arr[best] ?? "0") ? i : best, 0);
  const targetTeamId = priceTargetTeamId(market);
  const rankedOutcomes = market.outcomeTotals.map((amount, index) => ({ amount, index }));
  if (market.templateId === TEMPLATES.TOP_GAINER || market.templateId === TEMPLATES.CHAMPION) {
    rankedOutcomes.sort((a, b) => BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : a.index - b.index);
  }
  const closeTime = market.bettingCloseTime * 1000;
  // Quick-stake chips: same outcome set shown on the card, resolved to team
  // ids where the template encodes one (Top Gainer / Champion map index→team).
  const isOpen = open(market);
  const [quickPick, setQuickPick] = useState<QuickStakeOutcome | null>(null);
  const quickOutcomes: QuickStakeOutcome[] = market.outcomeTotals.map((amount, index) => {
    const total_ = total;
    const teamId =
      market.templateId === TEMPLATES.TOP_GAINER || market.templateId === TEMPLATES.CHAMPION
        ? index
        : priceTargetTeamId(market);
    return {
      index,
      label: outcomeLabel(market, index, teams),
      share: total_ > 0n ? Number((BigInt(amount) * 10_000n) / total_) / 100 : 0,
      odds: feesBps ? marketOdds({ stake: 10n * 10n ** 18n, sideStaked: BigInt(amount), totalStaked: BigInt(market.totalStaked), seed: BigInt(market.seedAmount), feesBps })?.multiplier ?? null : null,
      total: BigInt(amount),
      teamId,
    };
  });

  // Chips are buttons, so they sit outside the <Link> (invalid nesting
  // otherwise); the wrapper carries `group` for hover reveal.
  return (
    <div className="group relative flex h-full flex-col">
    <Link href={`/markets/${market.id}`} className={`relative flex h-full flex-col overflow-hidden ${card} transition duration-300 hover:-translate-y-1 hover:border-[#2E7CF6]/40 hover:shadow-[0_20px_60px_rgba(46,124,246,.13)] ${featured ? "p-6 sm:p-8" : "p-5"}`}>
      {featured && <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[#2E7CF6]/10 blur-3xl" />}
      <div className="relative flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.16em] text-[#2E7CF6]"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#2E7CF6]/10"><Trophy className="h-4 w-4" /></span>{TEMPLATE_NAMES[market.templateId] ?? "Featured market"}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider ${open(market) ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/10 text-zinc-500"}`}><i className={`h-1.5 w-1.5 rounded-full ${open(market) ? "bg-emerald-500" : "bg-zinc-400"}`} />{open(market) ? "Open" : "Closed"}</span>
      </div>
      <h3 className={`relative mt-5 max-w-2xl font-display font-bold leading-tight tracking-tight text-zinc-950 dark:text-white ${featured ? "text-2xl sm:text-3xl" : "text-lg"}`}>
        {marketQuestion(market, teams, fixtures)}
      </h3>
      {market.templateId !== TEMPLATES.TARGET && <p className="relative mt-2 text-sm text-zinc-500 dark:text-zinc-400">{marketSubheading(market, teams)}</p>}
      {market.templateId === TEMPLATES.TARGET && targetTeamId !== null && <div className="relative mt-4 flex items-center gap-3"><TeamBadge teamId={targetTeamId} size={40} showName={false} showSymbol /><span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Target coin</span></div>}
      {market.templateId === TEMPLATES.TARGET && targetTeamId !== null && market.state === 0 && <TargetCardStatus params={market.params as `0x${string}`} symbol={teams[targetTeamId]?.symbol ?? `#${targetTeamId}`} price={prices[teams[targetTeamId]?.symbol ?? ""]} fresh={priceFresh} />}
      {market.templateId === TEMPLATES.SPREAD && <SpreadFixtureBadges market={market} fixtures={fixtures} className="relative mt-4" />}
      {market.templateId === TEMPLATES.TARGET ? <div className="relative mt-5 grid grid-cols-1 gap-2.5">
        {rankedOutcomes.map(({ amount, index }) => {
          const pct = total ? Number(BigInt(amount) * 10000n / total) / 100 : 0;
          const leading = index === largest && total > 0n;
          return <div key={index} className={`min-w-0 rounded-2xl border px-4 py-3.5 ${leading ? "border-[#2E7CF6]/35 bg-[#2E7CF6]/[.07]" : "border-black/[.06] bg-black/[.02] dark:border-white/[.07] dark:bg-white/[.025]"}`}>
            <div className="flex items-center gap-3">
              <span className="text-sm font-extrabold text-zinc-800 dark:text-zinc-100">{outcomeLabel(market, index, teams)}</span>
              <span className="ml-auto shrink-0 text-right"><span className="block font-display text-base font-black tabular-nums text-zinc-950 dark:text-white sm:text-xl">{formatMarketOdds(quickOutcomes[index].odds ?? null)}</span>{open(market) && isHighPayout(quickOutcomes[index].odds ?? null, BigInt(market.totalStaked), 10n * 10n ** 18n, BigInt(amount)) && <span className="block text-[9px] font-bold uppercase text-amber-600 dark:text-amber-300 sm:text-[10px]">High payout</span>}</span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]"><div className={`h-full rounded-full ${leading ? "bg-gradient-to-r from-[#2E7CF6] to-cyan-400" : "bg-zinc-300 dark:bg-zinc-600"}`} style={{ width: `${Math.max(pct, pct ? 3 : 0)}%` }} /></div>
          </div>;
        })}
      </div> : <div className={`relative mt-6 grid grid-cols-2 gap-2 ${featured ? "sm:grid-cols-4" : ""}`}>
        {rankedOutcomes.slice(0, featured ? 8 : 4).map(({ amount, index }) => {
          const pct = total ? Number(BigInt(amount) * 10000n / total) / 100 : 0;
          const leading = index === largest && total > 0n;
          return <div key={index} className={`min-w-0 rounded-2xl border p-3 ${leading ? "border-[#2E7CF6]/35 bg-[#2E7CF6]/[.07]" : "border-black/[.06] bg-black/[.02] dark:border-white/[.07] dark:bg-white/[.025]"}`}>
            <div className="flex min-w-0 items-center gap-1 sm:gap-2.5">
              {(market.templateId === TEMPLATES.TOP_GAINER || market.templateId === TEMPLATES.CHAMPION) && <TeamBadge teamId={index} size={20} showName={false} />}
              <span className="min-w-0 flex-1 truncate text-xs font-bold text-zinc-800 dark:text-zinc-100 sm:text-sm">{outcomeLabel(market, index, teams)}</span>
              <span className="shrink-0 text-right"><span className="block font-display text-xs font-black tabular-nums text-zinc-950 dark:text-white sm:text-base">{formatMarketOdds(quickOutcomes[index].odds ?? null)}</span>{open(market) && isHighPayout(quickOutcomes[index].odds ?? null, BigInt(market.totalStaked), 10n * 10n ** 18n, BigInt(amount)) && <span className="block text-[8px] font-bold uppercase text-amber-600 dark:text-amber-300 sm:text-[9px]">High payout</span>}</span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]"><div className={`h-full rounded-full ${leading ? "bg-gradient-to-r from-[#2E7CF6] to-cyan-400" : "bg-zinc-300 dark:bg-zinc-600"}`} style={{ width: `${Math.max(pct, pct ? 3 : 0)}%` }} /></div>
          </div>;
        })}
      </div>}
      <p className="mt-3 hidden text-[10px] text-zinc-500 sm:block">Projected for 10 TICK, assuming one winner · {quoteAsOf ? `quote refreshed ${new Date(quoteAsOf).toLocaleTimeString()}` : "checking pool"} · final odds may move</p>
      <div className="relative mt-auto flex items-center justify-between gap-3 border-t border-black/[.06] pt-4 dark:border-white/[.07]" style={{ marginTop: featured ? 24 : 18 }}>
        <div><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Total pool</p><p className="mt-0.5 font-display text-sm font-extrabold tabular-nums text-zinc-900 dark:text-white">{formatTick(poolAmount)} <span className="text-xs font-semibold text-zinc-500">TICK</span></p></div>
        {open(market) ? <div className="flex items-center gap-1.5 text-xs font-semibold tabular-nums text-zinc-500"><Clock3 className="h-3.5 w-3.5" /><Countdown target={closeTime} /></div> : <span className="text-xs font-semibold text-zinc-500">View market</span>}
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[#2E7CF6] text-white transition-transform group-hover:translate-x-1"><ArrowUpRight className="h-4 w-4" /></span>
      </div>
    </Link>
      <div className="relative -mt-2 px-1 pb-1">
        <QuickStakeChips outcomes={quickOutcomes} bettingOpen={isOpen} onPick={setQuickPick} />
      </div>
      <QuickStakeSheet
        marketId={BigInt(market.id)}
        question={marketQuestion(market, teams, fixtures)}
        outcome={quickPick}
        outcomeTotals={market.outcomeTotals.map((v) => BigInt(v))}
        totalStaked={BigInt(market.totalStaked)}
        seedAmount={BigInt(market.seedAmount)}
        feesBps={feesBps}
        onClose={() => setQuickPick(null)}
      />
    </div>
  );
}

function FeaturedCarousel({ markets, teams, fixtures, prices, priceFresh, loading }: { markets: MarketSummary[]; teams: { symbol: string }[]; fixtures: ApiFixture[]; prices: Record<string, number>; priceFresh: boolean; loading: boolean }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => { if (markets.length < 2 || paused) return; const timer = window.setInterval(() => setIndex((i) => (i + 1) % markets.length), 7000); return () => window.clearInterval(timer); }, [markets.length, paused]);
  if (!markets.length && loading) return <div className={`${card} relative min-h-[390px] overflow-hidden p-6 sm:p-8`} aria-label="Loading featured markets"><div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#2E7CF6]/[.07] via-transparent to-transparent" /><div className="relative flex items-center justify-between"><div className="skeleton h-9 w-36 rounded-xl" /><div className="skeleton h-7 w-20 rounded-full" /></div><div className="relative mt-6 skeleton h-8 w-4/5 rounded-lg" /><div className="relative mt-3 skeleton h-4 w-2/5 rounded-md" /><div className="relative mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="rounded-2xl border border-black/[.05] p-3 dark:border-white/[.06]"><div className="flex items-center gap-2"><span className="skeleton h-7 w-7 rounded-full" /><span className="skeleton h-4 flex-1 rounded-md" /><span className="skeleton h-4 w-8 rounded-md" /></div><div className="skeleton mt-3 h-1.5 rounded-full" /></div>)}</div><div className="relative mt-7 flex items-center justify-between border-t border-black/[.06] pt-4 dark:border-white/[.07]"><div className="skeleton h-8 w-28 rounded-lg" /><div className="skeleton h-9 w-9 rounded-full" /></div></div>;
  if (!markets.length) return <div className={`${card} flex min-h-64 flex-col justify-center p-8`}><Sparkles className="h-6 w-6 text-[#2E7CF6]" /><h2 className="mt-4 font-display text-xl font-bold">No featured markets are open</h2><p className="mt-1 text-sm text-zinc-500">Top Gainer and Season Champion markets will appear here when available.</p></div>;
  const market = markets[index % markets.length];
  return <div className="relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false); }}>
    <MarketCard key={market.id} market={market} teams={teams} fixtures={fixtures} prices={prices} priceFresh={priceFresh} featured />
    {markets.length > 1 && <div className="absolute bottom-5 right-6 z-10 flex items-center gap-2 sm:bottom-9 sm:right-8"><button aria-label="Previous featured market" onClick={() => setIndex((i) => (i - 1 + markets.length) % markets.length)} className="grid h-9 w-9 place-items-center rounded-full border border-black/10 bg-white/90 text-zinc-700 shadow dark:border-white/10 dark:bg-[#141a23] dark:text-white"><ChevronLeft className="h-4 w-4" /></button><span className="min-w-10 text-center text-xs font-bold tabular-nums text-zinc-500">{index + 1} / {markets.length}</span><button aria-label="Next featured market" onClick={() => setIndex((i) => (i + 1) % markets.length)} className="grid h-9 w-9 place-items-center rounded-full border border-black/10 bg-white/90 text-zinc-700 shadow dark:border-white/10 dark:bg-[#141a23] dark:text-white"><ChevronRight className="h-4 w-4" /></button></div>}
    <div className="mt-3 flex justify-center gap-1.5">{markets.map((m, i) => <button key={m.id} aria-label={`Show featured market ${i + 1}`} onClick={() => setIndex(i)} className={`h-1.5 rounded-full transition-all ${i === index ? "w-7 bg-[#2E7CF6]" : "w-1.5 bg-zinc-300 dark:bg-zinc-700"}`} />)}</div>
  </div>;
}

function SectionHeading({ icon: Icon, title, subtitle, href }: { icon: typeof Flame; title: string; subtitle: string; href?: string }) {
  return <div className="mb-4 flex items-end justify-between gap-3"><div><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-[#2E7CF6]" /><h2 className="font-display text-lg font-bold text-zinc-950 dark:text-white">{title}</h2></div><p className="mt-1 text-xs text-zinc-500">{subtitle}</p></div>{href && <Link href={href} className="inline-flex items-center gap-1 text-xs font-bold text-[#2E7CF6] hover:underline">View all <ArrowRight className="h-3.5 w-3.5" /></Link>}</div>;
}

function LiveFixtureCard({ fixture, prices }: { fixture: ApiFixture; prices: Record<string, number> }) {
  const [snapshot, setSnapshot] = useState<{ homeStart: bigint; awayStart: bigint } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!CONTRACTS.priceOracle) return;
    getPublicClient().readContract({
      address: CONTRACTS.priceOracle as `0x${string}`,
      abi: PRICE_ORACLE_ABI,
      functionName: "getSnapshot",
      args: [SEASON_ID, BigInt(fixture.fixtureId)],
    }).then((raw) => {
      const s = raw as { homeStart: bigint; awayStart: bigint; startSubmitted: boolean };
      if (alive && s.startSubmitted) setSnapshot({ homeStart: s.homeStart, awayStart: s.awayStart });
    }).catch(() => {});
    return () => { alive = false; };
  }, [fixture.fixtureId]);
  if (!fixture.home || !fixture.away) return null;
  const change = (start: bigint, price: number | undefined) => start > 0n && price !== undefined ? (price - Number(start) / 1e8) / (Number(start) / 1e8) * 100 : null;
  const h = change(snapshot?.homeStart ?? 0n, prices[fixture.home.symbol]);
  const a = change(snapshot?.awayStart ?? 0n, prices[fixture.away.symbol]);
  const score = h === null || a === null ? null : normalizeScoreline(roundPctLikeOracle(h), roundPctLikeOracle(a));
  const homeLeads = h !== null && (a === null || h > a);
  const awayLeads = a !== null && (h === null || a > h);
  const kickoff = fixture.kickoff ? Date.parse(fixture.kickoff) : Date.now();
  const minutes = Math.max(0, Math.ceil((kickoff + getMatchDurationMs() - Date.now()) / 60_000));
  return <Link href={`/match/${fixture.fixtureId}`} className={`${card} group block overflow-hidden p-5 transition hover:-translate-y-0.5 hover:border-red-500/30`}>
    <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-red-500"><Radio className="h-3 w-3 animate-pulse" /> Live</span><span className="text-xs font-semibold text-zinc-500">{minutes}m left</span></div>
    <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <div className="min-w-0"><TeamBadge teamId={fixture.home.teamId} size={34} showName={false} /><p className="mt-2 truncate text-sm font-bold">{fixture.home.name}</p><p className={`mt-0.5 text-xs font-bold tabular-nums ${h === null ? "text-zinc-400" : h >= 0 ? "text-emerald-500" : "text-red-500"}`}>{h === null ? "Waiting for price" : formatSignedPct(h)}</p></div>
      <div className="rounded-2xl border border-black/[.06] bg-black/[.025] px-4 py-3 text-center dark:border-white/[.07] dark:bg-white/[.025]"><p className="font-display text-2xl font-extrabold tabular-nums">{score ? `${score[0]}:${score[1]}` : "– : –"}</p><p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-zinc-400">Live score</p></div>
      <div className="min-w-0 text-right"><div className="flex justify-end"><TeamBadge teamId={fixture.away.teamId} size={34} showName={false} /></div><p className="mt-2 truncate text-sm font-bold">{fixture.away.name}</p><p className={`mt-0.5 text-xs font-bold tabular-nums ${a === null ? "text-zinc-400" : a >= 0 ? "text-emerald-500" : "text-red-500"}`}>{a === null ? "Waiting for price" : formatSignedPct(a)}</p></div>
    </div>
    <div className="mt-4 flex items-center justify-between border-t border-black/[.06] pt-3 text-xs dark:border-white/[.07]"><span className="font-semibold text-zinc-500">Matchday {fixture.matchdayIndex + 1}</span><span className="inline-flex items-center gap-1 font-bold text-[#2E7CF6]">Open match <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></span></div>
  </Link>;
}

export default function HomePage() {
  useFactoryEvents();
  const { markets, isLoading } = useMarkets();
  const { teams: teamData } = useTeams();
  const { authenticated } = useTickr();
  const { prices, status: priceStatus } = usePriceFeed(true);
  const teams = teamData ?? [];
  const [fixtures, setFixtures] = useState<ApiFixture[]>([]);
  const [table, setTable] = useState<ApiTableRow[] | null>(null);
  useEffect(() => {
    let live = true;
    const loadFixtures = () => { api.fixtures().then((v) => { if (live) setFixtures(v); }).catch(() => {}); };
    const loadTable = () => { api.table().then((v) => { if (live) setTable(v); }).catch(() => {}); };
    loadFixtures(); loadTable();
    const fixtureTimer = window.setInterval(loadFixtures, 15_000);
    const dataTimer = window.setInterval(() => { if (!table || table.length === 0) loadTable(); }, 15_000);
    return () => { live = false; window.clearInterval(fixtureTimer); window.clearInterval(dataTimer); };
  }, [table?.length]);
  const sorted = useMemo(() => [...(markets ?? [])].filter(open).sort((a, b) => Number(pool(b) - pool(a))), [markets]);
  const featured = useMemo(() => (markets ?? []).filter((m) => (m.templateId === TEMPLATES.TOP_GAINER || m.templateId === TEMPLATES.CHAMPION) && m.state === 0), [markets]);
  const liveMatches = fixtures.filter((f) => fixtureStatus(f) === "live");
  const upcoming = fixtures.filter((f) => { const s = fixtureStatus(f); return s === "upcoming" || s === "scheduled"; }).sort((a, b) => Date.parse(a.kickoff ?? a.scheduledKickoff ?? "") - Date.parse(b.kickoff ?? b.scheduledKickoff ?? "")).slice(0, 6);
  const closing = useMemo(() => [...sorted].sort((a, b) => duration(a) - duration(b)).slice(0, 12), [sorted]);
  const names = teams.map((t) => ({ symbol: t.symbol }));

  return <div className="space-y-10 pb-14">
    <PriceTicker prices={prices} />
    {authenticated && <MyPicksDashboard markets={markets ?? []} fixtures={fixtures} teams={teams} />}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_350px]">
      <section><div className="mb-4"><p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#2E7CF6]">The market is moving</p><h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-zinc-950 dark:text-white sm:text-3xl">Featured markets</h1></div><FeaturedCarousel markets={featured} teams={names} fixtures={fixtures} prices={prices} priceFresh={priceStatus !== "stale"} loading={isLoading && !markets} /></section>
      <aside className="space-y-5"><section><div className="mb-3 flex items-center justify-between">{table === null ? <div className="skeleton h-5 w-28 rounded-md" aria-hidden /> : <h2 className="font-display text-base font-bold">League table</h2>}<Link href="/standings" className="text-xs font-bold text-[#2E7CF6]">Full table</Link></div><div className={card + " overflow-hidden p-2"}>{table === null ? <LeagueTableSkeleton rows={8} compact /> : <LeagueTable rows={table} limit={8} compact />}</div></section>
        {authenticated && <Link href="/markets/create" className="group block overflow-hidden rounded-3xl bg-gradient-to-br from-[#1765dc] via-[#2E7CF6] to-[#6ea7ff] p-5 text-white shadow-lg shadow-[#2E7CF6]/20 transition hover:-translate-y-0.5"><div className="flex items-start justify-between"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/15"><Zap className="h-5 w-5" /></span><ArrowUpRight className="h-5 w-5 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" /></div><h3 className="mt-4 max-w-[16rem] font-display text-lg font-extrabold leading-snug">Get others to stake on your market.</h3><p className="mt-1 text-sm text-white/75">Make your call. Bring the crowd.</p><span className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-extrabold text-[#1d5fc9]">Create a market <ArrowRight className="h-4 w-4" /></span></Link>}
      </aside>
    </div>

    {liveMatches.length > 0 && <section><SectionHeading icon={Flame} title="Matches in play" subtitle="Live crypto performance score · tap a match to stake" href="/fixtures" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{liveMatches.map((f) => <LiveFixtureCard key={f.fixtureId} fixture={f} prices={prices} />)}</div></section>}

    {upcoming.length > 0 && <section><SectionHeading icon={Clock3} title="Upcoming matches" subtitle="The next fixtures on the schedule" href="/fixtures" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{upcoming.map((f) => <FixtureCard key={f.fixtureId} fixture={f} />)}</div></section>}

    <section><SectionHeading icon={Flame} title="Trending markets" subtitle="The biggest pools right now" href="/markets" />{isLoading && !markets ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><div className={`${card} h-64 animate-pulse`} /><div className={`${card} h-64 animate-pulse`} /><div className={`${card} h-64 animate-pulse`} /></div> : sorted.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sorted.slice(0, 6).map((m) => <MarketCard key={m.id} market={m} teams={names} fixtures={fixtures} prices={prices} priceFresh={priceStatus !== "stale"} />)}</div> : <div className={`${card} p-8 text-center text-sm text-zinc-500`}>No open markets yet. Check back soon.</div>}</section>

    {closing.length > 0 && <section><SectionHeading icon={Clock3} title="Closing soon" subtitle="A final chance to take a position" href="/markets" /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{closing.map((m) => <MarketCard key={m.id} market={m} teams={names} fixtures={fixtures} prices={prices} priceFresh={priceStatus !== "stale"} />)}</div></section>}
  </div>;
}

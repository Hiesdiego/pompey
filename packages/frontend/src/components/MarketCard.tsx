"use client";

import { useState } from "react";
import Link from "next/link";
import { Trophy, Clock, ArrowUpRight } from "lucide-react";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { targetCoinById } from "../lib/targetCoins";
import { formatPriceTargetUsd, priceTargetQuestion } from "../lib/priceTargetQuestion";
import { formatUtcTime } from "../lib/utcTime";
import { MARKET_FACTORY_ADDRESS, TEMPLATE_NAMES, TEMPLATES } from "../lib/marketFactory";
import { SEASON_DISPLAY_NAME } from "../lib/contracts";
import { Countdown } from "./Countdown";
import { ShareButtons } from "./ShareButtons";
import { formatTick } from "../lib/format";
import { TeamBadge } from "./TeamBadge";
import { SpreadFixtureBadges } from "./SpreadFixtureBadges";
import { QuickStakeChips, QuickStakeSheet, type QuickStakeOutcome } from "./QuickStake";
import { type ApiFixture, type ApiFixtureTeam } from "../lib/api";
import { TargetCardStatus } from "./TargetCardStatus";
import { marketOdds, formatMarketOdds, isHighPayout } from "../lib/marketOdds";
import { useMarketFees } from "../lib/query/useMarketFees";
export interface MarketSummary {
  id: bigint;
  marketKey: string;
  factoryAddress: `0x${string}`;
  templateId: number;
  creator: string;
  creatorName: string;
  bettingCloseTime: bigint;
  endTime: bigint;
  outcomeCount: number;
  seedAmount: bigint;
  totalStaked: bigint;
  state: number;
  winnerBitmap: bigint;
  params: `0x${string}`;
  outcomeTotals: bigint[];
  lastStakeAt: number;
}

export type TeamRef = { teamId: number; name: string; symbol: string };

function outcomeTeamId(
  market: MarketSummary,
  outcomeIndex: number,
  fixtures: Map<string, ApiFixture> = new Map()
): number | null {
  try {
    if (market.templateId === TEMPLATES.TOP_GAINER || market.templateId === TEMPLATES.CHAMPION) {
      return outcomeIndex;
    }
    if (market.templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params);
      return outcomeIndex === 0 ? a : b;
    }
    if (market.templateId === TEMPLATES.TARGET) {
      return Number(decodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), market.params)[0]);
    }
    if (market.templateId === TEMPLATES.SPREAD) {
      const si = getSpreadInfo(market, fixtures);
      const team = outcomeIndex === 0 ? si?.home : si?.away;
      return team?.teamId ?? null;
    }
  } catch {
  }
  return null;
}

function outcomeLabel(
  market: MarketSummary,
  outcomeIndex: number,
  teams: TeamRef[],
  fixtures: Map<string, ApiFixture> = new Map()
): string {
  try {
    if (market.templateId === TEMPLATES.TOP_GAINER || market.templateId === TEMPLATES.CHAMPION) {
      return teams.find((t) => t.teamId === outcomeIndex)?.symbol ?? `Outcome ${outcomeIndex + 1}`;
    }
    if (market.templateId === TEMPLATES.H2H) {
      const teamId = outcomeTeamId(market, outcomeIndex, fixtures);
      return `${teams.find((t) => t.teamId === teamId)?.symbol ?? `#${teamId}`} wins`;
    }
    if (market.templateId === TEMPLATES.TARGET) return outcomeIndex === 0 ? "Yes" : "No";
    if (market.templateId === TEMPLATES.SPREAD) return outcomeIndex === 0 ? "Yes" : "No";
  } catch {
  }
  return `Outcome ${outcomeIndex + 1}`;
}

function teamSymbol(teams: TeamRef[], teamId: number): string {
  return teams.find((t) => t.teamId === teamId)?.symbol ?? targetCoinById(teamId)?.symbol ?? `#${teamId}`;
}

interface SpreadInfo {
  fixtureId: string;
  spread: number;
  home: ApiFixtureTeam | null;
  away: ApiFixtureTeam | null;
  matchdayIndex: number;
  kickoff: string | null;
}

function getSpreadInfo(market: MarketSummary, fixtures: Map<string, ApiFixture>): SpreadInfo | null {
  try {
    const [, fixtureId, spread] = decodeAbiParameters(parseAbiParameters("uint256, uint256, int16"), market.params);
    const f = fixtures.get(fixtureId.toString());
    return {
      fixtureId: fixtureId.toString(),
      spread,
      home: f?.home ?? null,
      away: f?.away ?? null,
      matchdayIndex: f?.matchdayIndex ?? -1,
      kickoff: f?.kickoff ?? null,
    };
  } catch {
    return null;
  }
}

function marketMeta(
  market: MarketSummary,
  teams: TeamRef[],
  fixtures: Map<string, ApiFixture> = new Map()
): string {
  try {
    if (market.templateId === TEMPLATES.TOP_GAINER) {
      const [, matchday] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), market.params);
      return `Matchday ${Number(matchday) + 1} · ${market.outcomeCount} coins`;
    }
    if (market.templateId === TEMPLATES.CHAMPION) return `${SEASON_DISPLAY_NAME} · ${market.outcomeCount} coins`;
    if (market.templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params);
      return `${teamSymbol(teams, a)} vs ${teamSymbol(teams, b)}`;
    }
    if (market.templateId === TEMPLATES.TARGET) {
      const [team, price, , above] = decodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), market.params);
      return `${teamSymbol(teams, team)} ${above ? "≥" : "≤"} ${formatPriceTargetUsd(Number(price) / 1e8)}`;
    }
    const si = getSpreadInfo(market, fixtures);
    if (si) {
      const md = si.matchdayIndex >= 0 ? ` · Matchday ${si.matchdayIndex + 1}` : "";
      return `Fixture #${si.fixtureId}${md}`;
    }
    return `${market.outcomeCount} outcomes`;
  } catch {
    return `${market.outcomeCount} outcomes`;
  }
}

function describeCardMarket(
  market: MarketSummary,
  teams: TeamRef[],
  fixtures: Map<string, ApiFixture> = new Map()
): string {
  try {
    if (market.templateId === TEMPLATES.TOP_GAINER) {
      const [, matchday] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), market.params);
      return `Which coin gains the most on matchday ${Number(matchday) + 1}?`;
    }
    if (market.templateId === TEMPLATES.CHAMPION) return "Who will win the season championship?";
    if (market.templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params);
      return `Will ${teamSymbol(teams, a)} outperform ${teamSymbol(teams, b)}?`;
    }
    if (market.templateId === TEMPLATES.TARGET) {
      const [team, price, atTime, above] = decodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), market.params);
      const symbol = teamSymbol(teams, team);
      return priceTargetQuestion(symbol, Number(price) / 1e8, above, new Date(Number(atTime) * 1000));
    }
    const si = getSpreadInfo(market, fixtures);
    if (si?.home && si?.away) {
      const abs = Math.abs(si.spread);
      const goalWord = abs === 1 ? "goal" : "goals";
      if (si.spread >= 0) {
        return `Will ${si.home.symbol} beat ${si.away.symbol} by more than ${abs} ${goalWord}?`;
      }
      return `Will ${si.home.symbol} avoid losing to ${si.away.symbol} by ${abs}+ ${goalWord}?`;
    }
    return "Will the home team cover the fixture spread?";
  } catch {
    return TEMPLATE_NAMES[market.templateId] ?? "Prediction market";
  }
}


export function MarketCard({
  market,
  teams,
  fixtures,
  prices,
  priceFresh,
  feesBps,
  quoteAsOf,
}: {
  market: MarketSummary;
  teams: TeamRef[];
  fixtures: Map<string, ApiFixture>;
  prices: Record<string, number>;
  priceFresh: boolean;
  feesBps: readonly [number, number, number] | null;
  quoteAsOf: number;
}) {
  const { feesBps: factoryFees } = useMarketFees(market.factoryAddress);
  const effectiveFeesBps = factoryFees ?? (market.factoryAddress.toLowerCase() === MARKET_FACTORY_ADDRESS?.toLowerCase() ? feesBps : null);
  const nowSec = Math.floor(Date.now() / 1000);
  const bettingOpen = market.state === 0 && Number(market.bettingCloseTime) > nowSec;
  const pendingSettlement = market.state === 0 && Number(market.endTime) <= nowSec;
  const secondsLeft = Number(market.bettingCloseTime) - nowSec;
  const closingSoon = bettingOpen && secondsLeft < 3600;
  const poolTick = market.totalStaked + market.seedAmount;
  const stakedTotal = market.outcomeTotals.reduce((sum, value) => sum + value, 0n);
  const question = describeCardMarket(market, teams, fixtures);
  const meta = marketMeta(market, teams, fixtures);
  const targetTeamId = market.templateId === TEMPLATES.TARGET ? outcomeTeamId(market, 0, fixtures) : null;
  const ranked = market.outcomeTotals.map((amount, index) => ({ amount, index }));
  if (market.templateId === TEMPLATES.TOP_GAINER || market.templateId === TEMPLATES.CHAMPION) {
    ranked.sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.index - b.index);
  }
  const statusClass = bettingOpen
    ? "bg-red-500/10 text-red-500"
    : pendingSettlement
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
    : "bg-zinc-500/10 text-zinc-500";

  const [quickPick, setQuickPick] = useState<QuickStakeOutcome | null>(null);
  const quickOutcomes: QuickStakeOutcome[] = market.outcomeTotals.map((total, index) => ({
    index,
    label: outcomeLabel(market, index, teams, fixtures),
    share: stakedTotal > 0n ? Number((total * 10_000n) / stakedTotal) / 100 : 0,
    odds: bettingOpen && effectiveFeesBps ? marketOdds({ stake: 10n * 10n ** 18n, sideStaked: total, totalStaked: market.totalStaked, seed: market.seedAmount, feesBps: effectiveFeesBps })?.multiplier ?? null : null,
    total,
    teamId: outcomeTeamId(market, index, fixtures),
  }));

  return (
    <div className="group relative flex h-full flex-col">
    <div className="absolute right-3 top-3 z-20">
      <ShareButtons path={`/markets/${market.marketKey}`} text={`${question} — predict on TICKR`} compact />
    </div>
    <Link
      href={`/markets/${market.marketKey}`}
      className="surface-card relative flex h-full flex-col overflow-hidden p-5 transition duration-300 hover:-translate-y-1 hover:border-[#2E7CF6]/40 hover:shadow-[0_20px_60px_rgba(46,124,246,.13)]"
    >
      <div className="relative flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.16em] text-[#2E7CF6]"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#2E7CF6]/10"><Trophy className="h-4 w-4" /></span>{TEMPLATE_NAMES[market.templateId] ?? "Prediction market"}</span>
        <span className={`mr-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider ${statusClass}`}><i className={`h-1.5 w-1.5 rounded-full ${bettingOpen ? "bg-red-500" : pendingSettlement ? "bg-amber-500" : "bg-zinc-400"}`} />{bettingOpen ? closingSoon ? "Closing soon" : "Open" : pendingSettlement ? "Pending settlement" : market.state === 0 ? "Closed" : market.state === 1 ? "Resolved" : "Voided"}</span>
      </div>
      <h3 className="relative mt-5 font-display text-lg font-bold leading-tight tracking-tight text-zinc-950 dark:text-white">
        {question}
      </h3>
      {market.templateId !== TEMPLATES.TARGET && <p className="relative mt-2 text-sm text-zinc-500 dark:text-zinc-400">{meta}</p>}
      {market.templateId === TEMPLATES.TARGET && targetTeamId !== null && <div className="relative mt-4 flex items-center gap-3"><TeamBadge teamId={targetTeamId} size={40} showName={false} showSymbol /><span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Target coin</span></div>}
      {market.templateId === TEMPLATES.TARGET && targetTeamId !== null && market.state === 0 && <TargetCardStatus params={market.params} symbol={teamSymbol(teams, targetTeamId)} price={prices[teamSymbol(teams, targetTeamId)]} fresh={priceFresh} />}
      {market.templateId === TEMPLATES.SPREAD && <SpreadFixtureBadges market={market} fixtures={fixtures} className="relative mt-4" />}
      {market.templateId === TEMPLATES.TARGET ? <div className="relative mt-5 grid grid-cols-1 gap-2.5">
        {ranked.map(({ amount, index }) => {
          const pct = stakedTotal > 0n ? Number((amount * 10_000n) / stakedTotal) / 100 : 0;
          const leading = index === market.outcomeTotals.reduce((best, value, i, all) => value > (all[best] ?? 0n) ? i : best, 0) && stakedTotal > 0n;
          const odds = quickOutcomes[index].odds ?? null;
          const high = bettingOpen && isHighPayout(odds, market.totalStaked, 10n * 10n ** 18n, amount);
          return <div key={index} className={`min-w-0 rounded-2xl border px-4 py-3.5 ${high ? "border-amber-500/40 bg-amber-500/[.07]" : leading ? "border-[#2E7CF6]/35 bg-[#2E7CF6]/[.07]" : "border-black/[.06] bg-black/[.02] dark:border-white/[.07] dark:bg-white/[.025]"}`}><div className="flex items-center gap-3"><span className="min-w-0 flex-1 text-sm font-extrabold text-zinc-800 dark:text-zinc-100">{outcomeLabel(market, index, teams, fixtures)}</span><span className="shrink-0 text-right"><span className="block font-display text-base font-black tabular-nums text-zinc-950 dark:text-white sm:text-xl">{formatMarketOdds(odds)}</span>{high && <span className="block text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-300 sm:text-[10px]">High payout</span>}</span></div><div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]"><div className={`h-full rounded-full ${leading ? "bg-gradient-to-r from-[#2E7CF6] to-cyan-400" : "bg-zinc-300 dark:bg-zinc-600"}`} style={{ width: `${Math.max(pct, pct ? 3 : 0)}%` }} /></div></div>;
        })}
      </div> : <div className="relative mt-6 grid grid-cols-2 gap-2">
        {ranked.slice(0, 4).map(({ amount, index }) => {
          const pct = stakedTotal > 0n ? Number((amount * 10_000n) / stakedTotal) / 100 : 0;
          const leading = index === market.outcomeTotals.reduce((best, value, i, all) => value > (all[best] ?? 0n) ? i : best, 0) && stakedTotal > 0n;
          const odds = quickOutcomes[index].odds ?? null;
          const high = bettingOpen && isHighPayout(odds, market.totalStaked, 10n * 10n ** 18n, amount);
          return <div key={index} className={`min-w-0 rounded-2xl border p-3 ${high ? "border-amber-500/40 bg-amber-500/[.07]" : leading ? "border-[#2E7CF6]/35 bg-[#2E7CF6]/[.07]" : "border-black/[.06] bg-black/[.02] dark:border-white/[.07] dark:bg-white/[.025]"}`}><div className="flex min-w-0 items-center gap-1 sm:gap-2.5">{(market.templateId === TEMPLATES.TOP_GAINER || market.templateId === TEMPLATES.CHAMPION) && <TeamBadge teamId={index} size={20} showName={false} />}<span className="min-w-0 flex-1 truncate text-xs font-bold text-zinc-800 dark:text-zinc-100 sm:text-sm">{outcomeLabel(market, index, teams, fixtures)}</span><span className="shrink-0 text-right"><span className="block font-display text-xs font-black tabular-nums text-zinc-950 dark:text-white sm:text-base">{formatMarketOdds(odds)}</span>{high && <span className="block text-[8px] font-bold uppercase text-amber-600 dark:text-amber-300 sm:text-[9px]">High payout</span>}</span></div><div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]"><div className={`h-full rounded-full ${leading ? "bg-gradient-to-r from-[#2E7CF6] to-cyan-400" : "bg-zinc-300 dark:bg-zinc-600"}`} style={{ width: `${Math.max(pct, pct ? 3 : 0)}%` }} /></div></div>;
        })}
      </div>}
      <p className="mt-3 hidden text-[10px] text-zinc-500 sm:block">{bettingOpen ? `Projected for 10 TICK, assuming one winner · ${quoteAsOf ? `quote refreshed ${formatUtcTime(quoteAsOf)}` : "checking pool"} · final odds may move` : "Betting closed · no new stake quote"}</p>
      <div className="relative mt-auto flex items-center justify-between gap-3 border-t border-black/[.06] pt-4 dark:border-white/[.07]" style={{ marginTop: 18 }}>
        <div><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Total pool</p><p className="mt-0.5 font-display text-sm font-extrabold tabular-nums text-zinc-900 dark:text-white">{formatTick(poolTick)} <span className="text-xs font-semibold text-zinc-500">TICK</span></p></div>
        {bettingOpen ? <div className="flex items-center gap-1.5 text-xs font-semibold tabular-nums text-zinc-500"><Clock className="h-3.5 w-3.5" /><Countdown target={Number(market.bettingCloseTime) * 1000} /></div> : <span className="text-xs font-semibold text-zinc-500">View market</span>}
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[#2E7CF6] text-white transition-transform group-hover:translate-x-1"><ArrowUpRight className="h-4 w-4" /></span>
      </div>
    </Link>
      <div className="relative -mt-2 px-1 pb-1">
        <QuickStakeChips
          outcomes={quickOutcomes}
          bettingOpen={bettingOpen}
          onPick={setQuickPick}
        />
      </div>
      <QuickStakeSheet
        marketId={market.id}
        marketKey={market.marketKey}
        factoryAddress={market.factoryAddress}
        question={question}
        outcome={quickPick}
        outcomeTotals={market.outcomeTotals}
        totalStaked={market.totalStaked}
        seedAmount={market.seedAmount}
        feesBps={effectiveFeesBps}
        onClose={() => setQuickPick(null)}
      />
    </div>
  );
}

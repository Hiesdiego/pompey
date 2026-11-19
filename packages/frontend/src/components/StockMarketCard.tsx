/**
 * StockMarketCard, the stock price-target card for the /markets board.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/StockMarketCard.tsx
 *
 * This mirrors components/MarketCard.tsx for the crypto TARGET template
 * exactly: same outer surface-card shell, same header row (template
 * chip plus status pill), same question typography, same Yes/No rows
 * with live multipliers from lib/marketOdds, the same pool-share bar,
 * the same "Projected for 10 TICK" caption and the same footer with a
 * countdown and the arrow affordance. Two deliberate differences, both
 * from the locked spec:
 *   1. The stock logo (StockLogo) sits in the coin logo slot where the
 *      crypto card renders TeamBadge for the target coin.
 *   2. NO pool size is shown. The crypto card footer prints the total
 *      pool; the stock card footer prints the deadline in UTC instead,
 *      per the spec ("NO pool size shown on the card, deadline in UTC").
 *      The detail page still shows the pool, exactly like crypto.
 *
 * Multipliers are computed with the same marketOdds call the crypto
 * card uses (10 TICK reference stake, post-fee, seed included), so a
 * stock card and a crypto card with the same pools quote identically.
 *
 * Quick stake: the crypto card's QuickStakeSheet hardcodes
 * MARKET_FACTORY_ABI, so it cannot stake on the stock factory. Rather
 * than fork a second sheet, the stock card links to the detail page
 * where the stake flow mirrors crypto exactly. See the delivery report.
 */

"use client";

import Link from "next/link";
import { Target, Clock, ArrowUpRight } from "lucide-react";
import {
  STOCK_MARKET_FACTORY_ADDRESS,
  stockMarketRouteKey,
  stockPriceTargetQuestion,
  stockDisplaySymbol,
  type StockMarketSummary,
} from "../lib/stockMarketContracts";
import { formatUtcDateTime, formatUtcTime } from "../lib/utcTime";
import { Countdown } from "./Countdown";
import { ShareButtons } from "./ShareButtons";
import { StockLogo } from "./StockLogo";
import { marketOdds, formatMarketOdds, isHighPayout } from "../lib/marketOdds";
import { useMarketFees } from "../lib/query/useMarketFees";
import { useState } from "react";
import { QuickStakeChips, QuickStakeSheet, type QuickStakeOutcome } from "./QuickStake";

/** Board-ready shape: the API summary with bigints restored, mirroring MarketSummary. */
export interface StockMarketCardData {
  id: bigint;
  marketKey: string;
  factoryAddress: `0x${string}`;
  creator: string;
  creatorName: string;
  bettingCloseTime: bigint;
  endTime: bigint;
  outcomeCount: number;
  seedAmount: bigint;
  totalStaked: bigint;
  state: number;
  winnerBitmap: bigint;
  outcomeTotals: bigint[];
  tokenAddress: string;
  symbol: string;
  name: string;
  iconUrl: string | null;
  targetPrice: bigint;
  above: boolean;
}

export function stockCardDataFromSummary(s: StockMarketSummary): StockMarketCardData {
  return {
    id: BigInt(s.id),
    marketKey: s.marketKey ?? stockMarketRouteKey(s.id),
    factoryAddress: (s.factoryAddress ?? STOCK_MARKET_FACTORY_ADDRESS) as `0x${string}`,
    creator: s.creator,
    creatorName: s.creatorName,
    bettingCloseTime: BigInt(s.bettingCloseTime),
    endTime: BigInt(s.endTime),
    outcomeCount: s.outcomeCount,
    seedAmount: BigInt(s.seedAmount),
    totalStaked: BigInt(s.totalStaked),
    state: s.state,
    winnerBitmap: BigInt(s.winnerBitmap),
    outcomeTotals: s.outcomeTotals.map((t) => BigInt(t)),
    tokenAddress: s.tokenAddress,
    symbol: s.symbol,
    name: s.name,
    iconUrl: s.iconUrl,
    targetPrice: BigInt(s.targetPrice),
    above: s.above,
  };
}

const OUTCOME_LABELS = ["Yes", "No"] as const;

export function StockMarketCard({
  market,
  feesBps,
  quoteAsOf,
}: {
  market: StockMarketCardData;
  /** Board-level fees for the stock factory; the card refetches its own when null. */
  feesBps: readonly [number, number, number] | null;
  quoteAsOf: number;
}) {
  const [quickPick, setQuickPick] = useState<QuickStakeOutcome | null>(null);
  const { feesBps: factoryFees } = useMarketFees(market.factoryAddress);
  const effectiveFeesBps = factoryFees ?? feesBps;
  const nowSec = Math.floor(Date.now() / 1000);
  const bettingOpen = market.state === 0 && Number(market.bettingCloseTime) > nowSec;
  const pendingSettlement = market.state === 0 && Number(market.endTime) <= nowSec;
  const secondsLeft = Number(market.bettingCloseTime) - nowSec;
  const closingSoon = bettingOpen && secondsLeft < 3600;
  const stakedTotal = market.outcomeTotals.reduce((sum, value) => sum + value, 0n);
  const question = stockPriceTargetQuestion(
    stockDisplaySymbol(market.symbol),
    market.targetPrice,
    market.above,
    new Date(Number(market.endTime) * 1000)
  );
  const statusClass = bettingOpen
    ? "bg-red-500/10 text-red-500"
    : pendingSettlement
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "bg-zinc-500/10 text-zinc-500";

  const ranked = market.outcomeTotals.map((amount, index) => ({ amount, index }));
  const quickOutcomes: QuickStakeOutcome[] = market.outcomeTotals.map((total, index) => ({
    index,
    label: OUTCOME_LABELS[index] ?? `Outcome ${index + 1}`,
    share: stakedTotal > 0n ? Number((total * 10_000n) / stakedTotal) / 100 : 0,
    odds: effectiveFeesBps ? marketOdds({ stake: 10n * 10n ** 18n, sideStaked: total, totalStaked: market.totalStaked, seed: market.seedAmount, feesBps: effectiveFeesBps })?.multiplier ?? null : null,
    total,
    teamId: null,
  }));

  return (
    <div className="group relative flex h-full flex-col">
      <div className="absolute right-3 top-3 z-20">
        <ShareButtons path={`/markets/${market.marketKey}`} text={`${question}, predict on TICKR`} compact />
      </div>
      <Link
        href={`/markets/${market.marketKey}`}
        className="surface-card relative flex h-full flex-col overflow-hidden p-5 transition duration-300 hover:-translate-y-1 hover:border-[#2E7CF6]/40 hover:shadow-[0_20px_60px_rgba(46,124,246,.13)]"
      >
        <div className="relative flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.16em] text-[#2E7CF6]">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#2E7CF6]/10">
              <Target className="h-4 w-4" />
            </span>
            Stock Price Target
          </span>
          <span
            className={`mr-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider ${statusClass}`}
          >
            <i className={`h-1.5 w-1.5 rounded-full ${bettingOpen ? "bg-red-500" : pendingSettlement ? "bg-amber-500" : "bg-zinc-400"}`} />
            {bettingOpen ? (closingSoon ? "Closing soon" : "Open") : pendingSettlement ? "Pending settlement" : market.state === 0 ? "Closed" : market.state === 1 ? "Resolved" : "Voided"}
          </span>
        </div>
        <h3 className="relative mt-5 font-display text-lg font-bold leading-tight tracking-tight text-zinc-950 dark:text-white">
          {question}
        </h3>
        {/* Stock logo in the coin logo slot, exactly where MarketCard renders TeamBadge for TARGET. */}
        <div className="relative mt-4 flex items-center gap-3">
          <StockLogo symbol={market.symbol} iconUrl={market.iconUrl} size={40} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-zinc-800 dark:text-zinc-100">{market.name}</span>
            <span className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {stockDisplaySymbol(market.symbol)} · Target stock
            </span>
          </span>
        </div>
        <div className="relative mt-5 grid grid-cols-1 gap-2.5">
          {ranked.map(({ amount, index }) => {
            const pct = stakedTotal > 0n ? Number((amount * 10_000n) / stakedTotal) / 100 : 0;
            const leading =
              index === market.outcomeTotals.reduce((best, value, i, all) => (value > (all[best] ?? 0n) ? i : best), 0) &&
              stakedTotal > 0n;
            const odds =
              bettingOpen && effectiveFeesBps
                ? marketOdds({
                    stake: 10n * 10n ** 18n,
                    sideStaked: amount,
                    totalStaked: market.totalStaked,
                    seed: market.seedAmount,
                    feesBps: effectiveFeesBps,
                  })?.multiplier ?? null
                : null;
            const high = bettingOpen && isHighPayout(odds, market.totalStaked, 10n * 10n ** 18n, amount);
            return (
              <div
                key={index}
                className={`min-w-0 rounded-2xl border px-4 py-3.5 ${
                  high
                    ? "border-amber-500/40 bg-amber-500/[.07]"
                    : leading
                      ? "border-[#2E7CF6]/35 bg-[#2E7CF6]/[.07]"
                      : "border-black/[.06] bg-black/[.02] dark:border-white/[.07] dark:bg-white/[.025]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm font-extrabold text-zinc-800 dark:text-zinc-100">
                    {OUTCOME_LABELS[index] ?? `Outcome ${index + 1}`}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-display text-base font-black tabular-nums text-zinc-950 dark:text-white sm:text-xl">
                      {formatMarketOdds(odds)}
                    </span>
                    {high && (
                      <span className="block text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-300 sm:text-[10px]">
                        High payout
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
                  <div
                    className={`h-full rounded-full ${leading ? "bg-gradient-to-r from-[#2E7CF6] to-cyan-400" : "bg-zinc-300 dark:bg-zinc-600"}`}
                    style={{ width: `${Math.max(pct, pct ? 3 : 0)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 hidden text-[10px] text-zinc-500 sm:block">
          {bettingOpen
            ? `Projected for 10 TICK, assuming one winner · ${quoteAsOf ? `quote refreshed ${formatUtcTime(quoteAsOf)}` : "checking pool"} · final odds may move`
            : "Betting closed · no new stake quote"}
        </p>
        <div
          className="relative mt-auto flex items-center justify-between gap-3 border-t border-black/[.06] pt-4 dark:border-white/[.07]"
          style={{ marginTop: 18 }}
        >
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Deadline</p>
            <p className="mt-0.5 font-display text-sm font-extrabold tabular-nums text-zinc-900 dark:text-white">
              {formatUtcDateTime(Number(market.endTime) * 1000)}
            </p>
          </div>
          {bettingOpen ? (
            <div className="flex items-center gap-1.5 text-xs font-semibold tabular-nums text-zinc-500">
              <Clock className="h-3.5 w-3.5" />
              <Countdown target={Number(market.bettingCloseTime) * 1000} />
            </div>
          ) : (
            <span className="text-xs font-semibold text-zinc-500">View market</span>
          )}
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#2E7CF6] text-white transition-transform group-hover:translate-x-1">
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>
      </Link>
      <div className="relative -mt-2 px-1 pb-1">
        <QuickStakeChips outcomes={quickOutcomes} bettingOpen={bettingOpen} onPick={setQuickPick} />
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
        variant="stock-target"
        onClose={() => setQuickPick(null)}
      />
    </div>
  );
}

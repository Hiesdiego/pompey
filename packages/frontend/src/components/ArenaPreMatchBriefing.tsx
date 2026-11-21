"use client";

import { BarChart3, Trophy } from "lucide-react";
import {
  ARENA_MIN_STAKE_TICK,
  arenaClashQuestionFor,
  arenaDisplaySymbol,
  type ClashSummary,
  type RankingRow,
  type RegistryMeme,
} from "../lib/arenaContracts";
import { formatTick } from "../lib/format";
import { formatMarketOdds } from "../lib/marketOdds";
import { formatUtcDateTime } from "../lib/utcTime";

/**
 * ArenaPreMatchBriefing, pre-match briefing for meme clashes.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/ArenaPreMatchBriefing.tsx
 *
 * This is the Arena mirror of StockPreMatchBriefing in
 * ./StockPreMatchBriefing.tsx: same section shell, same header with
 * the "Historical context · not a prediction" pill, same two side
 * cards, same pool context block with the example payout for a
 * minimum stake. It cannot reuse the stock briefing directly because
 * that component is typed on StockApiFixture and StockApiPool and
 * reads the stock table, stock fixtures form and the stock pool fee.
 *
 * Data sources here are the Arena equivalents the backend actually
 * serves: the clash summary (question, pool totals, multipliers), the
 * registry row for the meme (BaseStonk price, liquidity, holders,
 * 24 hour volume) and the cup rankings rows (cup record and rating,
 * cup matches only). One stock block has no Arena data source: there
 * is no per-meme recent form endpoint in the Arena backend contract,
 * so the recent form block is replaced by the cup record on each side
 * card, which is the only per-meme history the backend publishes.
 */

function priceLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "pending";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function usdLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function ArenaPreMatchBriefing({
  clash,
  memeRegistry,
  memeRanking,
  oppRanking,
}: {
  clash: ClashSummary;
  memeRegistry: RegistryMeme | null;
  memeRanking: RankingRow | null;
  oppRanking: RankingRow | null;
}) {
  const memeName = clash.memeName ?? arenaDisplaySymbol(clash.memeSymbol);
  const oppName = clash.opponentName ?? arenaDisplaySymbol(clash.opponentSymbol);
  const totals = clash.outcomeTotals.map((t) => {
    try {
      return BigInt(t);
    } catch {
      return 0n;
    }
  });
  const totalStaked = totals.reduce((sum, value) => sum + value, 0n);
  const seed = (() => {
    try {
      return BigInt(clash.seedAmount);
    } catch {
      return 0n;
    }
  })();
  const exampleStake = BigInt(ARENA_MIN_STAKE_TICK) * 10n ** 18n;
  const examplePayout = (index: number): bigint | null => {
    const multiplier = clash.multipliers?.[index] ?? null;
    if (multiplier === null || !Number.isFinite(multiplier)) return null;
    return BigInt(Math.round(Number(exampleStake) * multiplier));
  };

  return <section className="glass mb-6 rounded-3xl p-5 sm:p-6" aria-labelledby="arena-pre-match-briefing-title">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#2E7CF6]">Pre-match briefing</p><h2 id="arena-pre-match-briefing-title" className="mt-1 font-display text-xl font-extrabold">Know the matchup</h2></div>
      <span className="rounded-full bg-[#2E7CF6]/10 px-3 py-1 text-[11px] font-semibold text-[#1D4ED8] dark:text-[#7db3ff]">Historical context · not a prediction</span>
    </div>

    <p className="mb-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
      {arenaClashQuestionFor(clash)} Yes wins only when the {memeName} percent move is strictly greater than the {oppName} percent move over the window. An exact tie is No. Staking closes at window start, {formatUtcDateTime(clash.windowStart * 1000)} UTC.
    </p>

    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
        <div className="flex items-center justify-between"><span className="font-display text-sm font-bold">{memeName}</span><Trophy className="h-4 w-4 text-[#2E7CF6]" /></div>
        <div className="mt-3 flex items-end gap-3"><strong className="font-display text-2xl font-black tabular-nums">{priceLabel(memeRegistry?.priceUsd ?? null)}</strong><span className="pb-1 text-xs text-zinc-500">BaseStonk price now</span></div>
        <p className="mt-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
          {memeRegistry
            ? `Liquidity ${usdLabel(memeRegistry.liquidityUsd)} · ${memeRegistry.holders === null ? "holders n/a" : `${memeRegistry.holders.toLocaleString("en-US")} holders`} · 24h volume ${usdLabel(memeRegistry.volume24hUsd)}`
            : "Registry stats unavailable"}
        </p>
        <p className="mt-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
          {memeRanking
            ? `Meme Cup record: ${memeRanking.wins}W · ${memeRanking.losses}L · rating ${Math.round(memeRanking.points)} · ${memeRanking.titles} title${memeRanking.titles === 1 ? "" : "s"}`
            : "No Meme Cup record yet"}
        </p>
      </div>
      <div className="rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
        <div className="flex items-center justify-between"><span className="font-display text-sm font-bold">{oppName}</span><Trophy className="h-4 w-4 text-[#2E7CF6]" /></div>
        <div className="mt-3 flex items-end gap-3"><strong className="font-display text-2xl font-black tabular-nums">{arenaDisplaySymbol(clash.opponentSymbol)}</strong><span className="pb-1 text-xs text-zinc-500">{clash.opponentKind === "stock" ? "Stock · Coinbase NAV" : "Meme · BaseStonk"}</span></div>
        <p className="mt-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
          {clash.opponentKind === "stock"
            ? "Priced from the Coinbase NAV snapshot at window start and window end."
            : "Priced from BaseStonk priceUsd at window start and window end, like the meme side."}
        </p>
        <p className="mt-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
          {clash.opponentKind === "meme"
            ? oppRanking
              ? `Meme Cup record: ${oppRanking.wins}W · ${oppRanking.losses}L · rating ${Math.round(oppRanking.points)}`
              : "No Meme Cup record yet"
            : "Stocks do not play Meme Cup ties"}
        </p>
      </div>
    </div>

    <div className="mt-5 border-t border-black/[.07] pt-5 dark:border-white/[.07]">
      <h3 className="flex items-center gap-2 font-display text-sm font-bold"><BarChart3 className="h-4 w-4 text-[#2E7CF6]" /> Pool context</h3>
      <p className="mt-1 text-[11px] text-zinc-500">Stake shares show where players put TICK. They are not outcome probabilities. Seeded TICK is included in payout estimates, not in stake shares.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">{["Yes", "No"].map((label, index) => <div key={label} className="min-w-0 rounded-xl bg-black/[.035] p-3 text-center dark:bg-white/[.04]">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
        <p className="mt-1 font-display text-lg font-black tabular-nums">{totalStaked > 0n ? `${Number(totals[index] * 10_000n / totalStaked) / 100}%` : "–"}</p>
        <p className="mt-1 text-[10px] leading-tight text-zinc-500">{examplePayout(index) === null ? `Payout unavailable · ${formatMarketOdds(clash.multipliers?.[index] ?? null)}` : `${formatTick(examplePayout(index))} TICK if ${label} wins · ${formatMarketOdds(clash.multipliers?.[index] ?? null)}`}</p>
      </div>)}</div>
      <p className="mt-2 text-[11px] text-zinc-500">Example payout for a new {ARENA_MIN_STAKE_TICK} TICK stake at the current pool multiplier, with the {formatTick(seed)} TICK seed in the pool. Estimates change as the pool changes.</p>
    </div>
  </section>;
}

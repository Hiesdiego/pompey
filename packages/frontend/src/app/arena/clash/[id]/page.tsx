"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, Trophy, Zap } from "lucide-react";
import {
  arenaClashQuestionFor,
  arenaCommentaryEligible,
  arenaDisplaySymbol,
  baseStonkTokenUrl,
  clashScoreline,
  cupRoundLabel,
  isBlitzWindow,
  type ClashDetail,
} from "../../../../lib/arenaContracts";
import { formatSignedPct, formatTick } from "../../../../lib/format";
import { useTickr } from "../../../../hooks/useTickr";
import { useTickBalance } from "../../../../hooks/useTickBalance";
import { useArenaClash, useArenaRankings, useArenaRegistry } from "../../../../lib/query/useArena";
import { qks } from "../../../../lib/query/keys";
import { queryClient } from "../../../../lib/query/queryClient";
import { MemeLogo } from "../../../../components/MemeLogo";
import { StockLogo } from "../../../../components/StockLogo";
import { ArenaLiveClashPanel } from "../../../../components/ArenaLiveClashPanel";
import { ArenaPostClashPanel } from "../../../../components/ArenaPostClashPanel";
import { ArenaOracleAuditCard } from "../../../../components/ArenaOracleAuditCard";
import { ArenaPreMatchBriefing } from "../../../../components/ArenaPreMatchBriefing";
import { ArenaScoringExplainer } from "../../../../components/ArenaScoringExplainer";
import { Countdown } from "../../../../components/Countdown";
import { SectionTitle, LoadingState, ErrorState, EmptyState } from "../../../../components/States";
import { ShareButtons } from "../../../../components/ShareButtons";

/**
 * Meme clash detail page.
 *
 * Target location in the repo:
 *   packages/frontend/src/app/arena/clash/[id]/page.tsx
 *
 * This page mirrors the stock match detail page
 * (packages/frontend/src/app/stocks/match/[id]/page.tsx) section for
 * section, in the same order, with the same layout classes: back
 * link, SectionTitle plus ShareButtons, hero score and status card,
 * PreMatchBriefing, stake button opening a modal, live panel,
 * post-match panel, oracle audit card, PoolOddsChart, awaiting card,
 * live odds block, scoring explainer, stake modal.
 *
 * Panel reuse, stated exactly:
 *   - Reused directly from the stock page: Countdown, SectionTitle,
 *     LoadingState, ErrorState, EmptyState, ShareButtons, StockLogo
 *     (for a stock opponent). These take clash-agnostic props.
 *   - Mirrored in the Arena namespace, because each stock panel is
 *     typed on StockApiFixture or StockApiPool and bound to the stock
 *     contracts, so none of them can accept clash data:
 *     ArenaPreMatchBriefing (StockPreMatchBriefing),
 *     ArenaStakePanel and ArenaStakeModal (StockStakePanel and
 *     StockStakeModal), ArenaLiveClashPanel (StockLiveMatchPanel),
 *     ArenaPostClashPanel (StockPostMatchPanel), ArenaOracleAuditCard
 *     (StockOracleAuditCard), ArenaScoringExplainer
 *     (StockScoringExplainer). Each mirror keeps the stock panel's
 *     structure and styling and swaps only the data source.
 *   - MemeLogo is the meme analogue of StockLogo, in the same slot.
 *   - PoolOddsChart is a local component on the stock page, not a
 *     shared export, so ArenaPoolOddsChart below mirrors it locally
 *     with two outcomes instead of three.
 *
 * Locked Arena differences, the only content differences from the
 * stock page:
 *   - The question is "Will [MEME] outperform [OPPONENT] over the
 *     window?" with Yes and No outcomes. Yes wins only on a strictly
 *     greater percent move, an exact tie is No.
 *   - Staking opens at creation and closes at window start. There is
 *     no in-play staking, so the stake button and the live betting
 *     banner never render while the window is running.
 *   - The chart slot is a link card to the meme BaseStonk page
 *     instead of a TradingView chart.
 *   - The audit card names the snapshot sources and explains the plus
 *     or minus 30 percent void breaker.
 *   - A commentary section renders only when the clash is featured or
 *     is a Meme Cup semi-final or final (arenaCommentaryEligible).
 *   - The audit card also renders on a voided clash, where the stock
 *     page renders none, because the breaker explanation is the audit
 *     content a voided clash exists to show.
 *
 * Status is derived from the window times, mirroring how the stock
 * page derives its status from kickoff and match end: before window
 * start is upcoming, inside the window is in play, past window end
 * with no settlement yet is awaiting, and the backend status settles
 * the final settled or voided state.
 *
 * All timestamps are UTC.
 */

type OddsPoint = { pcts: [number, number]; raw: [string, string] };
type ArenaClashStatus = "upcoming" | "inplay" | "awaiting" | "settled" | "voided";

const ArenaStakeModal = dynamic(
  () => import("../../../../components/ArenaStakePanel").then((module) => module.ArenaStakeModal),
  { ssr: false, loading: () => null }
);

function arenaClashStatus(clash: ClashDetail, now: number): ArenaClashStatus {
  if (clash.status === "settled") return "settled";
  if (clash.status === "voided") return "voided";
  if (now < clash.windowStart * 1000) return "upcoming";
  if (now <= clash.windowEnd * 1000) return "inplay";
  return "awaiting";
}

function ArenaPoolOddsChart({ clash, history }: { clash: ClashDetail; history: OddsPoint[] }) {
  const raw = clash.outcomeTotals.length >= 2
    ? [clash.outcomeTotals[0], clash.outcomeTotals[1]] as [string, string]
    : ["0", "0"] as [string, string];
  const sum = raw.reduce((total, value) => total + BigInt(value || "0"), 0n);
  const current = raw.map((value) => sum > 0n ? Number(BigInt(value || "0") * 10_000n / sum) / 100 : 0) as [number, number];
  const points = history.length ? history : [{ pcts: current, raw }];
  const colors = ["#2E7CF6", "#1D9E75"];
  const labels = ["Yes", "No"];
  const line = (index: number) => {
    const samples = points.length === 1 ? [points[0], points[0]] : points;
    return samples.map((point, i) => `${i ? "L" : "M"}${(i / Math.max(1, samples.length - 1)) * 600},${150 - point.pcts[index] * 1.3}`).join(" ");
  };
  const totalPool = sum + BigInt(clash.seedAmount || "0");
  return <div className="glass rounded-3xl p-5 sm:p-6">
    <div className="mb-4 flex items-start justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#2E7CF6]">Live market</p><h3 className="mt-1 font-display text-lg font-extrabold">Clash odds</h3></div><div className="text-right"><p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Total pool</p><p className="font-display text-sm font-bold tabular-nums">{formatTick(totalPool)} TICK</p></div></div>
    <div className="rounded-2xl border border-black/[.06] bg-black/[.02] px-2 py-3 dark:border-white/[.07] dark:bg-white/[.02]"><svg viewBox="0 0 600 160" preserveAspectRatio="none" className="h-40 w-full" aria-label="Yes and No odds movement"><defs>{colors.map((color, i) => <linearGradient key={i} id={`arenaOddsGlow${i}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".2" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>)}</defs>{[20, 60, 100, 140].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="currentColor" className="text-zinc-300/50 dark:text-zinc-700/60" strokeDasharray="3 8" />)}{[0, 1].map((i) => <g key={i}><path d={`${line(i)} L600 160 L0 160 Z`} fill={`url(#arenaOddsGlow${i})`} /><path d={line(i)} fill="none" stroke={colors[i]} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></g>)}</svg></div>
    <div className="mt-4 grid grid-cols-2 gap-2">{labels.map((label, i) => <div key={label} className="rounded-xl border border-black/[.06] bg-white/60 p-3 dark:border-white/[.07] dark:bg-white/[.025]"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[i] }} />{label}</div><p className="mt-1 font-display text-lg font-extrabold tabular-nums">{current[i].toFixed(0)}%</p></div>)}</div>
    <p className="mt-3 text-[10px] text-zinc-400">Live odds based on the current share of stakes.</p>
  </div>;
}

export default function ArenaClashPage() {
  const params = useParams();
  const id = params.id as string;
  const { authenticated, login, playerAddress } = useTickr();
  const { balance, refresh: refreshBalance } = useTickBalance(playerAddress);
  const clashQuery = useArenaClash(id, playerAddress ?? null);
  const registryQuery = useArenaRegistry();
  const rankingsQuery = useArenaRankings();

  const [now, setNow] = useState(() => Date.now());
  const [poolHistory, setPoolHistory] = useState<OddsPoint[]>([]);
  const [stakeOpen, setStakeOpen] = useState(false);
  const [stakeOpening, setStakeOpening] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const clash = clashQuery.data?.clash ?? null;
  const userPosition = clashQuery.data?.userPosition ?? null;

  useEffect(() => {
    if (!clash) return;
    const raw = clash.outcomeTotals.length >= 2
      ? [clash.outcomeTotals[0], clash.outcomeTotals[1]] as [string, string]
      : ["0", "0"] as [string, string];
    const total = raw.reduce((sum, value) => sum + BigInt(value || "0"), 0n);
    const pcts = raw.map((value) => total > 0n ? Number(BigInt(value || "0") * 10_000n / total) / 100 : 0) as [number, number];
    setPoolHistory((previous) => {
      if (previous.at(-1)?.raw.every((value, i) => value === raw[i])) return previous;
      return [...previous.slice(-59), { pcts, raw }];
    });
  }, [clash]);

  const handleStaked = useCallback(() => {
    void clashQuery.refetch();
    void refreshBalance();
    void queryClient.invalidateQueries({ queryKey: qks.arenaClashes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshBalance]);
  const handleStakeModalReady = useCallback(() => setStakeOpening(false), []);

  if (clashQuery.isPending) return <LoadingState label="Loading clash…" />;
  if (clashQuery.isError) {
    return (
      <div className="py-10">
        <ErrorState message={clashQuery.error instanceof Error ? clashQuery.error.message : "Could not load this clash."} onRetry={() => void clashQuery.refetch()} />
      </div>
    );
  }
  if (!clash) {
    return (
      <EmptyState title="Clash not found.">
        <Link href="/fixtures?league=memes" className="font-semibold text-[#1D4ED8] hover:underline dark:text-[#7db3ff]">
          Back to meme fixtures
        </Link>
      </EmptyState>
    );
  }

  const status: ArenaClashStatus = arenaClashStatus(clash, now);
  const question = arenaClashQuestionFor(clash);
  const blitz = isBlitzWindow(clash.windowDuration);
  const memeName = clash.memeName ?? arenaDisplaySymbol(clash.memeSymbol);
  const oppName = clash.opponentName ?? arenaDisplaySymbol(clash.opponentSymbol);
  const windowStartMs = clash.windowStart * 1000;
  const windowEndMs = clash.windowEnd * 1000;

  const liveScore: [number, number] | null =
    clash.liveMemeMovePct !== null && clash.liveOppMovePct !== null
      ? (() => { const s = clashScoreline(clash.liveMemeMovePct, clash.liveOppMovePct); return [s.memeGoals, s.oppGoals]; })()
      : clash.liveMemeGoals !== null && clash.liveOppGoals !== null
        ? [clash.liveMemeGoals, clash.liveOppGoals]
        : null;
  const finalScore: [number, number] | null =
    clash.memeMovePct !== null && clash.oppMovePct !== null
      ? (() => { const s = clashScoreline(clash.memeMovePct, clash.oppMovePct); return [s.memeGoals, s.oppGoals]; })()
      : null;
  const score: [number, number] | null =
    status === "inplay" ? liveScore : status === "settled" ? finalScore : null;
  const auditScoreline = status === "settled" && finalScore
    ? { memeGoals: finalScore[0], oppGoals: finalScore[1] }
    : null;
  const heroMoveMeme = status === "inplay" ? clash.liveMemeMovePct : status === "settled" ? clash.memeMovePct : null;
  const heroMoveOpp = status === "inplay" ? clash.liveOppMovePct : status === "settled" ? clash.oppMovePct : null;
  const commentaryEligible = arenaCommentaryEligible(clash);
  const sectionTitle = clash.cup
    ? `Arena · Meme Cup ${cupRoundLabel(clash.cup.round)}`
    : clash.featured
      ? "Arena · Featured clash"
      : blitz
        ? "Arena · Blitz clash"
        : "Arena · Meme clash";
  const memeRegistry = registryQuery.data?.memes.find((m) => m.address.toLowerCase() === clash.memeToken.toLowerCase()) ?? null;
  const memeRanking = rankingsQuery.data?.rankings.find((r) => r.address.toLowerCase() === clash.memeToken.toLowerCase()) ?? null;
  const oppRanking = clash.opponentKind === "meme"
    ? rankingsQuery.data?.rankings.find((r) => r.address.toLowerCase() === clash.opponentToken.toLowerCase()) ?? null
    : null;

  return (
    <div>
      <Link
        href="/fixtures?league=memes"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-[#1D4ED8] dark:text-zinc-400 dark:hover:text-[#7db3ff]"
      >
        <ArrowLeft className="h-4 w-4" /> Meme fixtures
      </Link>

      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionTitle title={sectionTitle} />
        <ShareButtons path={`/arena/clash/${clash.id}`} text={`${memeName} vs ${oppName} - will the meme outperform on TICKR`} compact />
      </div>

      <div className="relative mb-6 overflow-hidden rounded-[2rem] border border-black/[.08] bg-white p-5 text-zinc-900 shadow-[0_28px_80px_rgba(8,17,29,.12)] dark:border-white/10 dark:bg-[#09111d] dark:text-white dark:shadow-[0_28px_80px_rgba(8,17,29,.28)] sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(46,124,246,.12),transparent_58%)] dark:bg-[radial-gradient(ellipse_at_50%_0%,rgba(46,124,246,.25),transparent_58%)]" />
        <div className="relative mb-7 flex items-center justify-between">
          <div><p className="text-[10px] font-extrabold uppercase tracking-[.24em] text-zinc-500 dark:text-white/45">Meme Arena · {clash.cup ? `Meme Cup ${cupRoundLabel(clash.cup.round)}` : blitz ? "Blitz clash" : "Outperform clash"}</p><div className="mt-2 flex items-center gap-2">{status === "inplay" ? <span className="inline-flex items-center gap-2 rounded-full bg-red-500/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-red-600 dark:text-red-300"><i className="h-2 w-2 animate-pulse rounded-full bg-red-500 dark:bg-red-400" /> In play</span> : status === "settled" ? <span className="rounded-full bg-zinc-500/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-zinc-600 dark:bg-white/10 dark:text-white/75">Full time</span> : status === "voided" ? <span className="rounded-full bg-zinc-500/20 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-300">Voided</span> : status === "awaiting" ? <span className="rounded-full bg-amber-400/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-200">Finalizing</span> : <span className="rounded-full bg-[#2E7CF6]/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-blue-700 dark:bg-[#2E7CF6]/20 dark:text-blue-200">Upcoming</span>}{clash.cupTie && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-200"><Trophy className="h-3 w-3" /> Meme Cup</span>}{blitz && <span className="inline-flex items-center gap-1 rounded-full bg-[#2E7CF6]/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-blue-700 dark:bg-[#2E7CF6]/20 dark:text-blue-200"><Zap className="h-3 w-3" /> Blitz</span>}</div></div>
          <div className="text-right">{status === "upcoming" ? <><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-white/45">Window starts in</p><Countdown target={windowStartMs} className="mt-1 font-display text-xl font-extrabold tabular-nums text-zinc-900 dark:text-white" /></> : status === "inplay" ? <><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-white/45">Time remaining</p><Countdown target={windowEndMs} className="mt-1 font-display text-xl font-extrabold tabular-nums text-zinc-900 dark:text-white" /></> : <p className="font-display text-sm font-bold text-zinc-500 dark:text-white/65">{status === "settled" ? "CLASH COMPLETE" : status === "voided" ? "CLASH VOIDED" : "AWAITING RESULT"}</p>}</div>
        </div>
        {status === "inplay" && <p className="relative mb-4 text-center text-[11px] text-zinc-500 dark:text-white/55"><span className="font-bold text-[#1D4ED8] dark:text-[#7db3ff]">ⓘ PLS</span> means projected live score. It follows live price changes and can change until the final snapshot result.</p>}
        <p className="relative mb-5 text-center font-display text-base font-bold text-zinc-900 dark:text-white sm:text-lg">{question}</p>
        <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-8">
          <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row sm:text-left"><MemeLogo symbol={clash.memeSymbol} logoUrl={clash.memeLogoUrl} size={56} /><div className="min-w-0"><p className="truncate font-display text-sm font-extrabold text-zinc-900 dark:text-white sm:text-lg">{memeName}</p><p className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-500 dark:text-white/45">MEME · {arenaDisplaySymbol(clash.memeSymbol)}</p></div></div>
          <div className="min-w-[112px] rounded-2xl border border-black/[.08] bg-black/[.03] px-4 py-3 text-center shadow-inner dark:border-white/10 dark:bg-white/[.06] sm:min-w-[160px] sm:px-6 sm:py-4"><p className="font-display text-4xl font-black tracking-tight tabular-nums sm:text-6xl">{status === "inplay" || status === "settled" ? score ? `${score[0]}–${score[1]}` : "– : –" : "VS"}</p><p className="mt-1 text-[9px] font-extrabold uppercase tracking-[.22em] text-zinc-500 dark:text-white/40">{status === "settled" ? "Final score" : status === "inplay" ? "PLS" : status === "awaiting" ? "Result pending" : status === "voided" ? "No result" : "Window soon"}</p></div>
          <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row sm:justify-end sm:text-right"><div className="min-w-0"><p className="truncate font-display text-sm font-extrabold text-zinc-900 dark:text-white sm:text-lg">{oppName}</p><p className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-500 dark:text-white/45">{clash.opponentKind === "stock" ? "STOCK" : "MEME"} · {arenaDisplaySymbol(clash.opponentSymbol)}</p></div>{clash.opponentKind === "meme" ? <MemeLogo symbol={clash.opponentSymbol} logoUrl={clash.opponentLogoUrl} size={56} /> : <StockLogo symbol={clash.opponentSymbol} iconUrl={clash.opponentLogoUrl} size={56} />}</div>
        </div>
        <div className="relative mt-6 flex items-center justify-between border-t border-black/[.08] pt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-white/10 dark:text-white/40"><span>Real price performance</span><span>{(status === "inplay" || status === "settled") && heroMoveMeme !== null && heroMoveOpp !== null ? `${formatSignedPct(heroMoveMeme)} · ${formatSignedPct(heroMoveOpp)}` : "TICKR Meme Arena"}</span></div>
      </div>

      {status === "upcoming" && (
        <ArenaPreMatchBriefing clash={clash} memeRegistry={memeRegistry} memeRanking={memeRanking} oppRanking={oppRanking} />
      )}

      {status === "upcoming" && (
        <button
          onClick={() => {
            setStakeOpening(true);
            setStakeOpen(true);
          }}
          disabled={stakeOpening}
          aria-busy={stakeOpening}
          className="mb-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] px-4 py-3.5 font-display text-base font-extrabold text-white shadow-[0_0_28px_rgba(46,124,246,.4)] transition-all hover:shadow-[0_0_40px_rgba(46,124,246,.55)] active:scale-[.98] disabled:cursor-wait disabled:opacity-80"
        >
          {stakeOpening ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Loading stake form…
            </>
          ) : (
            "Stake on this clash"
          )}
        </button>
      )}

      {status === "inplay" && <div className="mb-6"><ArenaLiveClashPanel clash={clash} projectedScore={liveScore} windowEndMs={windowEndMs} /></div>}
      {(status === "settled" || status === "voided") && <div className="mb-6"><ArenaPostClashPanel clash={clash} userPosition={userPosition} playerAddress={playerAddress} onClaimed={handleStaked} /></div>}
      {(status === "settled" || status === "voided") && <ArenaOracleAuditCard clash={clash} scoreline={auditScoreline} />}
      {(status === "settled" || status === "voided") && <div className="mb-6"><ArenaPoolOddsChart clash={clash} history={poolHistory} /></div>}
      {status === "awaiting" && <div className="glass mb-6 rounded-3xl border-amber-500/25! p-5 text-center"><p className="font-display text-lg font-bold">The clash window has ended</p><p className="mt-1 text-sm text-zinc-500">Final snapshot prices are being confirmed on-chain.</p></div>}

      {(status === "inplay" || status === "awaiting") && <div className="mb-6">
        <ArenaPoolOddsChart clash={clash} history={poolHistory} />
      </div>}

      <a href={baseStonkTokenUrl(clash.memeToken)} target="_blank" rel="noreferrer" className="surface-card group mb-6 flex items-center justify-between gap-4 rounded-2xl p-5 transition hover:border-[#2E7CF6]/40">
        <span>
          <span className="block text-sm font-extrabold">View {memeName} on BaseStonk</span>
          <span className="mt-1 block text-sm text-zinc-500">Price, liquidity and holders for the meme, on BaseStonk.</span>
        </span>
        <ExternalLink className="h-5 w-5 shrink-0 text-[#2E7CF6] transition-transform group-hover:translate-x-0.5" />
      </a>

      {commentaryEligible && (
        <div className="glass mb-6 rounded-3xl p-5 sm:p-6">
          <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Commentary</h3>
          {clash.commentary.length > 0 ? (
            <div className="space-y-3">
              {clash.commentary.map((line, index) => (
                <div key={`${line.createdAt}-${index}`} className="rounded-xl bg-black/[.03] p-3 dark:bg-white/[.04]">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#2E7CF6]">{line.voice} · {line.kind}</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-700 dark:text-zinc-200">{line.line}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Commentary lines appear here once the window is under way. This clash is in scope for commentary because {clash.featured ? "it is a featured clash" : "it is a Meme Cup semi-final or final"}.</p>
          )}
        </div>
      )}

      <div className="mb-6">
        <ArenaScoringExplainer compact />
      </div>

      {stakeOpen && (
        <ArenaStakeModal
          clash={clash}
          playerAddress={playerAddress}
          balance={balance}
          authenticated={authenticated}
          onLogin={login}
          onStaked={handleStaked}
          onReady={handleStakeModalReady}
          onClose={() => {
            setStakeOpening(false);
            setStakeOpen(false);
          }}
        />
      )}
    </div>
  );
}

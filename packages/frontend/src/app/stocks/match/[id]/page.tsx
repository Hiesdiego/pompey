"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  STOCK_CONTRACTS,
  STOCK_PRICE_ORACLE_ABI,
  STOCK_MATCH_REGISTRY_ABI,
  STOCK_SEASON_ID,
  stockApi,
  type StockApiFixture,
  type StockApiPool,
} from "../../../../lib/stockContracts";
import { formatTick, isoToMs } from "../../../../lib/format";
import {
  formatSignedPctStock,
  forfeitScoreline,
  isVolatileStock,
  stockRoundWave,
  stockScoreline,
} from "../../../../lib/stockFormat";
import { stockBettingCloseMs, stockMatchEndMs } from "../../../../lib/stockMatchConfig";
import { useTickr } from "../../../../hooks/useTickr";
import { useTickBalance } from "../../../../hooks/useTickBalance";
import { useStockLiveFeed } from "../../../../hooks/useStockLiveFeed";
import { getPublicClient } from "../../../../hooks/usePublicClient";
import { stockFixtureStatus, type StockFixtureStatus } from "../../../../components/StockFixtureCard";
import { StockTeamBadge } from "../../../../components/StockLeagueTable";
import { StockLiveMatchPanel } from "../../../../components/StockLiveMatchPanel";
import { StockPostMatchPanel, type StockFullSnapshot } from "../../../../components/StockPostMatchPanel";
import { StockOracleAuditCard } from "../../../../components/StockOracleAuditCard";
import { StockPreMatchBriefing } from "../../../../components/StockPreMatchBriefing";
import { StockScoringExplainer } from "../../../../components/StockScoringExplainer";
import { Countdown } from "../../../../components/Countdown";
import { SectionTitle, LoadingState, ErrorState, EmptyState } from "../../../../components/States";
import { ShareButtons } from "../../../../components/ShareButtons";

/**
 * Stock match page.
 *
 * Target location in the repo:
 *   packages/frontend/src/app/stocks/match/[id]/page.tsx
 *
 * This page mirrors the crypto match detail page
 * (packages/frontend/src/app/match/[id]/page.tsx) section for
 * section, in the same order, with the same layout classes: back
 * link, SectionTitle plus ShareButtons, score and status header
 * card, PreMatchBriefing, stake button opening a modal, live panel,
 * post-match panel, oracle audit card, PoolOddsChart, awaiting
 * card, in-play banner plus odds, stake modal. The only sanctioned
 * addition is the StockScoringExplainer, rendered once after the
 * odds blocks, because stock scoring (1 goal = 0.05%) differs from
 * crypto and users must be able to read how it works on this page.
 *
 * Stock differences, all locked, all contained in the stock
 * components and helpers this page imports:
 *   - Contracts: STOCK_CONTRACTS, STOCK_PREDICTION_POOL_ABI,
 *     STOCK_PRICE_ORACLE_ABI, STOCK_MATCH_REGISTRY_ABI,
 *     STOCK_SEASON_ID. The crypto StakePanel, PostMatchPanel and
 *     OracleAuditCard are bound to the crypto pool and season, so
 *     this page uses their stock mirrors (StockStakePanel,
 *     StockPostMatchPanel, StockOracleAuditCard, plus
 *     StockPreMatchBriefing and StockLiveMatchPanel). The crypto
 *     files are untouched.
 *   - Scoring: 1 goal = 0.05% (5 bps), integer basis point math,
 *     0.03% is the first scoring move, max 10 goals, no-negative
 *     scorelines, via stockFormat.ts. The live board and the final
 *     board both use stockScoreline, never the crypto 0.5% helper.
 *   - Window: 1 hour from stockMatchConfig.ts. Betting closes 5
 *     minutes before full time, same as crypto.
 *   - Feed: Chainlink NAV via the stock oracle, prices namespaced
 *     by stock teamId through useStockLiveFeed. Stock teamIds 0 to
 *     11 overlap crypto teamIds, so stock prices are never read
 *     from the crypto price map. NAV only publishes on a 0.5% move
 *     or a 24h heartbeat, so the crypto 60-second freshness rule
 *     cannot apply here: a live price that exists is the latest
 *     validated NAV, and pricesFresh means both teams have one.
 *   - Forfeit: a settled forfeit shows 3-0 with a FORFEIT pill.
 *     A void shows VOID and stakes are refunded through the stock
 *     pool claim(), which handles void refunds. The stock pool has
 *     no claimVoid function, so nothing here calls it.
 *   - On-chain fixture read: STOCK_MATCH_REGISTRY_ABI lists the
 *     full 10-field getFixture tuple, including voided and
 *     matchEndTimestamp. This page reads kickoffTimestamp and
 *     matchEndTimestamp by name only, never by tuple index.
 *
 * All timestamps are UTC.
 */

type OddsPoint = { pcts: [number, number, number]; raw: [string, string, string] };

const StockStakeModal = dynamic(
  () => import("../../../../components/StockStakePanel").then((module) => module.StockStakeModal),
  { ssr: false, loading: () => null }
);

function pctOf(start: bigint, end: bigint): number | null {
  if (start <= 0n || end <= 0n) return null;
  const s = Number(start) / 10 ** 8;
  const e = Number(end) / 10 ** 8;
  if (s <= 0) return null;
  return ((e - s) / s) * 100;
}

function PoolOddsChart({ pool, history }: { pool: StockApiPool | null; history: OddsPoint[] }) {
  const raw = pool ? [pool.totalHome, pool.totalDraw, pool.totalAway] as [string, string, string] : ["0", "0", "0"];
  const sum = raw.reduce((total, value) => total + BigInt(value), 0n);
  const current = raw.map((value) => sum > 0n ? Number(BigInt(value) * 10_000n / sum) / 100 : 0) as [number, number, number];
  const points = history.length ? history : [{ pcts: current, raw }];
  const colors = ["#20b887", "#eab308", "#ef5350"];
  const labels = ["Home", "Draw", "Away"];
  const line = (index: number) => {
    const samples = points.length === 1 ? [points[0], points[0]] : points;
    return samples.map((point, i) => `${i ? "L" : "M"}${(i / Math.max(1, samples.length - 1)) * 600},${150 - point.pcts[index] * 1.3}`).join(" ");
  };
  const totalPool = pool ? BigInt(pool.totalPool) + BigInt(pool.seed ?? "0") : 0n;
  return <div className="glass rounded-3xl p-5 sm:p-6">
    <div className="mb-4 flex items-start justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#2E7CF6]">Live market</p><h3 className="mt-1 font-display text-lg font-extrabold">Match odds</h3></div><div className="text-right"><p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Total pool</p><p className="font-display text-sm font-bold tabular-nums">{formatTick(totalPool)} TICK</p></div></div>
    <div className="rounded-2xl border border-black/[.06] bg-black/[.02] px-2 py-3 dark:border-white/[.07] dark:bg-white/[.02]"><svg viewBox="0 0 600 160" preserveAspectRatio="none" className="h-40 w-full" aria-label="Home, draw and away odds movement"><defs>{colors.map((color, i) => <linearGradient key={i} id={`stockOddsGlow${i}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".2" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>)}</defs>{[20, 60, 100, 140].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="currentColor" className="text-zinc-300/50 dark:text-zinc-700/60" strokeDasharray="3 8" />)}{[0, 1, 2].map((i) => <g key={i}><path d={`${line(i)} L600 160 L0 160 Z`} fill={`url(#stockOddsGlow${i})`} /><path d={line(i)} fill="none" stroke={colors[i]} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></g>)}</svg></div>
    <div className="mt-4 grid grid-cols-3 gap-2">{labels.map((label, i) => <div key={label} className="rounded-xl border border-black/[.06] bg-white/60 p-3 dark:border-white/[.07] dark:bg-white/[.025]"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[i] }} />{label}</div><p className="mt-1 font-display text-lg font-extrabold tabular-nums">{current[i].toFixed(0)}%</p></div>)}</div>
    <p className="mt-3 text-[10px] text-zinc-400">Live odds based on the current share of stakes.</p>
  </div>;
}

export default function StockMatchPage() {
  const params = useParams();
  const id = params.id as string;
  const { authenticated, login, playerAddress } = useTickr();
  const { balance, refresh: refreshBalance } = useTickBalance(playerAddress);
  const { prices, fixtureUpdates } = useStockLiveFeed(true);

  const [fixture, setFixture] = useState<StockApiFixture | null>(null);
  const [pool, setPool] = useState<StockApiPool | null>(null);
  const [poolHistory, setPoolHistory] = useState<OddsPoint[]>([]);
  const [snapshot, setSnapshot] = useState<StockFullSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [bettingCloseMs, setBettingCloseMs] = useState<number | null>(null);
  const [matchEndMs, setMatchEndMs] = useState<number | null>(null);
  const [bettingOpen, setBettingOpen] = useState(false);
  const [stakeOpen, setStakeOpen] = useState(false);
  const [stakeOpening, setStakeOpening] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const loadFixture = useCallback(async () => {
    const f = await stockApi.fixture(id);
    setFixture(f);
    if (!STOCK_CONTRACTS.matchRegistry) return;
    try {
      const pc = getPublicClient();
      const [open, onChainFixture] = await Promise.all([
        pc.readContract({
          address: STOCK_CONTRACTS.matchRegistry as `0x${string}`,
          abi: STOCK_MATCH_REGISTRY_ABI,
          functionName: "isBettingOpen",
          args: [BigInt(id)],
        }),
        pc.readContract({
          address: STOCK_CONTRACTS.matchRegistry as `0x${string}`,
          abi: STOCK_MATCH_REGISTRY_ABI,
          functionName: "getFixture",
          args: [BigInt(id)],
        }),
      ]);
      setBettingOpen(Boolean(open));
      // Named fields only. The 10-field ABI includes voided and
      // matchEndTimestamp, so these names decode correctly. Never read
      // the tuple by index here: the old 8-field ABI made index 7 the
      // settled flag, which the old code misread as a timestamp.
      const raw = onChainFixture as unknown as {
        homeTeamId: number;
        awayTeamId: number;
        matchdayIndex: number;
        windowStart: bigint;
        windowEnd: bigint;
        kickoffTimestamp: bigint;
        kickoffRevealed: boolean;
        settled: boolean;
        voided: boolean;
        matchEndTimestamp: bigint;
      };
      const kickoff = raw.kickoffTimestamp ?? 0n;
      const matchEnd = raw.matchEndTimestamp ?? 0n;
      const end = stockMatchEndMs(
        kickoff > 0n ? Number(kickoff) * 1000 : null,
        matchEnd > 0n ? Number(matchEnd) * 1000 : null
      );
      setMatchEndMs(end);
      setBettingCloseMs(stockBettingCloseMs(end));
    } catch {
      setBettingOpen(false);
      setBettingCloseMs(null);
      setMatchEndMs(null);
    }
  }, [id]);

  const refreshBettingWindow = useCallback(async () => {
    if (!STOCK_CONTRACTS.matchRegistry) return;
    try {
      const open = await getPublicClient().readContract({
        address: STOCK_CONTRACTS.matchRegistry as `0x${string}`,
        abi: STOCK_MATCH_REGISTRY_ABI,
        functionName: "isBettingOpen",
        args: [BigInt(id)],
      });
      setBettingOpen(Boolean(open));
    } catch {

    }
  }, [id]);

  const loadPool = useCallback(async () => {
    try {
      const p = await stockApi.pool(id);
      setPool(p);
      const raw = [p.totalHome, p.totalDraw, p.totalAway] as [string, string, string];
      const total = raw.reduce((sum, value) => sum + BigInt(value), 0n);
      const pcts = raw.map((value) => total > 0n ? Number(BigInt(value) * 10_000n / total) / 100 : 0) as [number, number, number];
      setPoolHistory((previous) => {
        if (previous.at(-1)?.raw.every((value, i) => value === raw[i])) return previous;
        return [...previous.slice(-59), { pcts, raw }];
      });
    } catch {

    }
  }, [id]);

  const loadSnapshot = useCallback(async () => {
    if (!STOCK_CONTRACTS.priceOracle) return;
    try {
      const s = (await getPublicClient().readContract({
        address: STOCK_CONTRACTS.priceOracle,
        abi: STOCK_PRICE_ORACLE_ABI,
        functionName: "getSnapshot",
        args: [STOCK_SEASON_ID, BigInt(id)],
      })) as unknown as {
        homeStart: bigint; awayStart: bigint;
        homeEnd: bigint; awayEnd: bigint;
        startSubmitted: boolean; endSubmitted: boolean;
      };
      if (s.startSubmitted) {
        setSnapshot({
          homeStart: s.homeStart,
          awayStart: s.awayStart,
          homeEnd: s.homeEnd,
          awayEnd: s.awayEnd,
          endSubmitted: s.endSubmitted,
        });
      }
    } catch {

    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadFixture()
      .then(() => {
        if (alive) loadPool();
        if (alive) loadSnapshot();
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [loadFixture, loadPool, loadSnapshot]);

  useEffect(() => {
    if (!fixture || fixture.settled || fixture.voided) return;
    const timer = setInterval(() => {
      void loadFixture().catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    }, 10_000);
    return () => clearInterval(timer);
  }, [fixture, loadFixture]);

  useEffect(() => {
    if (fixtureUpdates[id]) {
      void loadFixture().catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureUpdates[id]]);

  useEffect(() => {
    if (!fixture) return;
    const status = stockFixtureStatus(fixture, fixtureUpdates[id]);
    if (status !== "live" && !fixture.settled) return;
    void loadSnapshot();
    if (fixture.settled) return;
    const timer = window.setInterval(() => void loadSnapshot(), 10_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture, fixtureUpdates[id], loadSnapshot]);

  useEffect(() => {
    if (!fixture) return;
    if (fixture.settled || fixture.voided) return;
    const t = setInterval(loadPool, 8_000);
    return () => clearInterval(t);
  }, [fixture, loadPool]);

  useEffect(() => {
    if (!fixture || stockFixtureStatus(fixture, fixtureUpdates[id]) !== "live") return;
    void refreshBettingWindow();
    const t = setInterval(() => void refreshBettingWindow(), 1_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture, id, refreshBettingWindow]);

  const handleStaked = useCallback(() => {
    loadPool();
    refreshBalance();
  }, [loadPool, refreshBalance]);
  const handleStakeModalReady = useCallback(() => setStakeOpening(false), []);

  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (!fixture) return <LoadingState label="Loading match…" />;
  if (!fixture.home || !fixture.away) {
    return (
      <EmptyState title="Match not found.">
        <Link href="/fixtures?league=stocks" className="font-semibold text-[#1D4ED8] hover:underline dark:text-[#7db3ff]">
          Back to stock fixtures
        </Link>
      </EmptyState>
    );
  }

  const liveUpdate = fixtureUpdates[id];
  const rawKickoffMs = liveUpdate?.kickoffMs ?? isoToMs(fixture.kickoff);
  const kickoffMs = rawKickoffMs && rawKickoffMs > 0 ? rawKickoffMs : null;
  const effectiveMatchEndMs = matchEndMs ?? (kickoffMs !== null ? stockMatchEndMs(kickoffMs) : null);
  const baseStatus: StockFixtureStatus = stockFixtureStatus(fixture, liveUpdate);
  const status: StockFixtureStatus =
    baseStatus === "settled" || baseStatus === "forfeit" || baseStatus === "voided"
      ? baseStatus
      : kickoffMs !== null && now >= kickoffMs
        ? effectiveMatchEndMs !== null && now <= effectiveMatchEndMs
          ? "live"
          : "awaiting"
        : baseStatus;
  const windowEndMs = effectiveMatchEndMs;
  const effectiveBettingCloseMs = bettingCloseMs ?? stockBettingCloseMs(effectiveMatchEndMs);
  const wave = stockRoundWave(fixture.matchdayIndex);

  // Live NAV in USD, keyed by stock teamId. StockApiPrice.price is a
  // string or null, Number() converts it. A null price means no live
  // NAV yet. NAV publishes on a 0.5% move or a 24h heartbeat, so the
  // crypto 60-second freshness rule cannot apply: a price that exists
  // is the latest validated NAV.
  const homeLiveNav = prices[fixture.home.teamId]?.price ? Number(prices[fixture.home.teamId].price) : null;
  const awayLiveNav = prices[fixture.away.teamId]?.price ? Number(prices[fixture.away.teamId].price) : null;
  const pricesFresh = homeLiveNav !== null && awayLiveNav !== null;
  const livePrices: Record<number, number | null> = {
    [fixture.home.teamId]: homeLiveNav,
    [fixture.away.teamId]: awayLiveNav,
  };
  const homeMove = status === "settled" || status === "forfeit"
    ? snapshot?.endSubmitted ? pctOf(snapshot.homeStart, snapshot.homeEnd) : null
    : status === "live" && pricesFresh && snapshot
      ? pctOf(snapshot.homeStart, BigInt(Math.round(homeLiveNav! * 10 ** 8)))
      : null;
  const awayMove = status === "settled" || status === "forfeit"
    ? snapshot?.endSubmitted ? pctOf(snapshot.awayStart, snapshot.awayEnd) : null
    : status === "live" && pricesFresh && snapshot
      ? pctOf(snapshot.awayStart, BigInt(Math.round(awayLiveNav! * 10 ** 8)))
      : null;
  const volatile = (homeMove !== null && isVolatileStock(homeMove)) || (awayMove !== null && isVolatileStock(awayMove));

  const liveScore = homeMove !== null && awayMove !== null
    ? stockScoreline(homeMove, awayMove)
    : null;
  const finalScore: [number, number] | null = (() => {
    if (fixture.voided) return null;
    if (fixture.forfeit) {
      return forfeitScoreline(
        fixture.forfeitingTeamId === fixture.home.teamId ? "home" : "away"
      );
    }
    if (fixture.homeGoals !== null && fixture.homeGoals !== undefined &&
        fixture.awayGoals !== null && fixture.awayGoals !== undefined) {
      return [fixture.homeGoals, fixture.awayGoals];
    }
    if (!snapshot || !snapshot.endSubmitted) return null;
    const hp = pctOf(snapshot.homeStart, snapshot.homeEnd);
    const ap = pctOf(snapshot.awayStart, snapshot.awayEnd);
    if (hp === null || ap === null) return null;
    const s = stockScoreline(hp, ap);
    return [s.homeGoals, s.awayGoals];
  })();
  const score = status === "live"
    ? liveScore ? [liveScore.homeGoals, liveScore.awayGoals] as [number, number] : null
    : status === "settled" || status === "forfeit"
      ? finalScore
      : null;
  const auditScoreline = (status === "settled" || status === "forfeit") && finalScore
    ? { homeGoals: finalScore[0], awayGoals: finalScore[1] }
    : null;

  return (
    <div>
      <Link
        href="/fixtures?league=stocks"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-[#1D4ED8] dark:text-zinc-400 dark:hover:text-[#7db3ff]"
      >
        <ArrowLeft className="h-4 w-4" /> Stock fixtures
      </Link>

      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionTitle title={`Stocks · Round ${fixture.matchdayIndex + 1}${wave ? `, ${wave} wave` : ""}`} />
        {fixture.home && fixture.away && (
          <ShareButtons path={`/stocks/match/${fixture.fixtureId}`} text={`${fixture.home.name} vs ${fixture.away.name} - predict the winner on TICKR`} compact />
        )}
      </div>

      <div className="relative mb-6 overflow-hidden rounded-[2rem] border border-black/[.08] bg-white p-5 text-zinc-900 shadow-[0_28px_80px_rgba(8,17,29,.12)] dark:border-white/10 dark:bg-[#09111d] dark:text-white dark:shadow-[0_28px_80px_rgba(8,17,29,.28)] sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(46,124,246,.12),transparent_58%)] dark:bg-[radial-gradient(ellipse_at_50%_0%,rgba(46,124,246,.25),transparent_58%)]" />
        <div className="relative mb-7 flex items-center justify-between">
          <div><p className="text-[10px] font-extrabold uppercase tracking-[.24em] text-zinc-500 dark:text-white/45">Stock League · Season 1 · Round {fixture.matchdayIndex + 1}</p><div className="mt-2 flex items-center gap-2">{status === "live" ? <span className="inline-flex items-center gap-2 rounded-full bg-red-500/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-red-600 dark:text-red-300"><i className="h-2 w-2 animate-pulse rounded-full bg-red-500 dark:bg-red-400" /> In play</span> : status === "settled" || status === "forfeit" ? <><span className="rounded-full bg-zinc-500/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-zinc-600 dark:bg-white/10 dark:text-white/75">Full time</span>{status === "forfeit" && <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-200">Forfeit</span>}</> : status === "voided" ? <span className="rounded-full bg-zinc-500/20 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-300">Voided</span> : status === "awaiting" ? <span className="rounded-full bg-amber-400/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-200">Finalizing</span> : <span className="rounded-full bg-[#2E7CF6]/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-blue-700 dark:bg-[#2E7CF6]/20 dark:text-blue-200">Upcoming</span>}</div></div>
          <div className="text-right">{status === "upcoming" || status === "tba" ? <><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-white/45">Kickoff in</p>{kickoffMs !== null ? <Countdown target={kickoffMs} className="mt-1 font-display text-xl font-extrabold tabular-nums text-zinc-900 dark:text-white" /> : <p className="mt-1 font-display text-xl font-extrabold">TBA</p>}</> : status === "live" ? <><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-white/45">Time remaining</p>{effectiveMatchEndMs !== null ? <Countdown target={effectiveMatchEndMs} className="mt-1 font-display text-xl font-extrabold tabular-nums text-zinc-900 dark:text-white" /> : <span>–</span>}</> : <p className="font-display text-sm font-bold text-zinc-500 dark:text-white/65">{status === "settled" || status === "forfeit" ? "MATCH COMPLETE" : status === "voided" ? "MATCH VOIDED" : "AWAITING RESULT"}</p>}</div>
        </div>
        {status === "live" && <p className="relative mb-4 text-center text-[11px] text-zinc-500 dark:text-white/55"><span className="font-bold text-[#1D4ED8] dark:text-[#7db3ff]">ⓘ PLS</span> means projected live score. It follows live NAV changes and can change until the final oracle result.</p>}
        <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-8">
          <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row sm:text-left"><StockTeamBadge teamId={fixture.home.teamId} size={56} showName={false} /><div className="min-w-0"><p className="truncate font-display text-sm font-extrabold text-zinc-900 dark:text-white sm:text-lg">{fixture.home.name}</p><p className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-500 dark:text-white/45">HOME · {fixture.home.symbol}</p></div></div>
          <div className="min-w-[112px] rounded-2xl border border-black/[.08] bg-black/[.03] px-4 py-3 text-center shadow-inner dark:border-white/10 dark:bg-white/[.06] sm:min-w-[160px] sm:px-6 sm:py-4"><p className="font-display text-4xl font-black tracking-tight tabular-nums sm:text-6xl">{status === "live" || status === "settled" || status === "forfeit" ? score ? `${score[0]}–${score[1]}` : "– : –" : "VS"}</p><p className="mt-1 text-[9px] font-extrabold uppercase tracking-[.22em] text-zinc-500 dark:text-white/40">{status === "settled" || status === "forfeit" ? "Final score" : status === "live" ? "PLS" : status === "awaiting" ? "Result pending" : status === "voided" ? "No result" : "Kickoff soon"}</p></div>
          <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row sm:justify-end sm:text-right"><div className="min-w-0"><p className="truncate font-display text-sm font-extrabold text-zinc-900 dark:text-white sm:text-lg">{fixture.away.name}</p><p className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-500 dark:text-white/45">AWAY · {fixture.away.symbol}</p></div><StockTeamBadge teamId={fixture.away.teamId} size={56} showName={false} /></div>
        </div>
        <div className="relative mt-6 flex items-center justify-between border-t border-black/[.08] pt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-white/10 dark:text-white/40"><span>Real price performance</span><span>{status === "live" && homeMove !== null && awayMove !== null ? `${formatSignedPctStock(homeMove)} · ${formatSignedPctStock(awayMove)}` : "TICKR Stock League"}</span></div>
      </div>

      {(status === "upcoming" || status === "scheduled" || status === "tba") && (
        <StockPreMatchBriefing fixture={fixture} pool={pool} />
      )}

      {(status === "upcoming" ||
        status === "scheduled" ||
        status === "tba" ||
        (status === "live" &&
          bettingOpen &&
          effectiveBettingCloseMs !== null &&
          effectiveBettingCloseMs > now)) && (
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
            "Stake on this match"
          )}
        </button>
      )}

      {status === "live" && <div className="mb-6"><StockLiveMatchPanel fixture={fixture} snapshot={snapshot ? { homeStart: snapshot.homeStart, awayStart: snapshot.awayStart } : null} livePrices={livePrices} pricesFresh={pricesFresh} projectedScore={score} windowEndMs={windowEndMs} volatile={volatile} /></div>}
      {(status === "settled" || status === "forfeit" || status === "voided") && <div className="mb-6"><StockPostMatchPanel fixture={fixture} pool={pool} snapshot={snapshot} playerAddress={playerAddress} onClaimed={handleStaked} /></div>}
      {(status === "settled" || status === "forfeit") && <StockOracleAuditCard fixture={fixture} snapshot={snapshot} scoreline={auditScoreline} />}
      {(status === "settled" || status === "forfeit") && <div className="mb-6"><PoolOddsChart pool={pool} history={poolHistory} /></div>}
      {status === "awaiting" && <div className="glass mb-6 rounded-3xl border-amber-500/25! p-5 text-center"><p className="font-display text-lg font-bold">The match window has ended</p><p className="mt-1 text-sm text-zinc-500">Final oracle prices are being confirmed on-chain.</p></div>}

      {(status === "live" || status === "awaiting") && <div className="mb-6">
        {status === "live" && bettingOpen && effectiveBettingCloseMs !== null && effectiveBettingCloseMs > now ? <div className="mb-3 flex items-center justify-between rounded-2xl border border-red-500/20 bg-red-500/[.06] px-4 py-3"><p className="text-xs font-extrabold uppercase tracking-wider text-red-600 dark:text-red-400">In-play betting open</p><p className="text-right text-[10px] text-zinc-500">Closes in <Countdown target={effectiveBettingCloseMs} /></p></div> : status === "live" && bettingOpen ? <p className="mb-3 text-center text-xs text-amber-600">In-play betting closes five minutes before full time.</p> : null}
        <PoolOddsChart pool={pool} history={poolHistory} />
      </div>}

      <div className="mb-6">
        <StockScoringExplainer compact />
      </div>

      {stakeOpen && (
        <StockStakeModal
          fixture={fixture}
          pool={pool}
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

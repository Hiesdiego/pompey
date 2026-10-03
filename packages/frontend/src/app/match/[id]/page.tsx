/**
 * Match page (spec P3.6–P3.8): pre-match staking, live % bars, post-match
 * result + claim. State derives from the fixture (backend) merged with
 * live WebSocket updates, plus the PriceOracle kickoff snapshot on-chain.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  CONTRACTS,
  PRICE_ORACLE_ABI,
  PRICE_DECIMALS,
  SEASON_ID,
  SEASON_DISPLAY_NAME,
} from "../../../lib/contracts";
import { MATCH_REGISTRY_V2_ABI } from "../../../lib/marketFactory";
import { api, type ApiFixture, type ApiPool } from "../../../lib/api";
import { formatTick, formatSignedPct, isoToMs, normalizeScoreline, roundPctLikeOracle } from "../../../lib/format";
import { useTickr } from "../../../hooks/useTickr";
import { useTickBalance } from "../../../hooks/useTickBalance";
import { useSettledScoreline } from "../../../hooks/useSettledScoreline";
import { usePriceFeed } from "../../../lib/price/usePriceFeed";
import { getPublicClient } from "../../../hooks/usePublicClient";
import { fixtureStatus, type FixtureStatus } from "../../../components/FixtureCard";
import { StakeModal } from "../../../components/StakePanel";
import { LiveMatchPanel } from "../../../components/LiveMatchPanel";
import { PostMatchPanel, type FullSnapshot } from "../../../components/PostMatchPanel";
import { Countdown } from "../../../components/Countdown";
import { TeamBadge } from "../../../components/TeamBadge";
import { SectionTitle, LoadingState, ErrorState, EmptyState } from "../../../components/States";
import { ShareButtons } from "../../../components/ShareButtons";
import { getMatchDurationMs } from "../../../lib/matchConfig";

type OddsPoint = { pcts: [number, number, number]; raw: [string, string, string] };

function priceMovePct(start: bigint, current: bigint | number | null | undefined) {
  if (current === null || current === undefined || start <= 0n) return null;
  const startPrice = Number(start) / 10 ** PRICE_DECIMALS;
  const currentPrice = typeof current === "bigint" ? Number(current) / 10 ** PRICE_DECIMALS : current;
  return startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : null;
}

function PoolOddsChart({ pool, history }: { pool: ApiPool | null; history: OddsPoint[] }) {
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
    <div className="rounded-2xl border border-black/[.06] bg-black/[.02] px-2 py-3 dark:border-white/[.07] dark:bg-white/[.02]"><svg viewBox="0 0 600 160" preserveAspectRatio="none" className="h-40 w-full" aria-label="Home, draw and away odds movement"><defs>{colors.map((color, i) => <linearGradient key={i} id={`oddsGlow${i}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".2" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>)}</defs>{[20, 60, 100, 140].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="currentColor" className="text-zinc-300/50 dark:text-zinc-700/60" strokeDasharray="3 8" />)}{[0, 1, 2].map((i) => <g key={i}><path d={`${line(i)} L600 160 L0 160 Z`} fill={`url(#oddsGlow${i})`} /><path d={line(i)} fill="none" stroke={colors[i]} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></g>)}</svg></div>
    <div className="mt-4 grid grid-cols-3 gap-2">{labels.map((label, i) => <div key={label} className="rounded-xl border border-black/[.06] bg-white/60 p-3 dark:border-white/[.07] dark:bg-white/[.025]"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[i] }} />{label}</div><p className="mt-1 font-display text-lg font-extrabold tabular-nums">{current[i].toFixed(0)}%</p></div>)}</div>
    <p className="mt-3 text-[10px] text-zinc-400">Live odds based on the current share of stakes.</p>
  </div>;
}

export default function MatchPage() {
  const params = useParams();
  const id = params.id as string;
  const { authenticated, login, playerAddress } = useTickr();
  const { balance, refresh: refreshBalance } = useTickBalance(playerAddress);
  const { prices } = usePriceFeed(true);

  const [fixture, setFixture] = useState<ApiFixture | null>(null);
  const [pool, setPool] = useState<ApiPool | null>(null);
  const [poolHistory, setPoolHistory] = useState<OddsPoint[]>([]);
  const [snapshot, setSnapshot] = useState<FullSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [bettingCloseMs, setBettingCloseMs] = useState<number | null>(null);
  const [matchEndMs, setMatchEndMs] = useState<number | null>(null);
  const [bettingOpen, setBettingOpen] = useState(false);
  const [stakeOpen, setStakeOpen] = useState(false);
  // Must be called before any early return (Rules of Hooks). Uses nullable
  // fixture — falls back to recomputation until the event loads.
  const { scoreline: settledScoreline } = useSettledScoreline(
    fixture?.fixtureId ?? null,
    fixture?.settled ?? false
  );

  // Tick so the status recomputes as kickoff/windows pass.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const loadFixture = useCallback(async () => {
    const f = await api.fixture(id);
    setFixture(f);
    if (!CONTRACTS.matchRegistryS1) return;
    try {
      const pc = getPublicClient();
      const [open, onChainFixture] = await Promise.all([
        pc.readContract({
          address: CONTRACTS.matchRegistryS1 as `0x${string}`,
          abi: MATCH_REGISTRY_V2_ABI,
          functionName: "isBettingOpen",
          args: [BigInt(id)],
        }),
        pc.readContract({
          address: CONTRACTS.matchRegistryS1 as `0x${string}`,
          abi: MATCH_REGISTRY_V2_ABI,
          functionName: "getFixture",
          args: [BigInt(id)],
        }),
      ]);
      setBettingOpen(Boolean(open));
      const raw = onChainFixture as any;
      const kickoff = (raw.kickoffTimestamp ?? raw[5] ?? 0n) as bigint;
      const matchEnd = (raw.matchEndTimestamp ?? raw[7] ?? 0n) as bigint;
      const resolvedMatchEnd = matchEnd > 0n
        ? Number(matchEnd) * 1000
        : kickoff > 0n
          ? Number(kickoff) * 1000 + getMatchDurationMs()
          : null;
      setMatchEndMs(resolvedMatchEnd);
      setBettingCloseMs(resolvedMatchEnd !== null ? resolvedMatchEnd - 5 * 60 * 1000 : null);
    } catch {
      setBettingOpen(false);
      setBettingCloseMs(null);
      setMatchEndMs(null);
    }
  }, [id]);

  const refreshBettingWindow = useCallback(async () => {
    if (!CONTRACTS.matchRegistryS1) return;
    try {
      const open = await getPublicClient().readContract({
        address: CONTRACTS.matchRegistryS1 as `0x${string}`,
        abi: MATCH_REGISTRY_V2_ABI,
        functionName: "isBettingOpen",
        args: [BigInt(id)],
      });
      setBettingOpen(Boolean(open));
    } catch {
      /* Keep the last known state if the RPC read fails. */
    }
  }, [id]);

  const loadPool = useCallback(async () => {
    try {
      const p = await api.pool(id);
      setPool(p);
      const raw = [p.totalHome, p.totalDraw, p.totalAway] as [string, string, string];
      const total = raw.reduce((sum, value) => sum + BigInt(value), 0n);
      const pcts = raw.map((value) => total > 0n ? Number(BigInt(value) * 10_000n / total) / 100 : 0) as [number, number, number];
      setPoolHistory((previous) => {
        if (previous.at(-1)?.raw.every((value, i) => value === raw[i])) return previous;
        return [...previous.slice(-59), { pcts, raw }];
      });
    } catch {
      /* pool may 404 before first stake — non-fatal */
    }
  }, [id]);

  const loadSnapshot = useCallback(async () => {
    if (!CONTRACTS.priceOracle) return;
    try {
      const s = (await getPublicClient().readContract({
        address: CONTRACTS.priceOracle,
        abi: PRICE_ORACLE_ABI,
        functionName: "getSnapshot",
        args: [SEASON_ID, BigInt(id)],
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
      /* oracle read failed — panels degrade gracefully */
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

  // Fixture state is refreshed over the API while a match is active.
  useEffect(() => {
    if (!fixture || fixture.settled) return;
    const timer = setInterval(() => {
      void loadFixture().catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    }, 10_000);
    return () => clearInterval(timer);
  }, [fixture, loadFixture]);

  useEffect(() => {
    if (!fixture) return;
    const status = fixtureStatus(fixture);
    if (status !== "live" && !fixture.settled) return;
    void loadSnapshot();
    if (fixture.settled) return;
    const timer = window.setInterval(() => void loadSnapshot(), 10_000);
    return () => window.clearInterval(timer);
  }, [fixture, loadSnapshot]);

  // Live pool polling while the match is still open for staking / in play.
  useEffect(() => {
    if (!fixture) return;
    const status = fixtureStatus(fixture);
    if (status === "settled" || status === "voided") return;
    const t = setInterval(loadPool, 8_000);
    return () => clearInterval(t);
  }, [fixture, loadPool]);

  useEffect(() => {
    if (!fixture || fixtureStatus(fixture) !== "live") return;
    void refreshBettingWindow();
    const t = setInterval(() => void refreshBettingWindow(), 1_000);
    return () => clearInterval(t);
  }, [fixture, id, refreshBettingWindow]);

  const handleStaked = useCallback(() => {
    loadPool();
    refreshBalance();
  }, [loadPool, refreshBalance]);

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
        <Link href="/fixtures" className="font-semibold text-[#1D4ED8] hover:underline dark:text-[#7db3ff]">
          Back to fixtures
        </Link>
      </EmptyState>
    );
  }

  const rawKickoffMs = isoToMs(fixture.kickoff);
  const kickoffMs = rawKickoffMs && rawKickoffMs > 0 ? rawKickoffMs : null;
  const effectiveMatchEndMs = matchEndMs ?? (kickoffMs !== null ? kickoffMs + getMatchDurationMs() : null);
  const baseStatus: FixtureStatus = fixtureStatus(fixture);
  const status: FixtureStatus =
    baseStatus === "settled"
      ? baseStatus
      : kickoffMs !== null && now >= kickoffMs
        ? effectiveMatchEndMs !== null && now <= effectiveMatchEndMs
          ? "live"
          : "awaiting"
        : baseStatus;
  const windowEndMs = effectiveMatchEndMs;
  const effectiveBettingCloseMs = bettingCloseMs ?? (
    effectiveMatchEndMs !== null ? effectiveMatchEndMs - 5 * 60 * 1000 : null
  );
  const homeMove = status === "settled" && snapshot?.endSubmitted
    ? priceMovePct(snapshot.homeStart, snapshot.homeEnd)
    : status === "live" ? priceMovePct(snapshot?.homeStart ?? 0n, prices[fixture.home.symbol]) : null;
  const awayMove = status === "settled" && snapshot?.endSubmitted
    ? priceMovePct(snapshot.awayStart, snapshot.awayEnd)
    : status === "live" ? priceMovePct(snapshot?.awayStart ?? 0n, prices[fixture.away.symbol]) : null;
  // settledScoreline comes from the hook at the top (single source of truth).
  // Falls back to recomputation if the event hasn't loaded yet.
  const score = settledScoreline
    ? [settledScoreline.homeGoals, settledScoreline.awayGoals] as [number, number]
    : homeMove !== null && awayMove !== null
      ? normalizeScoreline(roundPctLikeOracle(homeMove), roundPctLikeOracle(awayMove))
      : null;

  return (
    <div>
      <Link
        href="/fixtures"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-[#1D4ED8] dark:text-zinc-400 dark:hover:text-[#7db3ff]"
      >
        <ArrowLeft className="h-4 w-4" /> Fixtures
      </Link>

      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionTitle title={`Matchday ${fixture.matchdayIndex + 1}`} />
        {fixture.home && fixture.away && (
          <ShareButtons path={`/match/${fixture.fixtureId}`} text={`${fixture.home.name} vs ${fixture.away.name} — predict the winner on TICKR`} compact />
        )}
      </div>

      <div className="relative mb-6 overflow-hidden rounded-[2rem] border border-black/[.08] bg-white p-5 text-zinc-900 shadow-[0_28px_80px_rgba(8,17,29,.12)] dark:border-white/10 dark:bg-[#09111d] dark:text-white dark:shadow-[0_28px_80px_rgba(8,17,29,.28)] sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(46,124,246,.12),transparent_58%)] dark:bg-[radial-gradient(ellipse_at_50%_0%,rgba(46,124,246,.25),transparent_58%)]" />
        <div className="relative mb-7 flex items-center justify-between">
          <div><p className="text-[10px] font-extrabold uppercase tracking-[.24em] text-zinc-500 dark:text-white/45">{SEASON_DISPLAY_NAME} · Matchday {fixture.matchdayIndex + 1}</p><div className="mt-2 flex items-center gap-2">{status === "live" ? <span className="inline-flex items-center gap-2 rounded-full bg-red-500/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-red-600 dark:text-red-300"><i className="h-2 w-2 animate-pulse rounded-full bg-red-500 dark:bg-red-400" /> In play</span> : status === "settled" ? <span className="rounded-full bg-zinc-500/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-zinc-600 dark:bg-white/10 dark:text-white/75">Full time</span> : status === "voided" ? <span className="rounded-full bg-zinc-500/20 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-300">Voided</span> : status === "awaiting" ? <span className="rounded-full bg-amber-400/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-200">Finalizing</span> : <span className="rounded-full bg-[#2E7CF6]/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-blue-700 dark:bg-[#2E7CF6]/20 dark:text-blue-200">Upcoming</span>}</div></div>
          <div className="text-right">{status === "upcoming" || status === "tba" ? <><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-white/45">Kickoff in</p>{kickoffMs !== null ? <Countdown target={kickoffMs} className="mt-1 font-display text-xl font-extrabold tabular-nums text-zinc-900 dark:text-white" /> : <p className="mt-1 font-display text-xl font-extrabold">TBA</p>}</> : status === "live" ? <><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-white/45">Time remaining</p>{effectiveMatchEndMs !== null ? <Countdown target={effectiveMatchEndMs} className="mt-1 font-display text-xl font-extrabold tabular-nums text-zinc-900 dark:text-white" /> : <span>—</span>}</> : <p className="font-display text-sm font-bold text-zinc-500 dark:text-white/65">{status === "settled" ? "MATCH COMPLETE" : status === "voided" ? "MATCH VOIDED" : "AWAITING RESULT"}</p>}</div>
        </div>
        <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-8">
          <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row sm:text-left"><TeamBadge teamId={fixture.home.teamId} size={56} showName={false} /><div className="min-w-0"><p className="truncate font-display text-sm font-extrabold text-zinc-900 dark:text-white sm:text-lg">{fixture.home.name}</p><p className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-500 dark:text-white/45">HOME · {fixture.home.symbol}</p></div></div>
          <div className="min-w-[112px] rounded-2xl border border-black/[.08] bg-black/[.03] px-4 py-3 text-center shadow-inner dark:border-white/10 dark:bg-white/[.06] sm:min-w-[160px] sm:px-6 sm:py-4"><p className="font-display text-4xl font-black tracking-tight tabular-nums sm:text-6xl">{status === "live" || status === "settled" ? score ? `${score[0]}–${score[1]}` : "– : –" : "VS"}</p><p className="mt-1 text-[9px] font-extrabold uppercase tracking-[.22em] text-zinc-500 dark:text-white/40">{status === "settled" ? "Final score" : status === "live" ? "Live score" : status === "awaiting" ? "Result pending" : status === "voided" ? "No result" : "Kickoff soon"}</p></div>
          <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row sm:justify-end sm:text-right"><div className="min-w-0"><p className="truncate font-display text-sm font-extrabold text-zinc-900 dark:text-white sm:text-lg">{fixture.away.name}</p><p className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-500 dark:text-white/45">AWAY · {fixture.away.symbol}</p></div><TeamBadge teamId={fixture.away.teamId} size={56} showName={false} /></div>
        </div>
        <div className="relative mt-6 flex items-center justify-between border-t border-black/[.08] pt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-white/10 dark:text-white/40"><span>Real price performance</span><span>{status === "live" && homeMove !== null && awayMove !== null ? `${formatSignedPct(homeMove)} · ${formatSignedPct(awayMove)}` : "TICKR League"}</span></div>
      </div>

      {(status === "upcoming" ||
        status === "scheduled" ||
        status === "tba" ||
        (status === "live" &&
          bettingOpen &&
          effectiveBettingCloseMs !== null &&
          effectiveBettingCloseMs > now)) && (
        <button
          onClick={() => setStakeOpen(true)}
          className="mb-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] px-4 py-3.5 font-display text-base font-extrabold text-white shadow-[0_0_28px_rgba(46,124,246,.4)] transition-all hover:shadow-[0_0_40px_rgba(46,124,246,.55)] active:scale-[.98]"
        >
          Stake on this match
        </button>
      )}

      {status === "live" && <div className="mb-6"><LiveMatchPanel fixture={fixture} snapshot={snapshot ? { homeStart: snapshot.homeStart, awayStart: snapshot.awayStart } : null} prices={prices} windowEndMs={windowEndMs} /></div>}
      {(status === "settled" || status === "voided") && <div className="mb-6"><PostMatchPanel fixture={fixture} pool={pool} snapshot={snapshot} playerAddress={playerAddress} onClaimed={handleStaked} /></div>}
      {status === "settled" && <div className="mb-6"><PoolOddsChart pool={pool} history={poolHistory} /></div>}
      {status === "awaiting" && <div className="glass mb-6 rounded-3xl border-amber-500/25! p-5 text-center"><p className="font-display text-lg font-bold">The match window has ended</p><p className="mt-1 text-sm text-zinc-500">Final oracle prices are being confirmed on-chain.</p></div>}

      {status !== "settled" && status !== "voided" && <div className="mb-6">
        {status === "live" && bettingOpen && effectiveBettingCloseMs !== null && effectiveBettingCloseMs > now ? <div className="mb-3 flex items-center justify-between rounded-2xl border border-red-500/20 bg-red-500/[.06] px-4 py-3"><p className="text-xs font-extrabold uppercase tracking-wider text-red-600 dark:text-red-400">In-play betting open</p><p className="text-right text-[10px] text-zinc-500">Closes in <Countdown target={effectiveBettingCloseMs} /></p></div> : status === "live" && bettingOpen ? <p className="mb-3 text-center text-xs text-amber-600">In-play betting closes five minutes before full time.</p> : null}
        <PoolOddsChart pool={pool} history={poolHistory} />
      </div>}
      {stakeOpen && (
        <StakeModal
          fixture={fixture}
          pool={pool}
          playerAddress={playerAddress}
          balance={balance}
          authenticated={authenticated}
          onLogin={login}
          onStaked={handleStaked}
          onClose={() => setStakeOpen(false)}
        />
      )}
    </div>
  );
}

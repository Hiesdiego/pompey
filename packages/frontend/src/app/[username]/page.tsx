/**
 * Profile page: /[username] — X-style public profile backed by Supabase.
 *
 * Header: team-tinted gradient banner, TeamBadge avatar overlapping the
 * banner, display name + @username + bio + favourite-team chip, stats strip.
 * Tabs: Predictions | Markets | Analytics (analytics is owner-view-only).
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import type { Address } from "viem";
import {
  ArrowLeft,
  BarChart3,
  Crown,
  Flame,
  Lock,
  Swords,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useTickr } from "../../hooks/useTickr";
import { useTeams } from "../../hooks/useTeams";
import {
  social,
  ApiError,
  type SocialAnalytics,
  type SocialMarket,
  type SocialPrediction,
  type SocialProfile,
  type PredictionStatusFilter,
  type MarketState,
} from "../../lib/social";
import { api, type ApiFixture } from "../../lib/api";
import { marketQuestion, pickLabel, type TeamRef } from "../../lib/marketQuestion";
import { TEMPLATES, TEMPLATE_NAMES } from "../../lib/marketFactory";
import { TeamBadge } from "../../components/TeamBadge";
import {
  LoadingState,
  ErrorState,
  EmptyState,
  SkeletonRows,
} from "../../components/States";
import { truncateAddress } from "../../lib/format";
import { cn } from "../../lib/cn";
import { getPublicClient } from "../../hooks/usePublicClient";
import { CONTRACTS, PREDICTION_POOL_ABI } from "../../lib/contracts";
import { formatTick, OUTCOME_SHORT } from "../../lib/format";

type Tab = "predictions" | "markets" | "analytics";

const TEMPLATE_ICONS: Record<number, LucideIcon> = {
  [TEMPLATES.TOP_GAINER]: Trophy,
  [TEMPLATES.CHAMPION]: Crown,
  [TEMPLATES.H2H]: Swords,
  [TEMPLATES.TARGET]: Target,
  [TEMPLATES.SPREAD]: BarChart3,
};

const TICK_SCALE = 10n ** 18n;

interface MatchPosition {
  fixture: ApiFixture;
  stakes: [bigint, bigint, bigint];
  winningOutcome: number | null;
}

function MatchPredictions({ walletAddress, filter }: { walletAddress: string; filter: PredictionStatusFilter }) {
  const [positions, setPositions] = useState<MatchPosition[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!CONTRACTS.predictionPool) { setPositions([]); return; }
      try {
        const fixtures = await api.fixtures();
        const client = getPublicClient();
        const rows: MatchPosition[] = [];
        for (let offset = 0; offset < fixtures.length; offset += 25) {
          const chunk = fixtures.slice(offset, offset + 25);
          const calls = chunk.flatMap((fixture) => [0, 1, 2].map((outcome) => ({
            address: CONTRACTS.predictionPool as Address,
            abi: PREDICTION_POOL_ABI,
            functionName: "getStake" as const,
            args: [BigInt(fixture.seasonId), BigInt(fixture.fixtureId), walletAddress as Address, outcome] as const,
          })));
          const results = await client.multicall({ contracts: calls });
          for (let i = 0; i < chunk.length; i++) {
            const stakes = [
              (results[i * 3].result ?? 0n) as bigint,
              (results[i * 3 + 1].result ?? 0n) as bigint,
              (results[i * 3 + 2].result ?? 0n) as bigint,
            ] as [bigint, bigint, bigint];
            if (!stakes.some((amount) => amount > 0n)) continue;
            let winningOutcome: number | null = null;
            if (chunk[i].settled && !chunk[i].voided) {
              try { winningOutcome = (await api.pool(chunk[i].fixtureId)).winningOutcome; } catch { /* show settled status without winner */ }
            }
            rows.push({ fixture: chunk[i], stakes, winningOutcome });
          }
        }
        if (alive) setPositions(rows);
      } catch {
        if (alive) setPositions([]);
      }
    };
    load();
    return () => { alive = false; };
  }, [walletAddress]);

  const visiblePositions = positions?.filter(({ fixture }) =>
    filter === "all" || (filter === "open" ? !fixture.settled : fixture.settled || fixture.voided)
  );
  if (!visiblePositions || visiblePositions.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-3 font-display text-lg font-bold">Match predictions</h2>
      <div className="space-y-2.5">
        {visiblePositions.map(({ fixture, stakes, winningOutcome }) => {
          const amount = stakes.reduce((sum, value) => sum + value, 0n);
          const picks = stakes.map((value, i) => value > 0n ? OUTCOME_SHORT[i] : null).filter(Boolean).join(" · ");
          const won = winningOutcome !== null && stakes[winningOutcome] > 0n;
          const state = fixture.voided ? "VOID" : !fixture.settled ? "OPEN" : winningOutcome === null ? "SETTLED" : won ? "WON" : "LOST";
          const sides = [fixture.home?.name ?? "Home", fixture.away?.name ?? "Away"];
          return (
            <Link key={`${fixture.seasonId}:${fixture.fixtureId}`} href={`/match/${fixture.fixtureId}`} className="glass card-interactive flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
              <div>
                <p className="font-semibold text-zinc-900 dark:text-white">{sides[0]} vs {sides[1]}</p>
                <p className="mt-1 text-xs text-zinc-500">Your picks: {picks}</p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="font-display font-bold tabular-nums">{formatTick(amount)} TICK staked</span>
                <span className="rounded-full bg-[#2E7CF6]/10 px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-[#2E7CF6]">{state}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function parseRawTick(s: string): bigint | null {
  try {
    return BigInt(s);
  } catch {
    const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s.trim());
    if (!match) return null;
    const exponent = Number(match[4]) - (match[3]?.length ?? 0);
    if (!Number.isInteger(exponent) || Math.abs(exponent) > 1000) return null;
    const digits = BigInt(`${match[2]}${match[3] ?? ""}`);
    const scale = 10n ** BigInt(Math.abs(exponent));
    const expanded = exponent >= 0 ? digits * scale : (digits + scale / 2n) / scale;
    return match[1] === "-" ? -expanded : expanded;
  }
}

/** Format an 18-decimal token amount stored as a raw integer. */
function fmtTick(s: string | null | undefined, digits = 2): string {
  if (s === null || s === undefined) return "—";
  try {
    const raw = parseRawTick(s);
    if (raw === null) return s;
    const abs = raw < 0n ? -raw : raw;
    if (abs >= 10_000_000n * TICK_SCALE) {
      const units = [
        { size: 1_000_000_000_000n, suffix: "T" },
        { size: 1_000_000_000n, suffix: "B" },
        { size: 1_000_000n, suffix: "M" },
      ].find((unit) => abs >= unit.size * TICK_SCALE)!;
      const divisor = units.size * TICK_SCALE;
      const tenths = (abs * 10n + divisor / 2n) / divisor;
      return `${tenths % 10n === 0n ? tenths / 10n : `${tenths / 10n}.${tenths % 10n}`}${units.suffix}`;
    }
    const precision = 10n ** BigInt(Math.max(0, Math.min(6, digits)));
    const rounded = (abs * precision + TICK_SCALE / 2n) / TICK_SCALE;
    const whole = rounded / precision;
    const fraction = rounded % precision;
    const grouped = Number(whole).toLocaleString("en-US");
    if (digits <= 0) return grouped;
    return `${grouped}.${fraction.toString().padStart(digits, "0")}`;
  } catch {
    return s;
  }
}

/** Signed raw token amount formatted as human-readable TICK. */
function fmtSignedTick(s: string | null | undefined, digits = 2): string {
  if (s === null || s === undefined) return "—";
  try {
    const raw = parseRawTick(s);
    if (raw === null) return s;
    const sign = raw > 0n ? "+" : raw < 0n ? "−" : "";
    return `${sign}${fmtTick((raw < 0n ? -raw : raw).toString(), digits)}`;
  } catch {
    return s;
  }
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

function StatusPill({ status, won }: { status: MarketState; won?: boolean | null }) {
  if (status === "open") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-300">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        OPEN
      </span>
    );
  }
  if (status === "voided") {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-500/10 px-2.5 py-0.5 text-[11px] font-bold text-zinc-500 dark:text-zinc-400">
        VOID
      </span>
    );
  }
  if (won === null || won === undefined) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-300">
        SETTLED
      </span>
    );
  }
  return won ? (
    <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-300">
      WON
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-red-500/10 px-2.5 py-0.5 text-[11px] font-bold text-red-500 dark:text-red-400">
      LOST
    </span>
  );
}

// ── SVG charts (no chart library) ────────────────────────────────────────────

function PnlChart({ points }: { points: { t: string; cumPnlTick: string }[] }) {
  const W = 620;
  const H = 190;
  const PAD = { l: 8, r: 8, t: 12, b: 22 };
  const data = points
    .map((p) => ({ t: new Date(p.t).getTime(), v: Number(p.cumPnlTick) / 1e18 }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  if (data.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Not enough settled predictions yet to draw your PnL curve.
      </p>
    );
  }
  const min = Math.min(0, ...data.map((d) => d.v));
  const max = Math.max(0, ...data.map((d) => d.v));
  const span = max - min || 1;
  const x = (t: number) =>
    PAD.l + ((t - data[0].t) / Math.max(1, data[data.length - 1].t - data[0].t)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b);
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data[data.length - 1].t).toFixed(1)},${y(0).toFixed(1)} L${x(data[0].t).toFixed(1)},${y(0).toFixed(1)} Z`;
  const up = data[data.length - 1].v >= 0;
  const gid = "pnlfill";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="PnL over time">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={up ? "#10b981" : "#ef4444"} stopOpacity="0.35" />
          <stop offset="100%" stopColor={up ? "#10b981" : "#ef4444"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={PAD.l} y1={y(0)} x2={W - PAD.r} y2={y(0)} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="4 4" />
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={up ? "#10b981" : "#ef4444"} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx={x(data[data.length - 1].t)} cy={y(data[data.length - 1].v)} r="4" fill={up ? "#10b981" : "#ef4444"} stroke="white" strokeWidth="1.5" />
      <text x={PAD.l} y={H - 6} className="fill-zinc-500 text-[10px]">{shortDate(points[0].t)}</text>
      <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-zinc-500 text-[10px]">{shortDate(points[points.length - 1].t)}</text>
    </svg>
  );
}

function TemplateBars({
  rows,
}: {
  rows: { templateId: number; wins: number; settled: number }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No settled predictions yet.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {rows
        .slice()
        .sort((a, b) => b.wins / Math.max(1, b.settled) - a.wins / Math.max(1, a.settled))
        .map((r) => {
          const Icon = TEMPLATE_ICONS[r.templateId] ?? BarChart3;
          const rate = r.settled > 0 ? (r.wins / r.settled) * 100 : 0;
          return (
            <div key={r.templateId}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-zinc-700 dark:text-zinc-200">
                  <Icon className="h-3.5 w-3.5 text-[#2E7CF6]" />
                  {TEMPLATE_NAMES[r.templateId] ?? `Template ${r.templateId}`}
                </span>
                <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                  {r.wins}/{r.settled} · {rate.toFixed(0)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/8 dark:bg-white/8">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#2E7CF6] to-[#1D4ED8] transition-all"
                  style={{ width: `${Math.min(100, rate)}%` }}
                />
              </div>
            </div>
          );
        })}
    </div>
  );
}

function CalibrationChart({
  buckets,
}: {
  buckets: { bucketBps: number; predictedBps: number; actualBps: number; n: number }[];
}) {
  const data = buckets.slice().sort((a, b) => a.bucketBps - b.bucketBps);
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Calibration needs settled predictions with recorded odds.
      </p>
    );
  }
  const W = 620;
  const H = 210;
  const PAD = { l: 8, r: 8, t: 12, b: 26 };
  const n = data.length;
  const slot = (W - PAD.l - PAD.r) / n;
  const bw = Math.min(28, slot / 3.2);
  const y = (bps: number) => PAD.t + (1 - Math.min(100, Math.max(0, bps / 100)) / 100) * (H - PAD.t - PAD.b);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" role="img" aria-label="Calibration: predicted vs actual win rate">
        {[25, 50, 75].map((pct) => (
          <line key={pct} x1={PAD.l} y1={y(pct * 100)} x2={W - PAD.r} y2={y(pct * 100)} stroke="currentColor" strokeOpacity="0.12" />
        ))}
        {data.map((b, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          return (
            <g key={b.bucketBps}>
              <rect x={cx - bw - 2} y={y(b.predictedBps)} width={bw} height={Math.max(2, y(0) - y(b.predictedBps))} rx="3" fill="#2E7CF6" opacity="0.85" />
              <rect x={cx + 2} y={y(b.actualBps)} width={bw} height={Math.max(2, y(0) - y(b.actualBps))} rx="3" fill={b.actualBps >= b.predictedBps ? "#10b981" : "#ef4444"} opacity="0.85" />
              <text x={cx} y={H - 8} textAnchor="middle" className="fill-zinc-500 text-[10px]">
                {Math.round(b.bucketBps / 100)}%
              </text>
              <text x={cx} y={Math.min(y(b.predictedBps), y(b.actualBps)) - 5} textAnchor="middle" className="fill-zinc-400 text-[9px]">
                n={b.n}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex items-center justify-center gap-4 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#2E7CF6]" /> Your odds</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Actual win rate</span>
      </div>
      <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
        Green bars above blue = you beat your odds. Below = the market priced you out.
      </p>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const params = useParams();
  const raw = decodeURIComponent(params.username as string);
  const username = raw.startsWith("@") ? raw.slice(1) : raw;

  const { playerAddress } = useTickr();
  const { getAccessToken } = usePrivy();
  const { teams } = useTeams();

  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("predictions");
  const [predFilter, setPredFilter] = useState<PredictionStatusFilter>("all");
  const [predictions, setPredictions] = useState<SocialPrediction[] | null>(null);
  const [predCursor, setPredCursor] = useState<number | null>(null);
  const [predLoading, setPredLoading] = useState(false);
  const [markets, setMarkets] = useState<SocialMarket[] | null>(null);
  const [mktCursor, setMktCursor] = useState<number | null>(null);
  const [mktLoading, setMktLoading] = useState(false);
  const [analytics, setAnalytics] = useState<SocialAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<Map<string, ApiFixture>>(new Map());

  const teamRefs: TeamRef[] = useMemo(
    () => teams.map((t) => ({ teamId: t.teamId, symbol: t.symbol, name: t.name })),
    [teams]
  );

  const isOwner =
    !!playerAddress && !!profile && playerAddress.toLowerCase() === profile.walletAddress.toLowerCase();

  // Profile
  useEffect(() => {
    let alive = true;
    setProfile(null);
    setNotFound(false);
    setError(null);
    social
      .profile(username)
      .then((p) => alive && setProfile(p))
      .catch((e: Error) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [username]);

  // Fixture directory (for spread questions naming home/away)
  useEffect(() => {
    let alive = true;
    api
      .fixtures()
      .then((list) => {
        if (!alive) return;
        setFixtures(new Map(list.map((f) => [f.fixtureId, f])));
      })
      .catch(() => {
        /* spread questions fall back to generic wording */
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadPredictions = useCallback(
    async (cursor?: number | null, append = false) => {
      setPredLoading(true);
      try {
        const page = await social.predictions(username, predFilter, 25, cursor ?? undefined);
        setPredictions((prev) => (append && prev ? [...prev, ...page.items] : page.items));
        setPredCursor(page.nextCursor);
      } catch (e) {
        if (!append) setPredictions([]);
      } finally {
        setPredLoading(false);
      }
    },
    [username, predFilter]
  );

  const loadMarkets = useCallback(
    async (cursor?: number | null, append = false) => {
      setMktLoading(true);
      try {
        const page = await social.createdMarkets(username, "all", 25, cursor ?? undefined);
        setMarkets((prev) => (append && prev ? [...prev, ...page.items] : page.items));
        setMktCursor(page.nextCursor);
      } catch {
        if (!append) setMarkets([]);
      } finally {
        setMktLoading(false);
      }
    },
    [username]
  );

  // Predictions (reset on filter change)
  useEffect(() => {
    if (tab !== "predictions") return;
    setPredictions(null);
    setPredCursor(null);
    loadPredictions(null, false);
  }, [tab, predFilter, loadPredictions]);

  // Markets
  useEffect(() => {
    if (tab !== "markets") return;
    setMarkets(null);
    setMktCursor(null);
    loadMarkets(null, false);
  }, [tab, loadMarkets]);

  // Analytics (owner only)
  useEffect(() => {
    if (tab !== "analytics" || !isOwner || !profile) return;
    let alive = true;
    setAnalytics(null);
    setAnalyticsError(null);
    social
      .analytics(profile.walletAddress, profile.seasonId, getAccessToken)
      .then((a) => alive && setAnalytics(a))
      .catch((e: Error) => alive && setAnalyticsError(e.message));
    return () => {
      alive = false;
    };
  }, [tab, isOwner, profile, getAccessToken]);

  if (notFound) {
    return (
      <div className="animate-page-in py-10">
        <EmptyState title={`No profile found for "@${username}".`}>
          They haven&apos;t claimed their TICKR username yet.
          <div className="mt-3">
            <Link href="/leaderboard" className="font-semibold text-[#1D4ED8] hover:underline dark:text-[#7db3ff]">
              Back to leaderboard
            </Link>
          </div>
        </EmptyState>
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (!profile) return <LoadingState label="Loading profile…" />;

  const winRate = `${(profile.stats.winRateBps / 100).toFixed(1)}%`;
  const pnlNum = Number(profile.stats.pnlTick) / 1e18;
  const pnlUp = Number.isFinite(pnlNum) && pnlNum >= 0;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "predictions", label: "Predictions" },
    { id: "markets", label: "Markets" },
    { id: "analytics", label: "Analytics" },
  ];

  return (
    <div className="animate-page-in">
      <Link
        href="/leaderboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-[#1D4ED8] dark:text-zinc-400 dark:hover:text-[#7db3ff]"
      >
        <ArrowLeft className="h-4 w-4" /> Leaderboard
      </Link>

      {/* ── header card ── */}
      <div className="glass overflow-hidden rounded-3xl">
        <div
          className="relative h-20 bg-gradient-to-r from-sky-100 via-indigo-100 to-blue-100 dark:from-[#101827] dark:via-[#17243a] dark:to-[#1c3150] sm:h-28"
          aria-hidden
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_78%_25%,rgba(46,124,246,.16),transparent_48%)] dark:bg-[radial-gradient(ellipse_at_78%_25%,rgba(46,124,246,.22),transparent_48%)]" />
        </div>
        <div className="px-5 pb-5 sm:px-7">
          <div className="-mt-10 mb-3 sm:-mt-12">
            <TeamBadge teamId={profile.favouriteTeamId} size={76} showName={false} />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold text-zinc-900 dark:text-white">
                @{profile.username}
              </h1>
              <p className="font-mono text-xs text-zinc-500">
                {truncateAddress(profile.walletAddress, 6)}
              </p>
              {profile.bio && (
                <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-300">{profile.bio}</p>
              )}
              <div className="mt-2 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <span className="text-xs uppercase tracking-widest">Favourite team</span>
                <TeamBadge teamId={profile.favouriteTeamId} size={22} />
              </div>
            </div>
            {profile.stats.rank !== null && (
              <div className="rounded-2xl border border-black/8 bg-black/[.03] px-5 py-3 text-center dark:border-white/8 dark:bg-white/[.03]">
                <p className="font-display text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">
                  #{profile.stats.rank}
                </p>
                <p className="text-[11px] uppercase tracking-widest text-zinc-500">rank</p>
              </div>
            )}
          </div>

          {/* stats strip */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Predictions" value={String(profile.stats.predictions)} />
            <Stat label="Win rate" value={winRate} />
            <Stat
              label="PnL"
              value={`${fmtSignedTick(profile.stats.pnlTick)} TICK`}
              accent={pnlUp ? "text-emerald-500 dark:text-emerald-300" : "text-red-500 dark:text-red-400"}
            />
            <Stat label="Settled" value={String(profile.stats.settled)} />
          </div>
        </div>

        {/* tabs */}
        <div className="flex gap-1 border-t border-black/8 px-5 pt-3 dark:border-white/8 sm:px-7">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative rounded-t-xl px-4 py-2.5 text-sm font-semibold transition-colors",
                tab === t.id
                  ? "text-[#1D4ED8] dark:text-[#7db3ff]"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              )}
            >
              {t.label}
              {t.id === "analytics" && !isOwner && (
                <Lock className="ml-1 inline h-3 w-3 text-zinc-400" />
              )}
              {tab === t.id && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#2E7CF6]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── tab bodies ── */}
      <div className="mt-5">
        {tab === "predictions" && (
          <>
            <MatchPredictions walletAddress={profile.walletAddress} filter={predFilter} />
            <PredictionsTab
              predictions={predictions}
              loading={predLoading}
              filter={predFilter}
              onFilter={setPredFilter}
              hasMore={predCursor !== null}
              onLoadMore={() => loadPredictions(predCursor, true)}
              teams={teamRefs}
              fixtures={fixtures}
            />
          </>
        )}
        {tab === "markets" && (
          <MarketsTab
            markets={markets}
            loading={mktLoading}
            hasMore={mktCursor !== null}
            onLoadMore={() => loadMarkets(mktCursor, true)}
            teams={teamRefs}
            fixtures={fixtures}
          />
        )}
        {tab === "analytics" && (
          <AnalyticsTab
            username={profile.username}
            pnlTick={profile.stats.pnlTick}
            isOwner={isOwner}
            analytics={analytics}
            error={analyticsError}
          />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent = "" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-black/8 bg-black/[.02] p-3 dark:border-white/8 dark:bg-white/[.02]">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
        {label}
      </p>
      <p className={cn("mt-0.5 font-display text-xl font-bold tabular-nums text-zinc-900 dark:text-white", accent)}>
        {value}
      </p>
    </div>
  );
}

// ── predictions tab ──────────────────────────────────────────────────────────

const PRED_FILTERS: Array<{ id: PredictionStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "settled", label: "Settled" },
];

function PredictionsTab({
  predictions,
  loading,
  filter,
  onFilter,
  hasMore,
  onLoadMore,
  teams,
  fixtures,
}: {
  predictions: SocialPrediction[] | null;
  loading: boolean;
  filter: PredictionStatusFilter;
  onFilter: (f: PredictionStatusFilter) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  teams: TeamRef[];
  fixtures: Map<string, ApiFixture>;
}) {
  return (
    <div>
      <div className="mb-4 flex gap-2">
        {PRED_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => onFilter(f.id)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95",
              filter === f.id
                ? "bg-[#2E7CF6] text-white shadow-[0_0_14px_rgba(46,124,246,.4)]"
                : "border border-black/10 text-zinc-500 hover:border-[#2E7CF6]/40 dark:border-white/10 dark:text-zinc-400"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!predictions ? (
        <SkeletonRows rows={5} />
      ) : predictions.length === 0 && !loading ? (
        <EmptyState title="No predictions yet.">
          {filter === "all"
            ? "Predictions on permissionless markets will show up here."
            : `Nothing ${filter === "open" ? "open" : "settled"} right now.`}
        </EmptyState>
      ) : (
        <div className="space-y-2.5">
          {predictions.map((p) => {
            const question = marketQuestion(p.templateId, p.params, teams, fixtures);
            const pick = pickLabel(p.templateId, p.outcome, p.params, teams, fixtures);
            const odds = p.oddsBps !== null ? `${Math.round(p.oddsBps / 100)}%` : null;
            const pnl = p.pnlTick !== null ? Number(p.pnlTick) / 1e18 : null;
            return (
              <Link
                key={p.stakeId}
                href={`/markets/${p.marketId}`}
                className="glass card-interactive group block rounded-2xl p-4 transition-all hover:border-[#2E7CF6]/30 hover:shadow-[0_12px_35px_rgba(46,124,246,.10)] sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2E7CF6]/8 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]">
                        {TEMPLATE_NAMES[p.templateId] ?? "Market"}
                      </span>
                      <StatusPill status={p.status} won={p.won} />
                      <span className="text-[11px] text-zinc-400">{shortDate(p.stakedAt)}</span>
                    </div>
                    <h3 className="font-display text-base font-bold leading-snug text-zinc-900 transition-colors group-hover:text-[#1D4ED8] dark:text-white dark:group-hover:text-[#7db3ff] sm:text-lg">
                      {question}
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Created by {p.creatorName ? `@${p.creatorName}` : "unknown"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-display text-sm font-bold tabular-nums text-zinc-700 dark:text-zinc-200">
                      {fmtTick(p.amountTick, 0)} <span className="text-[10px] text-zinc-400">TICK staked</span>
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/5 pt-3 dark:border-white/8">
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-black/[.035] px-3 py-2 text-sm dark:bg-white/[.05]">
                    <span className="text-xs font-semibold text-zinc-500">Your pick</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">{pick}</span>
                    {odds && <span className="text-xs font-semibold tabular-nums text-zinc-500">{odds}</span>}
                  </span>
                  {pnl !== null && (
                    <span
                      className={cn(
                        "flex items-center gap-1.5 font-display text-sm font-bold tabular-nums",
                        pnl >= 0 ? "text-emerald-500 dark:text-emerald-300" : "text-red-500 dark:text-red-400"
                      )}
                    >
                      {pnl >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {fmtSignedTick(p.pnlTick)} <span className="text-xs font-semibold">TICK PnL</span>
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
          {loading && <SkeletonRows rows={2} />}
          {hasMore && !loading && (
            <button
              onClick={onLoadMore}
              className="w-full rounded-2xl border border-black/10 py-2.5 text-sm font-semibold text-zinc-600 transition-all hover:border-[#2E7CF6]/40 hover:text-[#1D4ED8] active:scale-[.99] dark:border-white/10 dark:text-zinc-300"
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── markets tab ──────────────────────────────────────────────────────────────

function MarketsTab({
  markets,
  loading,
  hasMore,
  onLoadMore,
  teams,
  fixtures,
}: {
  markets: SocialMarket[] | null;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  teams: TeamRef[];
  fixtures: Map<string, ApiFixture>;
}) {
  if (!markets) return <SkeletonRows rows={4} />;
  if (markets.length === 0 && !loading) {
    return (
      <EmptyState title="No markets created yet.">
        Markets this user launches will appear here.
      </EmptyState>
    );
  }
  return (
        <div className="grid gap-3 sm:grid-cols-2">
      {markets.map((m) => {
        const Icon = TEMPLATE_ICONS[m.templateId] ?? BarChart3;
        const question = marketQuestion(m.templateId, m.params, teams, fixtures);
        return (
          <Link
            key={m.marketId}
            href={`/markets/${m.marketId}`}
            className="glass card-interactive group rounded-2xl p-5 transition-all hover:border-[#2E7CF6]/30 hover:shadow-[0_12px_35px_rgba(46,124,246,.10)]"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2E7CF6]/8 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]">
                <Icon className="h-3.5 w-3.5" /> {TEMPLATE_NAMES[m.templateId] ?? "Market"}
              </span>
              <StatusPill status={m.state} />
            </div>
            <h3 className="font-display text-base font-bold leading-snug text-zinc-900 transition-colors group-hover:text-[#1D4ED8] dark:text-white dark:group-hover:text-[#7db3ff]">
              {question}
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-black/5 pt-3 dark:border-white/8">
              <div><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Pool</p><p className="mt-0.5 font-display text-sm font-bold tabular-nums text-zinc-800 dark:text-zinc-100">{fmtTick(m.totalStakedTick, 0)} TICK</p></div>
              <div className="text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Participants</p><p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{m.bettors} {m.bettors === 1 ? "bettor" : "bettors"}</p></div>
              <p className="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">Closes {shortDate(m.bettingCloseTime)}</p>
            </div>
          </Link>
        );
      })}
      {loading && <SkeletonRows rows={2} />}
      {hasMore && !loading && (
        <button
          onClick={onLoadMore}
          className="col-span-full rounded-2xl border border-black/10 py-2.5 text-sm font-semibold text-zinc-600 transition-all hover:border-[#2E7CF6]/40 hover:text-[#1D4ED8] active:scale-[.99] dark:border-white/10 dark:text-zinc-300"
        >
          Load more
        </button>
      )}
    </div>
  );
}

// ── analytics tab (owner only) ───────────────────────────────────────────────

function AnalyticsTab({
  username,
  pnlTick,
  isOwner,
  analytics,
  error,
}: {
  username: string;
  pnlTick: string;
  isOwner: boolean;
  analytics: SocialAnalytics | null;
  error: string | null;
}) {
  if (!isOwner) {
    return (
      <div className="glass flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2E7CF6]/10 dark:bg-[#2E7CF6]/15">
          <Lock className="h-5 w-5 text-[#2E7CF6]" />
        </span>
        <p className="font-display text-lg font-bold text-zinc-900 dark:text-white">
          Analytics are private
        </p>
        <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Advanced analytics belong to @{username} alone — win-rate curves,
          calibration and streaks are owner-view only.
        </p>
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!analytics) return <LoadingState label="Crunching your numbers…" />;

  const totalWins = analytics.winRateByTemplate.reduce((s, r) => s + r.wins, 0);
  const totalSettled = analytics.winRateByTemplate.reduce((s, r) => s + r.settled, 0);
  const overallRate = totalSettled > 0 ? (totalWins / totalSettled) * 100 : 0;

  const tiles: Array<{ label: string; value: string; icon?: ReactNode; accent?: string }> = [
    {
      label: "Net PnL",
      value: `${fmtSignedTick(pnlTick)} TICK`,
      icon: <TrendingUp className="h-4 w-4 text-[#2E7CF6]" />,
      accent: Number(pnlTick) >= 0 ? "text-emerald-500 dark:text-emerald-300" : "text-red-500 dark:text-red-400",
    },
    { label: "Settled", value: String(analytics.settled) },
    { label: "Win rate", value: `${overallRate.toFixed(1)}%`, icon: <Target className="h-4 w-4 text-[#2E7CF6]" /> },
    {
      label: "Current streak",
      value: `${analytics.currentStreak > 0 ? "+" : ""}${analytics.currentStreak}`,
      icon: <Flame className="h-4 w-4 text-amber-500 dark:text-amber-400" />,
      accent: analytics.currentStreak > 0 ? "text-emerald-500 dark:text-emerald-300" : analytics.currentStreak < 0 ? "text-red-500 dark:text-red-400" : "",
    },
    { label: "Best streak", value: `+${analytics.bestStreak}` },
    { label: "Volume", value: `${fmtTick(analytics.volumeTick, 0)} TICK` },
    {
      label: "Avg odds taken",
      value: analytics.avgOddsBps !== null ? `${(analytics.avgOddsBps / 100).toFixed(0)}%` : "—",
    },
    {
      label: "Best win",
      value: `+${fmtTick(analytics.bestWinTick)}`,
      accent: "text-emerald-500 dark:text-emerald-300",
    },
    {
      label: "Worst loss",
      value: fmtTick(analytics.worstLossTick),
      accent: "text-red-500 dark:text-red-400",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="glass rounded-2xl p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
              {t.icon}
              {t.label}
            </p>
            <p className={cn("mt-1 font-display text-xl font-bold tabular-nums text-zinc-900 dark:text-white", t.accent)}>
              {t.value}
            </p>
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-5">
        <h3 className="mb-1 font-display text-base font-bold text-zinc-900 dark:text-white">PnL over time</h3>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">Cumulative realized profit, TICK.</p>
        <PnlChart points={analytics.pnlCurve} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass rounded-2xl p-5">
          <h3 className="mb-1 font-display text-base font-bold text-zinc-900 dark:text-white">Win rate by market type</h3>
          <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">Where your edge actually lives.</p>
          <TemplateBars rows={analytics.winRateByTemplate} />
        </div>
        <div className="glass rounded-2xl p-5">
          <h3 className="mb-1 font-display text-base font-bold text-zinc-900 dark:text-white">Calibration</h3>
          <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">Do you beat the odds you take?</p>
          <CalibrationChart buckets={analytics.calibration} />
        </div>
      </div>
    </div>
  );
}

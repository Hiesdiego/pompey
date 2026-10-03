/**
 * Market detail page (v0.3): /markets/[id] — billion-dollar standard.
 *
 * - Hero: template identity, the full question in plain language, rich
 *   per-template context (fixture matchup for spreads), live state pill,
 *   and a stat strip (pool, countdown, outcomes, your position).
 * - Odds board: every outcome as a tappable row with logo, animated live
 *   %, staked TICK and a bar. Tapping opens the stake modal.
 * - StakeModal: the flagship staking UX — big outcome buttons with live
 *   odds, quick amount chips, MAX, live potential-win preview, one-tap
 *   confirm. Bottom-sheet on mobile, dialog on desktop.
 * - Your position, Settle (resolve/void/claim), HowThisResolves, and
 *   Similar markets.
 * - Live: a single watchContractEvent subscription patches stakes and
 *   settlement state in place; odds tween via useAnimatedValue.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Info,
  Gavel,
  Ban,
  HandCoins,
  Trophy,
  Timer,
  X,
  Crown,
  Swords,
  Target,
  BarChart3,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { ShareButtons } from "../../../components/ShareButtons";
import { getPublicClient } from "../../../hooks/usePublicClient";
import { useTickr } from "../../../hooks/useTickr";
import { useTeams } from "../../../hooks/useTeams";
import { useContractWrite } from "../../../hooks/useContractWrite";
import { useTickBalance } from "../../../hooks/useTickBalance";
import { useMarket } from "../../../lib/query/useMarket";
import { useFactoryEvents } from "../../../lib/query/useFactoryEvents";
import { qks } from "../../../lib/query/keys";
import { queryClient } from "../../../lib/query/queryClient";
import {
  MARKET_FACTORY_ADDRESS,
  MARKET_FACTORY_ABI,
  TEMPLATES,
  TEMPLATE_NAMES,
  TEMPLATE_DESCRIPTIONS,
  FACTORY_MIN_STAKE_TICK,
  VOID_CHALLENGE_WINDOW_SECONDS,
  normalizeMarketInfo,
  normalizeMarketSettlement,
} from "../../../lib/marketFactory";
import { CONTRACTS, TICK_TOKEN_ABI } from "../../../lib/contracts";
import { ErrorState, SkeletonMarketDetail } from "../../../components/States";
import { Countdown } from "../../../components/Countdown";
import { TeamBadge } from "../../../components/TeamBadge";
import { toast } from "../../../components/Toast";
import { api, type ApiFixture, type ApiFixtureTeam } from "../../../lib/api";
import { cn } from "../../../lib/cn";
import { formatTick } from "../../../lib/format";

interface MarketDetail {
  id: bigint;
  templateId: number;
  creator: string;
  creatorName: string;
  bettingCloseTime: bigint;
  endTime: bigint;
  voidAfter: bigint;
  voidInitiatedAt: bigint;
  params: `0x${string}`;
  outcomeCount: number;
  seedAmount: bigint;
  totalStaked: bigint;
  state: number;
  winnerBitmap: bigint;
  payoutPerShare: bigint;
}

type TeamRef = { teamId: number; name: string; symbol: string };

const TEMPLATE_STYLE: Record<number, { icon: LucideIcon; accent: string; chip: string }> = {
  [TEMPLATES.TOP_GAINER]: { icon: Trophy, accent: "text-[#2E7CF6]", chip: "bg-[#2E7CF6]/10 text-[#2E7CF6]" },
  [TEMPLATES.CHAMPION]: { icon: Crown, accent: "text-amber-500", chip: "bg-amber-500/10 text-amber-500" },
  [TEMPLATES.H2H]: { icon: Swords, accent: "text-violet-500", chip: "bg-violet-500/10 text-violet-500" },
  [TEMPLATES.TARGET]: { icon: Target, accent: "text-emerald-500", chip: "bg-emerald-500/10 text-emerald-500" },
  [TEMPLATES.SPREAD]: { icon: BarChart3, accent: "text-rose-500", chip: "bg-rose-500/10 text-rose-500" },
};

/** Tweens a number toward its target — the live odds ticker. */
function useAnimatedValue(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      fromRef.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function teamSymbol(teams: TeamRef[], teamId: number): string {
  return teams.find((t) => t.teamId === teamId)?.symbol ?? `#${teamId}`;
}

function teamName(teams: TeamRef[], teamId: number): string {
  return teams.find((t) => t.teamId === teamId)?.name ?? teamSymbol(teams, teamId);
}

/** Full spread context: fixture teams in home/away order, spread in goals, timing. */
interface SpreadInfo {
  fixtureId: string;
  spread: number;
  home: ApiFixtureTeam | null;
  away: ApiFixtureTeam | null;
  matchdayIndex: number;
  kickoff: string | null;
}

function getSpreadInfo(
  market: { params: `0x${string}` },
  fixtures: Map<string, ApiFixture>
): SpreadInfo | null {
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

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

/** Which coin (if any) an outcome represents — drives logos. */
function outcomeTeamId(
  market: { templateId: number; params: `0x${string}` },
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
      return (outcomeIndex === 0 ? si?.home : si?.away)?.teamId ?? null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getOutcomeLabels(market: MarketDetail, teams: TeamRef[]): string[] {
  const t = market.templateId;
  if (t === TEMPLATES.TOP_GAINER || t === TEMPLATES.CHAMPION) {
    return teams.slice(0, market.outcomeCount).map((tm) => `${tm.symbol}`);
  }
  if (t === TEMPLATES.H2H || t === TEMPLATES.TARGET || t === TEMPLATES.SPREAD) {
    try {
      if (t === TEMPLATES.H2H) {
        const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params);
        const sa = teamSymbol(teams, a);
        const sb = teamSymbol(teams, b);
        return [`${sa} gains more`, `${sb} gains more`];
      }
      // TARGET and SPREAD are YES/NO markets.
      return ["Yes", "No"];
    } catch {
      return Array.from({ length: market.outcomeCount }, (_, i) => `Outcome ${i}`);
    }
  }
  return Array.from({ length: market.outcomeCount }, (_, i) => `Outcome ${i}`);
}

/** The full question in plain, non-misleading language. */
function describeMarket(
  market: { templateId: number; params: `0x${string}`; outcomeCount: number },
  teams: TeamRef[],
  fixtures: Map<string, ApiFixture> = new Map()
): string {
  const t = market.templateId;
  try {
    if (t === TEMPLATES.TOP_GAINER) {
      const [, md] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), market.params);
      return `Which coin gains the most on matchday ${Number(md) + 1}?`;
    }
    if (t === TEMPLATES.CHAMPION) return "Who will win the season championship?";
    if (t === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params);
      return `Will ${teamName(teams, a)} outperform ${teamName(teams, b)}?`;
    }
    if (t === TEMPLATES.TARGET) {
      const [teamId, target, , above] = decodeAbiParameters(
        parseAbiParameters("uint16, uint256, uint64, bool"),
        market.params
      );
      const s = teamName(teams, teamId);
      return `Will ${s} finish ${above ? "above" : "below"} $${(Number(target) / 1e8).toLocaleString()}?`;
    }
    if (t === TEMPLATES.SPREAD) {
      const si = getSpreadInfo(market, fixtures);
      if (si?.home && si?.away) {
        const abs = Math.abs(si.spread);
        const goalWord = abs === 1 ? "goal" : "goals";
        if (si.spread >= 0) {
          return `Will ${si.home.name} beat ${si.away.name} by more than ${abs} ${goalWord}?`;
        }
        return `Will ${si.home.name} avoid losing to ${si.away.name} by ${abs}+ ${goalWord}?`;
      }
      return "Will the home team cover the fixture spread?";
    }
  } catch {
    // fall through
  }
  return TEMPLATE_NAMES[t] ?? "Market";
}

/**
 * Estimated payout for staking `amountTick` on an outcome right now.
 * Winners share 94% of all stakes plus 100% of the seed.
 * Display-only estimate — the real payout is computed on-chain at settlement.
 */
function potentialWin(
  amountTick: number,
  outcomeIdx: number,
  outcomeTotals: bigint[],
  totalStaked: bigint,
  seedAmount: bigint
): { win: number; multiple: number } {
  if (amountTick <= 0) return { win: 0, multiple: 0 };
  const A = BigInt(Math.round(amountTick * 1e18));
  const To = outcomeTotals[outcomeIdx] ?? 0n;
  const newTo = To + A;
  if (newTo === 0n) return { win: 0, multiple: 0 };
  const payoutPool = ((totalStaked + A) * 94n) / 100n + seedAmount;
  const winWei = (A * payoutPool) / newTo;
  const win = Number(winWei) / 1e18;
  return { win, multiple: win / amountTick };
}

function StatePill({
  market,
  bettingOpen,
  closingSoon,
}: {
  market: MarketDetail;
  bettingOpen: boolean;
  closingSoon: boolean;
}) {
  if (market.state === 1)
    return (
      <span className="shrink-0 rounded-full bg-blue-500/10 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wider text-blue-500">
        Resolved
      </span>
    );
  if (market.state === 2)
    return (
      <span className="shrink-0 rounded-full bg-zinc-500/10 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wider text-zinc-500">
        Void
      </span>
    );
  if (closingSoon)
    return (
      <span className="flex shrink-0 animate-pulse items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wider text-red-500">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        Closing soon
      </span>
    );
  if (bettingOpen)
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wider text-red-500">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        Live
      </span>
    );
  return (
    <span className="shrink-0 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wider text-amber-500">
      Betting closed
    </span>
  );
}

// ── main page ───────────────────────────────────────────────────────

export default function MarketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = BigInt(params.id as string);
  const { playerAddress: address } = useTickr();
  const publicClient = getPublicClient();
  const { teams } = useTeams();
  const { write, writeBatch, status } = useContractWrite();
  const { balance } = useTickBalance(address ?? null);

  const { market: summary, isLoading: marketLoading, error: marketError } = useMarket(id);
  useFactoryEvents();
  const market: MarketDetail | null = useMemo(() => summary ? {
    id: BigInt(summary.id), templateId: summary.templateId, creator: summary.creator,
    creatorName: summary.creatorName, bettingCloseTime: BigInt(summary.bettingCloseTime),
    endTime: BigInt(summary.endTime), voidAfter: BigInt(summary.voidAfter),
    voidInitiatedAt: BigInt(summary.voidInitiatedAt), params: summary.params as `0x${string}`,
    outcomeCount: summary.outcomeCount, seedAmount: BigInt(summary.seedAmount),
    totalStaked: BigInt(summary.totalStaked), state: summary.state,
    winnerBitmap: BigInt(summary.winnerBitmap), payoutPerShare: BigInt(summary.payoutPerShare),
  } : null, [summary]);
  const outcomeTotals = useMemo(() => summary?.outcomeTotals.map((t) => BigInt(t)) ?? null, [summary]);
  const [userStakes, setUserStakes] = useState<bigint[] | null>(null);
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [fixtures, setFixtures] = useState<Map<string, ApiFixture>>(new Map());
  const [stakeSel, setStakeSel] = useState<number | null>(null);
  const [stakeAmount, setStakeAmount] = useState("");
  const [showAllOutcomes, setShowAllOutcomes] = useState(false);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!address || !summary || !publicClient || !MARKET_FACTORY_ADDRESS) return;
    let alive = true;
    const calls = Array.from({ length: summary.outcomeCount }, (_, o) => ({
      address: MARKET_FACTORY_ADDRESS, abi: MARKET_FACTORY_ABI, functionName: "stakes" as const,
      args: [id, address, BigInt(o)] as const,
    }));
    void publicClient.multicall({ contracts: calls, allowFailure: true }).then((results) => {
      if (alive) setUserStakes(results.map((r) => r.status === "success" ? r.result as bigint : 0n));
    }).catch(() => {});
    void publicClient.readContract({ address: MARKET_FACTORY_ADDRESS, abi: MARKET_FACTORY_ABI,
      functionName: "claimed", args: [id, address] }).then((value) => {
      if (alive) setAlreadyClaimed(value as boolean);
    }).catch(() => {});
    return () => { alive = false; };
  }, [address, id, summary, publicClient]);

  // Fixture directory (spread markets).
  useEffect(() => {
    let alive = true;
    api
      .fixtures()
      .then((list) => {
        if (alive) setFixtures(new Map(list.map((f) => [f.fixtureId, f])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const outcomeLabels = useMemo(() => {
    if (!market || !teams) return [];
    return getOutcomeLabels(market, teams);
  }, [market, teams]);

  const bettingOpen =
    market !== null &&
    market.state === 0 &&
    (market.templateId === TEMPLATES.SPREAD
      ? true // SPREAD mirrors the fixture window — contract enforces it
      : Number(market.bettingCloseTime) > nowSec);
  const secondsLeft = market ? Number(market.bettingCloseTime) - nowSec : 0;
  const closingSoon = bettingOpen && market!.templateId !== TEMPLATES.SPREAD && secondsLeft < 3600;
  const resolvable = market !== null && market.state === 0 && Number(market.endTime) <= nowSec;
  // Optimistic two-step void: initiate starts a 2-day challenge; finalize
  // only works after the challenge elapses with no resolution.
  const voidChallengeActive = market !== null && market.voidInitiatedAt > 0n;
  const voidFinalizeAt = voidChallengeActive ? Number(market!.voidInitiatedAt) + VOID_CHALLENGE_WINDOW_SECONDS : 0;
  const canInitiateVoid =
    market !== null && market.state === 0 && !voidChallengeActive && Number(market.voidAfter) <= nowSec;
  const canFinalizeVoid =
    market !== null && market.state === 0 && voidChallengeActive && nowSec >= voidFinalizeAt;

  const stakedTotal = outcomeTotals?.reduce((s, v) => s + v, 0n) ?? 0n;
  const poolWei = (market?.totalStaked ?? 0n) + (market?.seedAmount ?? 0n);
  const leadingIndex =
    outcomeTotals && stakedTotal > 0n
      ? outcomeTotals.reduce((best, v, i, vs) => (v > (vs[best] ?? 0n) ? i : best), 0)
      : 0;

  async function handleStake() {
    if (!market || !address || !publicClient || stakeSel === null) return;
    const amount = Number(stakeAmount);
    if (!amount || amount < FACTORY_MIN_STAKE_TICK) return;
    const amountWei = BigInt(Math.round(amount * 1e18));
    const label = outcomeLabels[stakeSel] ?? `Outcome ${stakeSel}`;
    try {
      const allowance = (await publicClient.readContract({
        address: CONTRACTS.tickToken as `0x${string}`,
        abi: TICK_TOKEN_ABI,
        functionName: "allowance",
        args: [address, MARKET_FACTORY_ADDRESS!],
      })) as bigint;
      // Improvement B — approval buffer (max amount × 10, 10k TICK): future
      // stakes skip the approve. approve+stake go in ONE batched userOp on
      // smart wallets; sequential sponsored txs on embedded wallets.
      const calls = [];
      if (allowance < amountWei) {
        const floor = BigInt(10_000) * 10n ** 18n;
        const scaled = amountWei * 10n;
        const buffer = scaled > floor ? scaled : floor;
        calls.push({
          address: CONTRACTS.tickToken as `0x${string}`,
          abi: TICK_TOKEN_ABI,
          functionName: "approve",
          args: [MARKET_FACTORY_ADDRESS!, buffer],
          label: "TICK approval",
        });
      }
      calls.push({
        address: MARKET_FACTORY_ADDRESS!,
        abi: MARKET_FACTORY_ABI,
        functionName: "stake",
        args: [id, BigInt(stakeSel), amountWei],
        label: "Stake",
      });
      await writeBatch(calls, {
        label: "Stake",
        onHashed: (hash) => {
          // Optimistic: toast + close the modal at broadcast — the receipt
          // is awaited in the background and queries reconcile on landing.
          toast.success("Stake submitted ⚡", {
            detail: `${amount.toLocaleString()} TICK on ${label}`,
            link: `https://sepolia.basescan.org/tx/${hash}`,
          });
          setStakeAmount("");
          setStakeSel(null);
        },
      });
      void queryClient.invalidateQueries({ queryKey: qks.market(id.toString()) });
      void queryClient.invalidateQueries({ queryKey: qks.balance(address.toLowerCase()) });
    } catch (err) {
      toast.error(
        "Stake failed",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  async function handleResolve() {
    await write({
      address: MARKET_FACTORY_ADDRESS!,
      abi: MARKET_FACTORY_ABI,
      functionName: "resolve",
      args: [id],
    });
    void queryClient.invalidateQueries({ queryKey: qks.market(id.toString()) });
  }

  async function handleInitiateVoid() {
    await write({
      address: MARKET_FACTORY_ADDRESS!,
      abi: MARKET_FACTORY_ABI,
      functionName: "initiateVoid",
      args: [id],
    });
    void queryClient.invalidateQueries({ queryKey: qks.market(id.toString()) });
  }

  async function handleFinalizeVoid() {
    await write({
      address: MARKET_FACTORY_ADDRESS!,
      abi: MARKET_FACTORY_ABI,
      functionName: "finalizeVoid",
      args: [id],
    });
    void queryClient.invalidateQueries({ queryKey: qks.market(id.toString()) });
  }

  async function handleClaim() {
    await write({
      address: MARKET_FACTORY_ADDRESS!,
      abi: MARKET_FACTORY_ABI,
      functionName: "claim",
      args: [id],
    });
    void queryClient.invalidateQueries({ queryKey: qks.market(id.toString()) });
  }

  if (!MARKET_FACTORY_ADDRESS) {
    return (
      <div className="py-10">
        <ErrorState message="Markets not deployed on this network yet." onRetry={() => router.back()} />
      </div>
    );
  }
  if (marketError) {
    return (
      <div className="py-10">
        <ErrorState message={marketError.message} onRetry={() => void queryClient.invalidateQueries({ queryKey: qks.market(id.toString()) })} />
      </div>
    );
  }
  if (marketLoading || !market || !outcomeTotals) {
    return (
      <div className="py-10">
        <SkeletonMarketDetail />
      </div>
    );
  }

  const busy = status === "pending";
  const style = TEMPLATE_STYLE[market.templateId] ?? TEMPLATE_STYLE[TEMPLATES.TOP_GAINER];
  const Icon = style.icon;
  const question = describeMarket(market, teams ?? [], fixtures);
  const creator =
    market.creatorName ||
    (market.creator ? `${market.creator.slice(0, 6)}…${market.creator.slice(-4)}` : "Unknown creator");
  const spreadInfo = market.templateId === TEMPLATES.SPREAD ? getSpreadInfo(market, fixtures) : null;

  return (
    <div className="mx-auto max-w-5xl pb-20 lg:pb-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/markets" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-[#2E7CF6]">
          <ArrowLeft className="h-4 w-4" /> All markets
        </Link>
        {market && <ShareButtons path={`/markets/${id}`} text={`${question} — predict on TICKR`} compact />}
      </div>

      {/* Market hero */}
      <section className="relative mb-6 overflow-hidden rounded-[2rem] border border-black/[.08] bg-white p-6 text-zinc-900 shadow-[0_24px_80px_rgba(0,0,0,.12)] dark:border-white/10 dark:bg-[#0c111b] dark:text-white dark:shadow-[0_24px_80px_rgba(0,0,0,.28)] sm:p-9">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[#2E7CF6]/15 blur-[90px] dark:bg-[#2E7CF6]/20" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-56 w-80 rounded-full bg-emerald-400/10 blur-[85px]" />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.14em]", style.chip)}>
              <Icon className="h-3.5 w-3.5" /> {TEMPLATE_NAMES[market.templateId] ?? "Market"}
            </span>
            <StatePill market={market} bettingOpen={bettingOpen} closingSoon={closingSoon} />
          </div>
          <h1 className="mt-6 max-w-4xl font-display text-3xl font-black leading-[1.08] tracking-tight sm:text-5xl">{question}</h1>
          {spreadInfo?.home && spreadInfo?.away && (
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-white/70">
              <TeamBadge teamId={spreadInfo.home.teamId} size={32} showName={false} />
              <span className="font-bold">{spreadInfo.home.name}</span>
              <span className="text-zinc-400 dark:text-white/35">vs</span>
              <TeamBadge teamId={spreadInfo.away.teamId} size={32} showName={false} />
              <span className="font-bold">{spreadInfo.away.name}</span>
              <span className="rounded-lg bg-rose-500/10 px-2.5 py-1 font-bold text-rose-600 dark:text-rose-300">Spread {spreadInfo.spread > 0 ? `−${Math.abs(spreadInfo.spread)}` : spreadInfo.spread < 0 ? `+${Math.abs(spreadInfo.spread)}` : "0"}</span>
            </div>
          )}
          <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-4 border-t border-black/[.08] pt-5 dark:border-white/10">
            <div className="flex items-center gap-2.5">
              {(() => {
                const ids = Array.from(new Set(outcomeTotals.map((_, i) => outcomeTeamId(market, i, fixtures)).filter((x): x is number => x !== null))).slice(0, 4);
                return ids.length ? <div className="flex -space-x-2">{ids.map((teamId) => <span key={teamId} className="rounded-full ring-2 ring-white dark:ring-[#0c111b]"><TeamBadge teamId={teamId} size={30} showName={false} /></span>)}</div> : null;
              })()}
              <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500 dark:text-white/40">Created by</div><div className="text-sm font-semibold">{creator}</div></div>
            </div>
            <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500 dark:text-white/40">{bettingOpen ? "Closes in" : "Betting"}</div><div className={cn("font-display text-lg font-extrabold tabular-nums", closingSoon && "text-rose-600 dark:text-rose-300")}>
              {bettingOpen ? market.templateId === TEMPLATES.SPREAD ? "5 min before match end" : <Countdown target={Number(market.bettingCloseTime) * 1000} /> : market.state === 0 ? "Closed" : "Settled"}
            </div></div>
            <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500 dark:text-white/40">Total pool</div><div className="font-display text-lg font-extrabold tabular-nums">{formatTick(poolWei)} <span className="text-xs text-zinc-500 dark:text-white/50">TICK</span></div></div>
            {spreadInfo?.kickoff && <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500 dark:text-white/40">Kickoff</div><div className="text-sm font-semibold">{formatKickoff(spreadInfo.kickoff)}</div></div>}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/* ── Odds board ── */}
          <OddsBoard
            market={market}
            outcomeTotals={outcomeTotals}
            outcomeLabels={outcomeLabels}
            teams={teams ?? []}
            fixtures={fixtures}
            userStakes={userStakes}
            showAll={showAllOutcomes}
            onToggleShowAll={() => setShowAllOutcomes((v) => !v)}
            onSelect={(o) => {
              if (!bettingOpen) return;
              setStakeSel(o);
            }}
            selectable={bettingOpen}
          />

          {/* ── Your position ── */}
          {userStakes && userStakes.some((s) => s > 0n) && (
            <PositionPanel
              market={market}
              outcomeTotals={outcomeTotals}
              outcomeLabels={outcomeLabels}
              teams={teams ?? []}
              fixtures={fixtures}
              userStakes={userStakes}
            />
          )}

          {/* ── Settle ── */}
          <div className="glass mb-6 rounded-2xl p-6">
            <h2 className="mb-1 font-display text-lg font-extrabold">Settle</h2>
            <p className="mb-4 text-xs text-zinc-500">Anyone can settle this market. Resolving earns a 1% bounty.</p>
            <div className="flex flex-wrap gap-3">
              {market.state === 0 && (
                <>
                  <button
                    onClick={handleResolve}
                    disabled={busy || !resolvable || !address}
                    title={resolvable ? "Resolve this market (earns the 1% resolver bounty)" : "Resolving unlocks after the end time"}
                    className="flex items-center gap-2 rounded-xl border border-[#2E7CF6]/40 px-4 py-2.5 text-sm font-bold text-[#2E7CF6] transition-all hover:bg-[#2E7CF6]/10 disabled:opacity-40"
                  >
                    <Gavel className="h-4 w-4" />
                    {busy ? "Confirm…" : "Resolve · earn 1%"}
                  </button>
                  {canInitiateVoid ? (
                    <button
                      onClick={handleInitiateVoid}
                      disabled={busy || !address}
                      title="Start a 2-day void challenge"
                      className="flex items-center gap-2 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-bold text-zinc-600 transition-all hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
                    >
                      <Ban className="h-4 w-4" />
                      {busy ? "Confirm…" : "Initiate void"}
                    </button>
                  ) : voidChallengeActive ? (
                    <>
                      <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-sm font-bold text-amber-600 dark:text-amber-400">
                        <Timer className="h-4 w-4" />
                        Void challenge ends in <Countdown targetMs={voidFinalizeAt * 1000} compact />
                      </div>
                      <button
                        onClick={handleFinalizeVoid}
                        disabled={busy || !canFinalizeVoid || !address}
                        title={canFinalizeVoid ? "Finalize the void — refunds all stakes" : "Finalizing unlocks when the challenge window ends"}
                        className="flex items-center gap-2 rounded-xl border border-rose-500/40 px-4 py-2.5 text-sm font-bold text-rose-600 transition-all hover:bg-rose-500/10 disabled:opacity-40 dark:text-rose-400"
                      >
                        <Ban className="h-4 w-4" />
                        {busy ? "Confirm…" : "Finalize void"}
                      </button>
                    </>
                  ) : null}
                </>
              )}
              {market.state !== 0 && address && !alreadyClaimed && (
                <button
                  onClick={handleClaim}
                  disabled={busy}
                  className="gradient-cta flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                >
                  <HandCoins className="h-4 w-4" />
                  {busy ? "Confirm…" : market.state === 1 ? "Claim winnings" : "Claim refund"}
                </button>
              )}
              {alreadyClaimed && <p className="text-sm text-zinc-500">You've claimed this market.</p>}
            </div>
          </div>
        </div>

        <div>
          {/* ── Stake CTA (sticky) ── */}
          <div className="glass relative z-20 mb-6 self-start rounded-2xl p-5 lg:sticky lg:top-4">
            <div className="text-center">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                {stakedTotal > 0n ? "Leading" : "No stakes yet"}
              </div>
              {stakedTotal > 0n ? (
                <>
                  <div className="mt-1 font-display text-4xl font-black tabular-nums text-zinc-900 dark:text-white">
                    {(Number((outcomeTotals[leadingIndex] ?? 0n) * 10_000n / stakedTotal) / 100).toFixed(1)}%
                  </div>
                  <div className="mt-1 flex items-center justify-center gap-2 text-sm font-bold">
                    {(() => {
                      const tid = outcomeTeamId(market, leadingIndex, fixtures);
                      return tid !== null ? <TeamBadge teamId={tid} size={22} showName={false} /> : null;
                    })()}
                    {outcomeLabels[leadingIndex]}
                  </div>
                </>
              ) : (
                <div className="mt-1 font-display text-lg font-extrabold text-zinc-500">
                  Early predictors get the best odds
                </div>
              )}
            </div>
            <button
              onClick={() => bettingOpen && setStakeSel(leadingIndex)}
              disabled={!bettingOpen}
              className="gradient-cta mt-5 w-full rounded-2xl py-4 font-display text-lg font-extrabold text-white shadow-[0_0_24px_rgba(46,124,246,0.45)] transition-all hover:shadow-[0_0_36px_rgba(46,124,246,0.65)] active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
            >
              {bettingOpen ? "Stake now" : market.state === 0 ? "Betting closed" : "Market settled"}
            </button>
            <p className="mt-3 text-center text-[11px] text-zinc-500">Choose an outcome to see your live odds.</p>
          </div>

          {/* ── How this resolves ── */}
          <HowThisResolves market={market} teams={teams ?? []} />
        </div>
      </div>

      {/* ── Similar markets ── */}
      <SimilarMarkets currentId={id} templateId={market.templateId} teams={teams ?? []} fixtures={fixtures} />

      {/* ── Stake modal ── */}
      <StakeModal
        market={market}
        outcomeTotals={outcomeTotals}
        outcomeLabels={outcomeLabels}
        teams={teams ?? []}
        fixtures={fixtures}
        outcome={stakeSel}
        amount={stakeAmount}
        onAmountChange={setStakeAmount}
        balance={balance}
        address={address ?? null}
        bettingOpen={bettingOpen}
        busy={busy}
        onClose={() => {
          setStakeSel(null);
          setStakeAmount("");
        }}
        onConfirm={handleStake}
      />

      {/* ── Sticky mobile stake bar ── */}
      {/* Desktop keeps the in-flow sticky sidebar CTA; on mobile this fixed
          bottom bar keeps "Stake" one tap away without scrolling back up. */}
      {bettingOpen && stakeSel === null && (
        <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
          <div className="border-t border-black/10 bg-white/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur dark:border-white/10 dark:bg-[#101722]/95">
            <div className="mx-auto flex max-w-5xl items-center gap-3 px-4">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                  {stakedTotal > 0n ? "Leading" : "No stakes yet"}
                </div>
                <div className="truncate font-display text-sm font-extrabold">
                  {stakedTotal > 0n && (
                    <span className="tabular-nums text-[#1D4ED8] dark:text-[#75aaff]">
                      {(Number((outcomeTotals[leadingIndex] ?? 0n) * 10_000n / stakedTotal) / 100).toFixed(1)}%{" "}
                    </span>
                  )}
                  {outcomeLabels[leadingIndex]}
                </div>
              </div>
              <button
                onClick={() => setStakeSel(leadingIndex)}
                className="gradient-cta shrink-0 rounded-xl px-6 py-2.5 font-display text-sm font-extrabold text-white shadow-[0_0_20px_rgba(46,124,246,0.45)] active:scale-[0.98]"
              >
                Stake
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── odds board ──────────────────────────────────────────────────────

function OutcomeRow({
  index,
  label,
  total,
  share,
  teamId,
  userStake,
  selectable,
  onSelect,
  isWinner,
}: {
  index: number;
  label: string;
  total: bigint;
  share: number;
  teamId: number | null;
  userStake: bigint;
  selectable: boolean;
  onSelect: () => void;
  isWinner: boolean;
}) {
  const animated = useAnimatedValue(share);
  return (
    <button
      onClick={onSelect}
      disabled={!selectable}
      className={cn(
        "group w-full rounded-2xl border p-4 text-left transition-all",
        isWinner
          ? "border-emerald-400/60 bg-emerald-500/[.06] shadow-[0_0_20px_rgba(16,185,129,0.18)]"
          : "border-black/5 bg-black/[.02] dark:border-white/10 dark:bg-white/[.03]",
        selectable && "cursor-pointer hover:-translate-y-0.5 hover:border-[#2E7CF6]/40 hover:shadow-[0_8px_28px_rgba(46,124,246,0.18)]",
        !selectable && "cursor-default"
      )}
    >
      <div className="flex items-center gap-3">
        {teamId !== null ? (
          <TeamBadge teamId={teamId} size={40} showName={false} />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2E7CF6]/10 font-display text-sm font-extrabold text-[#2E7CF6]">
            {index + 1}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-base font-extrabold text-zinc-900 dark:text-white">
              {label}
            </span>
            {userStake > 0n && (
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-500">
                Your pick
              </span>
            )}
            {isWinner && (
              <span className="shrink-0 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
                Winner
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500">
            {formatTick(total)} TICK
            {userStake > 0n && <span className="text-zinc-400"> · you: {formatTick(userStake)}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-black tabular-nums text-zinc-900 dark:text-white">
            {animated.toFixed(1)}<span className="text-sm text-zinc-400">%</span>
          </div>
          <div className="text-[11px] font-bold tabular-nums text-zinc-500">{share > 0 ? `${(100 / share).toFixed(2)}×` : "—"} odds</div>
          {selectable && (
            <div className="text-[11px] font-bold text-[#2E7CF6] opacity-0 transition-opacity group-hover:opacity-100">
              Tap to stake →
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.06]">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-out",
            isWinner
              ? "bg-gradient-to-r from-emerald-400 to-emerald-600 shadow-[0_0_12px_rgba(16,185,129,.5)]"
              : "bg-gradient-to-r from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_12px_rgba(46,124,246,.4)]"
          )}
          style={{ width: `${Math.max(0, Math.min(100, animated))}%` }}
        />
      </div>
    </button>
  );
}

function OddsBoard({
  market,
  outcomeTotals,
  outcomeLabels,
  teams,
  fixtures,
  userStakes,
  showAll,
  onToggleShowAll,
  onSelect,
  selectable,
}: {
  market: MarketDetail;
  outcomeTotals: bigint[];
  outcomeLabels: string[];
  teams: TeamRef[];
  fixtures: Map<string, ApiFixture>;
  userStakes: bigint[] | null;
  showAll: boolean;
  onToggleShowAll: () => void;
  onSelect: (o: number) => void;
  selectable: boolean;
}) {
  const stakedTotal = outcomeTotals.reduce((s, v) => s + v, 0n);
  const rows = outcomeTotals
    .map((total, i) => ({
      i,
      total,
      share: stakedTotal > 0n ? Number((total * 10_000n) / stakedTotal) / 100 : 0,
      teamId: outcomeTeamId(market, i, fixtures),
    }))
    .sort((a, b) => Number(b.total - a.total));
  const visible = showAll ? rows : rows.slice(0, 6);
  const winnerIndex =
    market.state === 1
      ? Array.from({ length: market.outcomeCount }, (_, i) => i).filter(
          (i) => (market.winnerBitmap & (1n << BigInt(i))) !== 0n
        )
      : [];

  return (
    <div className="glass mb-6 rounded-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-extrabold">
          Odds{" "}
          <span className="relative ml-1 inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
        </h2>
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">live</span>
      </div>
      {stakedTotal === 0n && (
        <p className="mb-4 rounded-xl bg-amber-500/[.07] px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          No stakes yet — be first and lock in the best implied odds.
        </p>
      )}
      <div className="space-y-3">
        {visible.map((r) => (
          <OutcomeRow
            key={r.i}
            index={r.i}
            label={outcomeLabels[r.i] ?? `Outcome ${r.i}`}
            total={r.total}
            share={r.share}
            teamId={r.teamId}
            userStake={userStakes?.[r.i] ?? 0n}
            selectable={selectable}
            onSelect={() => onSelect(r.i)}
            isWinner={winnerIndex.includes(r.i)}
          />
        ))}
      </div>
      {rows.length > 6 && (
        <button
          onClick={onToggleShowAll}
          className="mt-4 flex w-full items-center justify-center gap-1 rounded-xl border border-black/10 py-2.5 text-sm font-bold text-zinc-600 transition-colors hover:bg-black/5 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
        >
          {showAll ? "Show less" : `Show all ${rows.length} outcomes`}
          <ChevronDown className={cn("h-4 w-4 transition-transform", showAll && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

// ── your position ───────────────────────────────────────────────────

function PositionPanel({
  market,
  outcomeTotals,
  outcomeLabels,
  teams,
  fixtures,
  userStakes,
}: {
  market: MarketDetail;
  outcomeTotals: bigint[];
  outcomeLabels: string[];
  teams: TeamRef[];
  fixtures: Map<string, ApiFixture>;
  userStakes: bigint[];
}) {
  const stakedTotal = outcomeTotals.reduce((s, v) => s + v, 0n);
  const rows = userStakes
    .map((s, i) => ({ i, s }))
    .filter((r) => r.s > 0n)
    .map((r) => {
      const To = outcomeTotals[r.i] ?? 0n;
      const payoutPool = (stakedTotal * 94n) / 100n + market.seedAmount;
      const win = To > 0n ? Number((r.s * payoutPool) / To) / 1e18 : 0;
      return { ...r, win };
    });
  if (!rows.length) return null;
  return (
    <div className="glass mb-6 overflow-hidden rounded-2xl">
      <div className="border-b border-black/5 p-6 pb-4 dark:border-white/5">
        <h2 className="font-display text-lg font-extrabold">Your position</h2>
      </div>
      <div className="divide-y divide-black/5 dark:divide-white/5">
        {rows.map((r) => {
          const teamId = outcomeTeamId(market, r.i, fixtures);
          return (
            <div key={r.i} className="flex items-center gap-3 p-4 sm:px-6">
              {teamId !== null ? (
                <TeamBadge teamId={teamId} size={32} showName={false} />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2E7CF6]/10 font-display text-xs font-extrabold text-[#2E7CF6]">
                  {r.i + 1}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{outcomeLabels[r.i]}</div>
                <div className="text-xs text-zinc-500">{formatTick(r.s)} TICK staked</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Wins →</div>
                <div className="font-display text-base font-extrabold tabular-nums text-emerald-500">
                  {formatTick(BigInt(Math.round(r.win * 1e18)))} TICK
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="px-6 py-3 text-[11px] text-zinc-400">
        Est. payout if this outcome wins — final amounts are settled on-chain (94% of stakes + full seed, split pro-rata).
      </p>
    </div>
  );
}

// ── stake modal ─────────────────────────────────────────────────────

const QUICK_AMOUNTS = [25, 100, 250, 1000];

/** Shared chip styling for the quick-amount row. */
function quickChipClass(active: boolean): string {
  return cn(
    "flex-1 rounded-lg border py-1 text-sm font-extrabold transition-all active:scale-95",
    active
      ? "border-[#2E7CF6] bg-[#2E7CF6]/10 text-[#2E7CF6]"
      : "border-black/10 text-zinc-600 hover:border-black/25 dark:border-white/10 dark:text-zinc-300 dark:hover:border-white/25"
  );
}

function StakeModal({
  market,
  outcomeTotals,
  outcomeLabels,
  teams,
  fixtures,
  outcome,
  amount,
  onAmountChange,
  balance,
  address,
  bettingOpen,
  busy,
  onClose,
  onConfirm,
}: {
  market: MarketDetail;
  outcomeTotals: bigint[];
  outcomeLabels: string[];
  teams: TeamRef[];
  fixtures: Map<string, ApiFixture>;
  outcome: number | null;
  amount: string;
  onAmountChange: (a: string) => void;
  balance: bigint | null;
  address: string | null;
  bettingOpen: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(r);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (outcome === null) return null;

  const stakedTotal = outcomeTotals.reduce((s, v) => s + v, 0n);
  const amountNum = Number(amount) || 0;
  const { win, multiple } = potentialWin(amountNum, outcome, outcomeTotals, market.totalStaked, market.seedAmount);
  const valid = amountNum >= FACTORY_MIN_STAKE_TICK && (balance === null || BigInt(Math.round(amountNum * 1e18)) <= balance);
  const label = outcomeLabels[outcome] ?? `Outcome ${outcome}`;
  const balanceTick = balance !== null ? Number(balance) / 1e18 : 0;
  const question = describeMarket(market, teams, fixtures);

  const selectedShare = stakedTotal > 0n ? Number(((outcomeTotals[outcome] ?? 0n) * 10_000n) / stakedTotal) / 100 : 0;
  const selectedTeamId = outcomeTeamId(market, outcome, fixtures);

  return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className={cn(
          "absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300",
          mounted ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-[1.5rem] border border-black/10 bg-white p-4 text-zinc-900 shadow-[0_28px_100px_rgba(0,0,0,.45)] transition-all duration-300 dark:border-white/10 dark:bg-[#101722] dark:text-white sm:p-5",
          mounted ? "translate-y-0 opacity-100 scale-100" : "translate-y-4 opacity-0 scale-95"
        )}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-200"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="pr-8">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">You're predicting</div>
          <div className="mt-1 font-display text-base font-extrabold leading-snug text-zinc-900 dark:text-white sm:text-lg">
            {question}
          </div>
        </div>

        {!bettingOpen ? (
          <p className="mt-6 rounded-xl bg-amber-500/[.07] px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
            Betting is closed for this market.
          </p>
        ) : !address ? (
          <p className="mt-6 rounded-xl bg-amber-500/[.07] px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
            Connect your wallet to stake on this market.
          </p>
        ) : (
          <>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-[#2E7CF6]/30 bg-[#2E7CF6]/10 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                {selectedTeamId !== null && <TeamBadge teamId={selectedTeamId} size={34} showName={false} />}
                <div className="min-w-0"><div className="truncate font-display text-base font-extrabold">{label}</div><div className="text-xs text-zinc-500 dark:text-white/50">Current implied odds</div></div>
              </div>
              <div className="ml-3 font-display text-2xl font-black tabular-nums text-[#1D4ED8] dark:text-[#75aaff]">{selectedShare.toFixed(1)}%</div>
            </div>
            <button onClick={onClose} className="mt-1 text-xs font-bold text-[#1D4ED8] hover:underline dark:text-[#75aaff]">Choose a different outcome</button>

            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Amount</label>
              </div>
              <div className="flex items-center rounded-xl border border-black/10 bg-black/[.03] px-3 py-1.5 focus-within:border-[#2E7CF6]/60 dark:border-white/10 dark:bg-white/[.04]">
                <input
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => onAmountChange(e.target.value)}
                  placeholder="0"
                  className="w-full bg-transparent font-display text-2xl font-black tabular-nums text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-white dark:placeholder:text-white/25"
                />
                <span className="ml-2 shrink-0 font-display text-sm font-extrabold text-zinc-500 dark:text-zinc-400">TICK</span>
              </div>
              <div className="mt-2 flex gap-2">
                {QUICK_AMOUNTS.map((q) => (
                  <button
                    key={q}
                    onClick={() => onAmountChange(String(q))}
                    className={quickChipClass(amountNum === q)}
                  >
                    {q >= 1000 ? `${q / 1000}K` : q}
                  </button>
                ))}
                <button
                  onClick={() => onAmountChange(String(Math.floor(balanceTick)))}
                  disabled={balanceTick <= 0}
                  title={balanceTick <= 0 ? "No TICK balance" : "Stake your full balance"}
                  className={cn(quickChipClass(amountNum > 0 && amountNum === Math.floor(balanceTick)), "disabled:opacity-40")}
                >
                  MAX
                </button>
              </div>
              <div className="mt-2 flex justify-between text-xs text-zinc-500 dark:text-white/45">
                <span>Balance {balance !== null ? formatTick(balance) : "…"} TICK</span>
                <span>Minimum {FACTORY_MIN_STAKE_TICK} TICK</span>
              </div>
            </div>

            {/* Potential win */}
            <div className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-black/[.025] p-3 dark:border-white/10 dark:bg-white/[.04]">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                Potential win <span className="normal-case tracking-normal">— if {label} wins</span>
              </div>
              <div className="mt-0.5 font-display text-3xl font-black tabular-nums text-zinc-900 dark:text-white">
                {win > 0 ? formatTick(BigInt(Math.round(win * 1e18))) : "—"}
                <span className="ml-1 text-base font-extrabold text-zinc-500">TICK</span>
              </div>
              {win > 0 && (
                <div className="mt-1 text-sm font-extrabold text-emerald-500">
                  +{((multiple - 1) * 100).toFixed(0)}% · {multiple.toFixed(2)}× your stake
                </div>
              )}
            </div>

              <button
              onClick={onConfirm}
              disabled={busy || !valid || amountNum <= 0}
              className="gradient-cta mt-3 w-full rounded-xl py-3 font-display text-base font-extrabold text-white shadow-[0_0_20px_rgba(46,124,246,0.35)] transition-all hover:shadow-[0_0_30px_rgba(46,124,246,0.5)] active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
            >
              {busy ? "Confirm in wallet…" : `Stake ${amountNum || 0} TICK on ${label}`}
            </button>
            {amount !== "" && amountNum < FACTORY_MIN_STAKE_TICK && (
              <p className="mt-2 text-center text-xs font-bold text-red-500">
                Minimum stake is {FACTORY_MIN_STAKE_TICK} TICK.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── how this resolves ───────────────────────────────────────────────

function HowThisResolves({ market, teams }: { market: MarketDetail; teams: TeamRef[] }) {
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const voidChallengeActive = market.voidInitiatedAt > 0n;
  const voidFinalizeAt = voidChallengeActive ? Number(market.voidInitiatedAt) + VOID_CHALLENGE_WINDOW_SECONDS : 0;
  const canFinalizeVoid = voidChallengeActive && nowSec >= voidFinalizeAt;
  const publicClient = getPublicClient();
  const [table, setTable] = useState<null | {
    teams: number[];
    priceStart: bigint[];
    priceEnd: bigint[];
    gainBps: bigint[];
    valid: boolean[];
  }>(null);

  useEffect(() => {
    if (!publicClient || !MARKET_FACTORY_ADDRESS || market.templateId !== TEMPLATES.TOP_GAINER) return;
    let alive = true;
    publicClient
      .readContract({
        address: MARKET_FACTORY_ADDRESS,
        abi: MARKET_FACTORY_ABI,
        functionName: "getTopGainerTable",
        args: [market.id],
      })
      .then((r: any) => {
        if (!alive) return;
        const raw = r as any;
        const teams = (raw.teams ?? raw[0]) as number[] | undefined;
        const priceStart = (raw.priceStart ?? raw[1]) as bigint[] | undefined;
        const priceEnd = (raw.priceEnd ?? raw[2]) as bigint[] | undefined;
        const gainBps = (raw.gainBps ?? raw[3]) as bigint[] | undefined;
        const valid = (raw.valid ?? raw[4]) as boolean[] | undefined;
        if (!teams || !priceStart || !priceEnd || !gainBps || !valid) return;
        setTable({ teams, priceStart, priceEnd, gainBps, valid });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [publicClient, market.id, market.templateId]);

  const ruleText = useMemo(() => {
    const t = market.templateId;
    if (t === TEMPLATES.TOP_GAINER) {
      try {
        const [, md] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), market.params);
        return `Winner = the coin with the highest % price gain over matchday ${Number(md) + 1}'s window, measured from the oracle's hourly checkpoints at the window edges. Ties split the pool. Anyone can recompute the winner from the live table below — no votes, no judges.`;
      } catch {
        return TEMPLATE_DESCRIPTIONS[t];
      }
    }
    if (t === TEMPLATES.CHAMPION)
      return "Winner = the coin with the most league points when the season completes (all 380 fixtures settled), then goal difference. Resolves only via the on-chain league table.";
    if (t === TEMPLATES.H2H)
      return "Winner = whichever coin gained more (%) between the two checkpoint timestamps. An exact tie splits the pool between both outcomes.";
    if (t === TEMPLATES.TARGET)
      return "Yes wins if the coin's oracle checkpoint price at the target time is ≥ (or ≤) the target. One checkpoint, one comparison, no ambiguity.";
    return "Yes wins if (home rounded % − away rounded %) is strictly greater than the spread, using the fixture's on-chain start/end prices and the same rounding the league uses. Otherwise No wins.";
  }, [market]);

  return (
    <div className="glass mb-6 rounded-2xl p-6 lg:mb-0">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold">
        <Info className="h-4 w-4 text-[#2E7CF6]" />
        How this resolves
      </h2>
      <p className="mb-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{ruleText}</p>

      {market.templateId === TEMPLATES.TOP_GAINER && table && (
        <div className="overflow-hidden rounded-xl border border-black/5 dark:border-white/5">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-black/5 text-left text-zinc-500 dark:bg-white/5">
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 text-right font-medium">Gain</th>
              </tr>
            </thead>
            <tbody>
              {table.teams
                .map((teamId, i) => ({
                  teamId,
                  gainBps: table.gainBps[i],
                  valid: table.valid[i],
                  symbol: teamSymbol(teams, teamId),
                }))
                .sort((a, b) => Number(b.gainBps - a.gainBps))
                .slice(0, 8)
                .map((row) => (
                  <tr key={row.teamId} className="border-t border-black/5 dark:border-white/5">
                    <td className="px-3 py-1.5 font-medium">{row.symbol}</td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right tabular-nums",
                        !row.valid && "text-zinc-400",
                        row.valid && row.gainBps >= 0n && "text-emerald-600 dark:text-emerald-400",
                        row.valid && row.gainBps < 0n && "text-red-500"
                      )}
                    >
                      {row.valid ? `${(Number(row.gainBps) / 100).toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-zinc-400">
            Live resolving data — checkpoints update hourly. Top 8 shown.
          </p>
        </div>
      )}

      <div className="mt-4 border-t border-black/5 pt-3 text-xs text-zinc-500 dark:border-white/5">
        <div className="flex justify-between py-0.5">
          <span>Betting closes</span>
          <span className="tabular-nums">
            {market.templateId === TEMPLATES.SPREAD
              ? "5 min before match end"
              : new Date(Number(market.bettingCloseTime) * 1000).toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between py-0.5">
          <span>Resolvable after</span>
          <span className="tabular-nums">{new Date(Number(market.endTime) * 1000).toLocaleString()}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span>Voidable after</span>
          <span className="tabular-nums">{new Date(Number(market.voidAfter) * 1000).toLocaleString()}</span>
        </div>
        {voidChallengeActive && (
          <div className="flex justify-between py-0.5 font-semibold text-amber-600 dark:text-amber-400">
            <span>Void challenge</span>
            <span className="tabular-nums">
              {canFinalizeVoid ? "ready to finalize" : <>ends {new Date(voidFinalizeAt * 1000).toLocaleString()}</>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── similar markets ─────────────────────────────────────────────────

function SimilarMarkets({
  currentId,
  templateId,
  teams,
  fixtures,
}: {
  currentId: bigint;
  templateId: number;
  teams: TeamRef[];
  fixtures: Map<string, ApiFixture>;
}) {
  const publicClient = getPublicClient();
  const [items, setItems] = useState<null | {
    id: bigint;
    templateId: number;
    params: `0x${string}`;
    outcomeCount: number;
    poolWei: bigint;
    bettingCloseTime: bigint;
    state: number;
  }[]>(null);

  useEffect(() => {
    if (!MARKET_FACTORY_ADDRESS) return;
    let alive = true;
    (async () => {
      try {
        const count = Number(
          (await publicClient.readContract({
            address: MARKET_FACTORY_ADDRESS,
            abi: MARKET_FACTORY_ABI,
            functionName: "marketCount",
          })) as bigint
        );
        const ids = Array.from({ length: count }, (_, i) => BigInt(i)).filter((i) => i !== currentId);
        if (!ids.length) {
          if (alive) setItems([]);
          return;
        }
        const calls = ids.flatMap((i) => [
          { address: MARKET_FACTORY_ADDRESS, abi: MARKET_FACTORY_ABI, functionName: "marketInfo", args: [i] } as const,
          { address: MARKET_FACTORY_ADDRESS, abi: MARKET_FACTORY_ABI, functionName: "marketSettlement", args: [i] } as const,
        ]);
        const res = await publicClient.multicall({ contracts: calls });
        const list: NonNullable<typeof items> = [];
        for (let k = 0; k < ids.length; k++) {
          const infoR = res[k * 2];
          const setR = res[k * 2 + 1];
          if (infoR.status !== "success" || setR.status !== "success") continue;
          try {
            const info = normalizeMarketInfo(infoR.result);
            const s = normalizeMarketSettlement(setR.result);
            if (info.templateId !== templateId) continue;
            list.push({
              id: ids[k],
              templateId: info.templateId,
              params: info.params,
              outcomeCount: info.outcomeCount,
              poolWei: s.totalStaked + s.seedAmount,
              bettingCloseTime: info.bettingCloseTime,
              state: s.state,
            });
          } catch {
            /* skip malformed */
          }
        }
        list.sort((a, b) => (b.poolWei > a.poolWei ? 1 : b.poolWei < a.poolWei ? -1 : 0));
        if (alive) setItems(list.slice(0, 3));
      } catch {
        if (alive) setItems([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [publicClient, currentId, templateId]);

  if (!items?.length) return null;
  const style = TEMPLATE_STYLE[templateId] ?? TEMPLATE_STYLE[TEMPLATES.TOP_GAINER];

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl font-black">Similar markets</h2>
        <Link href="/markets" className="flex items-center gap-1 text-sm font-bold text-[#2E7CF6] hover:underline">
          View all <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {items.map((m) => (
          <Link
            key={m.id.toString()}
            href={`/markets/${m.id}`}
            className="glass group rounded-2xl p-5 transition-all hover:-translate-y-1 hover:shadow-[0_12px_36px_rgba(46,124,246,0.18)]"
          >
            <div className="flex items-center justify-between">
              <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em]", style.chip)}>
                <style.icon className="h-3 w-3" />
                {TEMPLATE_NAMES[m.templateId] ?? "Market"}
              </span>
              <span className="text-[11px] font-bold text-zinc-500">
                {m.state === 0 ? <Countdown target={Number(m.bettingCloseTime) * 1000} /> : m.state === 1 ? "Resolved" : "Void"}
              </span>
            </div>
            <div className="mt-3 line-clamp-2 min-h-[3rem] font-display text-base font-extrabold leading-snug text-zinc-900 transition-colors group-hover:text-[#2E7CF6] dark:text-white">
              {describeMarket(m, teams, fixtures)}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
              <span className="font-display font-extrabold tabular-nums text-zinc-700 dark:text-zinc-200">
                {formatTick(m.poolWei)} TICK
              </span>
              <span className="flex items-center gap-1 font-bold text-[#2E7CF6] opacity-0 transition-opacity group-hover:opacity-100">
                Predict <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

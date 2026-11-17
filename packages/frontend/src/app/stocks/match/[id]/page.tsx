/**
 * Stock match page.
 *
 * Target location in the repo:
 *   packages/frontend/src/app/stocks/match/[id]/page.tsx
 *
 * Mirrors the crypto match page (spec P3.6 to P3.8): pre-match staking,
 * live % bars, post-match result plus claim. State derives from the
 * fixture (backend) merged with live WebSocket updates, plus the
 * StockPriceOracle kickoff snapshot on-chain.
 *
 * Stock differences, all locked:
 *   - Contracts: STOCK_CONTRACTS, STOCK_PREDICTION_POOL_ABI,
 *     STOCK_PRICE_ORACLE_ABI, STOCK_MATCH_REGISTRY_ABI, STOCK_SEASON_ID.
 *   - Scoring: 1 goal = 0.05% (5 bps), integer basis point math, max 10 goals,
 *     no-negative scorelines, via stockFormat.ts. The live board and the
 *     final board both use stockScoreline, never the crypto 0.5% helper.
 *   - Window: 1 hour from stockMatchConfig.ts (60 min fallback, never
 *     the stale 45-minute shared constant). Betting closes 5 minutes
 *     before full time, same as crypto.
 *   - Feed: Chainlink NAV via the stock oracle. A stale NAV blocks the
 *     snapshot, and the audit card says so plainly.
 *   - Forfeit: a settled forfeit shows 3-0 with a FORFEIT pill and the
 *     forfeiting side named. A void shows VOID and notes stakes are
 *     refunded. Both are settled states, claims follow the pool result.
 *   - Stake and claim panels are inline here as StockStakePanel and
 *     StockPostMatchPanel. The crypto StakePanel and PostMatchPanel are
 *     bound to the crypto pool and season, so they cannot be reused
 *     without edits. When the team extracts a shared panel, these two
 *     inline panels are the stock spec to copy from.
 *   - OracleAuditCard does not exist in the repo at origin/main bad5ca6,
 *     so the audit box is inline here as StockAuditCard. It shows the
 *     kickoff and full time NAV values, the feed name, and the stale
 *     state. Do not claim an audit card exists elsewhere.
 *
 * League switcher: All / Crypto / Stocks pills at the top link to the
 * matching fixtures views, same control as standings and fixtures.
 *
 * Prices: the single shared WebSocket in useLiveFeed supplies live
 * prices. No second /api/prices poll is added here.
 *
 * All timestamps are UTC.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Trophy, Wallet } from "lucide-react";
import type { Address } from "viem";
import { PLATFORM_FEE_BPS } from "@tickr/shared/constants";
import {
  STOCK_CONTRACTS,
  STOCK_PREDICTION_POOL_ABI,
  STOCK_PRICE_ORACLE_ABI,
  STOCK_MATCH_REGISTRY_ABI,
  STOCK_SEASON_ID,
  stockGlobalFixtureId,
  stockApi,
  type StockApiFixture,
  type StockApiPool,
} from "../../../../lib/stockContracts";
import { TICK_TOKEN_ABI, MIN_STAKE_TICK } from "../../../../lib/contracts";
import { STOCK_MATCH_MS, stockBettingCloseMs, stockMatchEndMs } from "../../../../lib/stockMatchConfig";
import {
  formatSignedPctStock,
  formatUtcDateTime,
  forfeitScoreline,
  stockScoreline,
} from "../../../../lib/stockFormat";
import { formatTick, isoToMs, parseTickInput, OUTCOME_LABELS, OUTCOME_SHORT } from "../../../../lib/format";
import { useTickr } from "../../../../hooks/useTickr";
import { useTickBalance } from "../../../../hooks/useTickBalance";
import { useStockLiveFeed } from "../../../../hooks/useStockLiveFeed";
import { getPublicClient } from "../../../../hooks/usePublicClient";
import { useContractWrite } from "../../../../hooks/useContractWrite";
import { stockFixtureStatus, type StockFixtureStatus } from "../../../../components/StockFixtureCard";
import { StockTeamBadge } from "../../../../components/StockLeagueTable";
import { StockScoringExplainer } from "../../../../components/StockScoringExplainer";
import { PoolBars } from "../../../../components/PoolBars";
import { Countdown } from "../../../../components/Countdown";
import { SectionTitle, LoadingState, ErrorState, EmptyState } from "../../../../components/States";
import { cn } from "../../../../lib/cn";

export interface StockFullSnapshot {
  homeStart: bigint;
  awayStart: bigint;
  homeEnd: bigint;
  awayEnd: bigint;
  endSubmitted: boolean;
}

function pctOf(start: bigint, end: bigint): number | null {
  if (start <= 0n || end <= 0n) return null;
  const s = Number(start) / 10 ** 8;
  const e = Number(end) / 10 ** 8;
  if (s <= 0) return null;
  return ((e - s) / s) * 100;
}

/* ── Stock stake panel (inline, stock pool only) ─────────────────────── */

function StockStakePanel({
  fixture,
  pool,
  playerAddress,
  balance,
  authenticated,
  onLogin,
  onStaked,
}: {
  fixture: StockApiFixture;
  pool: StockApiPool | null;
  playerAddress: Address | null;
  balance: bigint | null;
  authenticated: boolean;
  onLogin: () => void;
  onStaked: () => void;
}) {
  const [outcome, setOutcome] = useState<number>(0);
  const [amountStr, setAmountStr] = useState("10");
  const [step, setStep] = useState<"idle" | "approving" | "staking" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const { write } = useContractWrite();
  const fixtureId = BigInt(fixture.fixtureId);
  const amount = useMemo(() => parseTickInput(amountStr), [amountStr]);

  useEffect(() => {
    let alive = true;
    if (!playerAddress || !STOCK_CONTRACTS.tickToken || !STOCK_CONTRACTS.predictionPool) {
      setAllowance(null);
      return;
    }
    getPublicClient()
      .readContract({
        address: STOCK_CONTRACTS.tickToken,
        abi: TICK_TOKEN_ABI,
        functionName: "allowance",
        args: [playerAddress, STOCK_CONTRACTS.predictionPool],
      })
      .then((v) => {
        if (alive) setAllowance(v as bigint);
      })
      .catch(() => {
        if (alive) setAllowance(null);
      });
    return () => {
      alive = false;
    };
  }, [playerAddress, step]);

  const totals = pool
    ? [BigInt(pool.totalHome), BigInt(pool.totalDraw), BigInt(pool.totalAway)]
    : [0n, 0n, 0n];
  const seed = pool ? BigInt(pool.seed ?? "0") : 0n;
  const totalPool = (pool ? BigInt(pool.totalPool) : 0n) + seed;
  const estimatedPayout = useMemo(() => {
    if (!amount || totalPool < 0n) return null;
    const w = totals[outcome];
    const distributable = ((totalPool + amount) * BigInt(10_000 - PLATFORM_FEE_BPS)) / 10_000n;
    return (amount * distributable) / (w + amount);
  }, [amount, outcome, totals, totalPool]);

  const needsApproval = amount !== null && (allowance === null || allowance < amount);
  const balanceOk = amount !== null && balance !== null && balance >= amount;
  const busy = step === "approving" || step === "staking";

  const handleStake = async () => {
    setError(null);
    if (!playerAddress) {
      setError("Connect your wallet first.");
      return;
    }
    if (!STOCK_CONTRACTS.tickToken || !STOCK_CONTRACTS.predictionPool) {
      setError("Stock contract addresses not configured, fill in .env.local.");
      return;
    }
    if (!amount) {
      setError("Enter a valid stake amount.");
      return;
    }
    if (amount < BigInt(MIN_STAKE_TICK) * 10n ** 18n) {
      setError(`Minimum stake is ${MIN_STAKE_TICK} TICK.`);
      return;
    }
    if (!balanceOk) {
      setError("Insufficient TICK balance, use the faucet in the header.");
      return;
    }
    try {
      if (needsApproval) {
        setStep("approving");
        await write({
          to: STOCK_CONTRACTS.tickToken,
          abi: TICK_TOKEN_ABI,
          functionName: "approve",
          args: [STOCK_CONTRACTS.predictionPool, amount],
          label: "TICK approval",
        });
      }
      setStep("staking");
      await write({
        to: STOCK_CONTRACTS.predictionPool,
        abi: STOCK_PREDICTION_POOL_ABI,
        functionName: "stake",
        args: [STOCK_SEASON_ID, fixtureId, outcome, amount],
        label: "Stake",
      });
      setStep("done");
      onStaked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("idle");
    }
  };

  if (!authenticated) {
    return (
      <div className="glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
        <Wallet className="h-8 w-8 text-zinc-400 dark:text-zinc-600" />
        <p className="font-display font-semibold text-zinc-800 dark:text-zinc-200">
          Sign in to stake on this stock match
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Privy login is gasless, your smart wallet covers transaction fees.
        </p>
        <button
          onClick={onLogin}
          className="rounded-xl bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] px-6 py-2.5 text-sm font-bold text-white shadow-[0_0_20px_rgba(46,124,246,.4)] transition-all hover:shadow-[0_0_28px_rgba(46,124,246,.55)] active:scale-[.97]"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="mb-4 font-display text-base font-bold text-zinc-900 dark:text-white">
        Place your stake
      </h3>
      {fixture.home && fixture.away && (
        <div className="mb-4 grid grid-cols-3 gap-2">
          {[
            { label: OUTCOME_SHORT[0], sub: fixture.home.name, o: 0 },
            { label: OUTCOME_SHORT[1], sub: OUTCOME_LABELS[1], o: 1 },
            { label: OUTCOME_SHORT[2], sub: fixture.away.name, o: 2 },
          ].map((opt) => (
            <button
              key={opt.o}
              onClick={() => setOutcome(opt.o)}
              disabled={busy}
              className={cn(
                "rounded-xl border-2 px-2 py-3 text-center transition-all active:scale-[.97]",
                outcome === opt.o
                  ? "border-[#2E7CF6] bg-[#2E7CF6]/12 text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]"
                  : "border-black/10 bg-black/[.02] text-zinc-500 hover:border-[#2E7CF6]/40 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-400"
              )}
            >
              <div className="font-display text-xl font-bold">{opt.label}</div>
              <div className="truncate text-[11px] opacity-80">{opt.sub}</div>
            </button>
          ))}
        </div>
      )}
      {pool && (
        <div className="mb-4">
          <PoolBars pool={pool} compact />
          <p className="mt-2 font-display text-xs tabular-nums text-zinc-500 dark:text-zinc-500">
            Pool total: {formatTick(totalPool)} TICK, includes {formatTick(seed)} TICK seeded liquidity, {PLATFORM_FEE_BPS / 100}% platform fee
          </p>
        </div>
      )}
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Amount (TICK), min {MIN_STAKE_TICK}
      </label>
      <div className="flex gap-2">
        <input
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          inputMode="decimal"
          disabled={busy}
          className="w-full rounded-xl border border-black/10 bg-black/[.03] px-3 py-2.5 font-display tabular-nums text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-[#2E7CF6] focus:ring-2 focus:ring-[#2E7CF6]/40 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-zinc-600"
          placeholder="10"
        />
        {["10", "50", "100"].map((q) => (
          <button
            key={q}
            onClick={() => setAmountStr(q)}
            disabled={busy}
            className="rounded-xl border border-black/10 px-3 text-sm font-semibold text-zinc-600 transition-all hover:border-[#2E7CF6]/60 hover:text-[#1D4ED8] active:scale-95 dark:border-white/10 dark:text-zinc-300"
          >
            {q}
          </button>
        ))}
        <button
          onClick={() => setAmountStr(balance !== null ? String(balance / 10n ** 18n) : "0")}
          disabled={busy}
          className="rounded-xl border border-black/10 px-3 text-sm font-semibold text-zinc-600 transition-all hover:border-[#2E7CF6]/60 hover:text-[#1D4ED8] active:scale-95 dark:border-white/10 dark:text-zinc-300"
        >
          MAX
        </button>
      </div>
      <p className="mt-1 font-display text-xs tabular-nums text-zinc-500 dark:text-zinc-500">
        Balance: {balance === null ? "–" : `${formatTick(balance)} TICK`}
      </p>
      {estimatedPayout !== null && amount !== null && (
        <div className="mt-3 rounded-xl border border-[#2E7CF6]/20 bg-[#2E7CF6]/6 p-3 text-sm dark:bg-[#2E7CF6]/8">
          <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
            <span>Est. payout if {OUTCOME_LABELS[outcome].toLowerCase()} wins</span>
            <span className="font-display font-bold tabular-nums text-[#1D4ED8] dark:text-[#7fe0bd]">
              {formatTick(estimatedPayout)} TICK
            </span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-600">
            Estimate only, final odds move as others stake. Winners split the pool minus fee.
          </p>
        </div>
      )}
      {step === "done" && (
        <p className="mt-3 rounded-xl bg-[#1D9E75]/12 p-3 text-sm font-medium text-[#0f7a55] dark:bg-[#1D9E75]/15 dark:text-[#7fe0bd]">
          Stake placed, good luck! Pool totals update live below.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
      <button
        onClick={handleStake}
        disabled={busy || amount === null || !balanceOk}
        className={cn(
          "mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-all active:scale-[.98]",
          busy || amount === null || !balanceOk
            ? "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
            : "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_24px_rgba(46,124,246,.45)] hover:shadow-[0_0_36px_rgba(46,124,246,.6)]"
        )}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {step === "approving" ? "Approving TICK…" : step === "staking" ? "Staking…" : `Stake ${amount ? formatTick(amount, 0) : ""} TICK`}
      </button>
      <p className="mt-2 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
        Gasless, sent from your smart wallet, sponsored by TICKR.
      </p>
    </div>
  );
}

/* ── Stock audit card (inline, OracleAuditCard does not exist in repo) ── */

function StockAuditCard({
  fixture,
  snapshot,
}: {
  fixture: StockApiFixture;
  snapshot: StockFullSnapshot | null;
}) {
  const fmtNav = (v: bigint) => `$${(Number(v) / 10 ** 8).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
        Price audit, Chainlink NAV
      </h3>
      {!snapshot ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Kickoff snapshot not yet on-chain. Bars appear once the backend submits start NAV values. A stale NAV blocks the snapshot, it never settles on a stale price.
        </p>
      ) : (
        <dl className="space-y-2 text-sm tabular-nums">
          <div className="flex justify-between">
            <dt className="text-zinc-500">{fixture.home?.name} at kickoff</dt>
            <dd className="font-semibold text-zinc-900 dark:text-white">{fmtNav(snapshot.homeStart)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">{fixture.away?.name} at kickoff</dt>
            <dd className="font-semibold text-zinc-900 dark:text-white">{fmtNav(snapshot.awayStart)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">{fixture.home?.name} at full time</dt>
            <dd className="font-semibold text-zinc-900 dark:text-white">
              {snapshot.endSubmitted ? fmtNav(snapshot.homeEnd) : "pending"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">{fixture.away?.name} at full time</dt>
            <dd className="font-semibold text-zinc-900 dark:text-white">
              {snapshot.endSubmitted ? fmtNav(snapshot.awayEnd) : "pending"}
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        Feed: Chainlink NAV, 1 goal = 0.05%, 1-hour window, max 10 goals, 3% volatile cap.
      </p>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function StockMatchPage() {
  const params = useParams();
  const id = params.id as string;
  const { authenticated, login, playerAddress } = useTickr();
  const { balance, refresh: refreshBalance } = useTickBalance(playerAddress);
  const { prices, fixtureUpdates } = useStockLiveFeed(true);

  const [fixture, setFixture] = useState<StockApiFixture | null>(null);
  const [pool, setPool] = useState<StockApiPool | null>(null);
  const [snapshot, setSnapshot] = useState<StockFullSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [bettingCloseMs, setBettingCloseMs] = useState<number | null>(null);
  const [matchEndMs, setMatchEndMs] = useState<number | null>(null);
  const [bettingOpen, setBettingOpen] = useState(false);
  const [stakes, setStakes] = useState<[bigint, bigint, bigint] | null>(null);
  const [claimed, setClaimed] = useState<boolean | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const { write } = useContractWrite();

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
      const raw = onChainFixture as unknown as { kickoffTimestamp?: bigint; matchEndTimestamp?: bigint } & Record<number, bigint>;
      const kickoff = (raw.kickoffTimestamp ?? raw[5] ?? 0n) as bigint;
      const matchEnd = (raw.matchEndTimestamp ?? raw[7] ?? 0n) as bigint;
      setMatchEndMs(
        stockMatchEndMs(
          kickoff > 0n ? Number(kickoff) * 1000 : null,
          matchEnd > 0n ? Number(matchEnd) * 1000 : null
        )
      );
      const end = stockMatchEndMs(
        kickoff > 0n ? Number(kickoff) * 1000 : null,
        matchEnd > 0n ? Number(matchEnd) * 1000 : null
      );
      setBettingCloseMs(stockBettingCloseMs(end));
    } catch {
      setBettingOpen(false);
      setBettingCloseMs(null);
      setMatchEndMs(null);
    }
  }, [id]);

  const loadPool = useCallback(async () => {
    try {
      setPool(await stockApi.pool(id));
    } catch {
      /* pool may 404 before first stake, non-fatal */
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
      /* oracle read failed, panels degrade gracefully */
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
    if (status === "settled" || status === "forfeit" || status === "voided") return;
    const t = setInterval(loadPool, 8_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture, fixtureUpdates[id], loadPool]);

  useEffect(() => {
    if (!fixture || !STOCK_CONTRACTS.predictionPool || !playerAddress) return;
    if (stockFixtureStatus(fixture, fixtureUpdates[id]) !== "settled" &&
        stockFixtureStatus(fixture, fixtureUpdates[id]) !== "forfeit") return;
    const client = getPublicClient();
    const fixtureId = BigInt(fixture.fixtureId);
    const contracts = [0, 1, 2].map((o) => ({
      address: STOCK_CONTRACTS.predictionPool as Address,
      abi: STOCK_PREDICTION_POOL_ABI,
      functionName: "getStake" as const,
      args: [STOCK_SEASON_ID, fixtureId, playerAddress, o] as const,
    }));
    let alive = true;
    Promise.all([
      client.multicall({ contracts }),
      client.readContract({
        address: STOCK_CONTRACTS.predictionPool as Address,
        abi: STOCK_PREDICTION_POOL_ABI,
        functionName: "claimed",
        args: [stockGlobalFixtureId(STOCK_SEASON_ID, fixtureId), playerAddress],
      }),
    ])
      .then(([stakeRes, claimedRes]) => {
        if (!alive) return;
        setStakes([
          (stakeRes[0].result ?? 0n) as bigint,
          (stakeRes[1].result ?? 0n) as bigint,
          (stakeRes[2].result ?? 0n) as bigint,
        ]);
        setClaimed(claimedRes as boolean);
      })
      .catch(() => {
        if (alive) {
          setStakes(null);
          setClaimed(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [fixture, fixtureUpdates[id], playerAddress]);

  const handleStaked = useCallback(() => {
    loadPool();
    refreshBalance();
  }, [loadPool, refreshBalance]);

  const handleClaim = async () => {
    setClaimError(null);
    if (!STOCK_CONTRACTS.predictionPool) {
      setClaimError("Stock contract addresses not configured.");
      return;
    }
    setClaimBusy(true);
    try {
      await write({
        to: STOCK_CONTRACTS.predictionPool,
        abi: STOCK_PREDICTION_POOL_ABI,
        functionName: "claim",
        args: [STOCK_SEASON_ID, BigInt(id)],
        label: "Claim payout",
      });
      setClaimed(true);
      handleStaked();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setClaimError(
        msg.includes("NothingToClaim")
          ? "Nothing to claim on this match."
          : msg.includes("AlreadyClaimed")
            ? "Already claimed."
            : msg
      );
    } finally {
      setClaimBusy(false);
    }
  };

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
        <Link href="/stocks/fixtures" className="font-semibold text-[#1D4ED8] hover:underline dark:text-[#7db3ff]">
          Back to stock fixtures
        </Link>
      </EmptyState>
    );
  }

  const liveUpdate = fixtureUpdates[id];
  const rawKickoffMs = liveUpdate?.kickoffMs ?? isoToMs(fixture.kickoff);
  const kickoffMs = rawKickoffMs && rawKickoffMs > 0 ? rawKickoffMs : null;
  const effectiveMatchEndMs = matchEndMs ?? (kickoffMs !== null ? kickoffMs + STOCK_MATCH_MS : null);
  const baseStatus: StockFixtureStatus = stockFixtureStatus(fixture, liveUpdate);
  const status: StockFixtureStatus =
    baseStatus === "settled" || baseStatus === "forfeit" || baseStatus === "voided"
      ? baseStatus
      : kickoffMs !== null && now >= kickoffMs
        ? effectiveMatchEndMs !== null && now <= effectiveMatchEndMs
          ? "live"
          : "awaiting"
        : baseStatus;
  const effectiveBettingCloseMs = bettingCloseMs ?? stockBettingCloseMs(effectiveMatchEndMs);
  const winning = pool?.winningOutcome ?? null;
  const hasStake = stakes !== null && stakes.some((s) => s > 0n);
  const won = winning !== null && stakes !== null && stakes[winning] > 0n;

  const homePctLive =
    snapshot && prices[fixture.home.teamId]?.price
      ? ((Number(prices[fixture.home.teamId].price) - Number(snapshot.homeStart) / 10 ** 8) /
          (Number(snapshot.homeStart) / 10 ** 8)) * 100
      : null;
  const awayPctLive =
    snapshot && prices[fixture.away.teamId]?.price
      ? ((Number(prices[fixture.away.teamId].price) - Number(snapshot.awayStart) / 10 ** 8) /
          (Number(snapshot.awayStart) / 10 ** 8)) * 100
      : null;
  const liveScore =
    homePctLive !== null && awayPctLive !== null
      ? stockScoreline(homePctLive, awayPctLive)
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

  return (
    <div>
      <Link
        href="/stocks/fixtures"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-[#1D4ED8] dark:text-zinc-400 dark:hover:text-[#7db3ff]"
      >
        <ArrowLeft className="h-4 w-4" /> Stock fixtures
      </Link>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { label: "All", href: "/stocks/fixtures" },
          { label: "Crypto", href: "/fixtures" },
          { label: "Stocks", href: "/stocks/fixtures" },
        ].map((p) => (
          <Link
            key={p.label}
            href={p.href}
            className={cn(
              "rounded-xl px-4 py-1.5 text-sm font-semibold",
              p.label === "Stocks"
                ? "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] text-white"
                : "glass text-zinc-500 hover:text-[#1D4ED8] dark:text-zinc-400"
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <SectionTitle title={`Stocks, Matchday ${fixture.matchdayIndex + 1}`} />
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Kickoff {formatUtcDateTime(fixture.kickoff)}, all times UTC. 1 goal = 0.05%, 1-hour window, Chainlink NAV.
      </p>

      <div className="glass relative mb-6 overflow-hidden rounded-3xl p-6 md:p-8">
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-40 w-[36rem] -translate-x-1/2 rounded-full bg-[#2E7CF6]/12 blur-3xl dark:bg-[#2E7CF6]/18"
          aria-hidden
        />
        <div className="relative grid grid-cols-3 items-center gap-2 text-center">
          <div className="flex flex-col items-center gap-2">
            <StockTeamBadge teamId={fixture.home.teamId} size={56} showName={false} />
            <p className="font-display font-bold text-zinc-900 dark:text-white">{fixture.home.name}</p>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              HOME, {fixture.home.symbol}
            </p>
          </div>
          <div>
            {status === "tba" || status === "upcoming" || status === "scheduled" ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Kickoff in</p>
                <Countdown target={kickoffMs} className="text-gradient text-2xl font-bold md:text-3xl" />
                {kickoffMs === null && <p className="text-sm text-zinc-500">TBA</p>}
              </>
            ) : status === "live" && liveScore ? (
              <p className="font-display text-3xl font-bold tabular-nums text-zinc-900 dark:text-white">
                {liveScore.homeGoals}
                <span className="mx-1 text-zinc-300 dark:text-zinc-600">:</span>
                {liveScore.awayGoals}
              </p>
            ) : status === "settled" || status === "forfeit" ? (
              <p className="font-display text-3xl font-bold tabular-nums text-zinc-900 dark:text-white">
                {finalScore ? `${finalScore[0]}:${finalScore[1]}` : "FT"}
              </p>
            ) : status === "voided" ? (
              <p className="font-display text-2xl font-bold text-zinc-900 dark:text-white">VOID</p>
            ) : (
              <p className="font-display text-2xl font-bold text-zinc-900 dark:text-white">FT</p>
            )}
            {status === "live" && (
              <p className="mt-1 text-xs font-bold uppercase tracking-widest text-red-500">Live</p>
            )}
            {status === "forfeit" && (
              <p className="mt-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-300">
                FORFEIT
              </p>
            )}
          </div>
          <div className="flex flex-col items-center gap-2">
            <StockTeamBadge teamId={fixture.away.teamId} size={56} showName={false} />
            <p className="font-display font-bold text-zinc-900 dark:text-white">{fixture.away.name}</p>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              AWAY, {fixture.away.symbol}
            </p>
          </div>
        </div>
        {status === "forfeit" && (
          <p className="relative mt-4 text-center text-sm text-amber-600 dark:text-amber-300">
            Forfeit 3-0. One side had no performance for this period, so the opponent wins 3-0 automatically.
          </p>
        )}
        {status === "voided" && (
          <p className="relative mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Void. Both sides had no performance for this period, stakes are refunded.
          </p>
        )}
        {status === "live" && liveScore?.volatile && (
          <p className="relative mt-4 text-center text-sm text-amber-600 dark:text-amber-300">
            Volatile move above 3%, capped at 10 goals and flagged for circuit breaker review.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {status === "settled" || status === "forfeit" ? (
            <div className="glass rounded-2xl p-5">
              <div className="mb-4 flex items-center justify-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-[0_0_18px_rgba(251,191,36,.4)]">
                  <Trophy className="h-4 w-4 text-white" />
                </span>
                <h3 className="font-display text-base font-bold text-zinc-900 dark:text-white">Full time</h3>
              </div>
              {winning !== null && (
                <p className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-300">
                  Result:{" "}
                  <span className="font-display font-bold text-zinc-900 dark:text-white">
                    {winning === 0 ? `${fixture.home.name} win` : winning === 2 ? `${fixture.away.name} win` : "Draw"}
                  </span>{" "}
                  <span className="text-zinc-400 dark:text-zinc-500">
                    ({OUTCOME_SHORT[winning]}, {OUTCOME_LABELS[winning]})
                  </span>
                </p>
              )}
              {playerAddress && stakes === null && (
                <p className="text-center text-sm text-zinc-500">Checking your stakes…</p>
              )}
              {playerAddress && stakes !== null && !hasStake && (
                <p className="text-center text-sm text-zinc-500">You didn&apos;t stake on this match.</p>
              )}
              {playerAddress && hasStake && claimed === false && (
                <div className="rounded-2xl border border-black/8 bg-black/[.03] p-4 dark:border-white/8 dark:bg-white/[.03]">
                  <p className="mb-1 font-display text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
                    Your stakes:{" "}
                    {stakes.map((s, i) => (s > 0n ? `${OUTCOME_SHORT[i]} ${formatTick(s)}` : null)).filter(Boolean).join(" · ")}{" "}
                    TICK
                  </p>
                  <p className={cn("mb-3 text-sm font-semibold", won ? "text-[#0f7a55] dark:text-[#7fe0bd]" : "text-zinc-500 dark:text-zinc-400")}>
                    {won ? "You won, claim your payout!" : "No win this time."}
                  </p>
                  <button
                    onClick={handleClaim}
                    disabled={claimBusy}
                    className={cn(
                      "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-all active:scale-[.98]",
                      claimBusy
                        ? "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
                        : "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_24px_rgba(46,124,246,.45)] hover:shadow-[0_0_36px_rgba(46,124,246,.6)]"
                    )}
                  >
                    {claimBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {claimBusy ? "Claiming…" : "Claim payout"}
                  </button>
                </div>
              )}
              {playerAddress && hasStake && claimed === true && (
                <p className="flex items-center justify-center gap-2 text-sm font-medium text-[#0f7a55] dark:text-[#7fe0bd]">
                  <CheckCircle2 className="h-4 w-4" /> Claimed
                </p>
              )}
              {claimError && (
                <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-200">
                  {claimError}
                </p>
              )}
            </div>
          ) : status === "voided" ? (
            <div className="glass rounded-2xl p-8 text-center">
              <p className="font-display text-lg font-bold text-zinc-900 dark:text-white">Void</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Both sides had no performance for this period. Stakes are refunded, no points are awarded.
              </p>
            </div>
          ) : status === "live" ? (
            <div className="space-y-6">
              <div className="glass rounded-2xl border-red-500/25! p-5">
                <p className="mb-4 text-sm font-bold uppercase tracking-widest text-red-500">Live, 1 goal = 0.05%</p>
                {[
                  { name: fixture.home.name, pct: homePctLive, teamId: fixture.home.teamId },
                  { name: fixture.away.name, pct: awayPctLive, teamId: fixture.away.teamId },
                ].map((row) => (
                  <div key={row.teamId} className="mb-4 last:mb-0">
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium text-zinc-700 dark:text-zinc-200">{row.name}</span>
                      <span className="font-display font-bold tabular-nums text-zinc-900 dark:text-white">
                        {row.pct === null ? "waiting for price…" : formatSignedPctStock(row.pct)}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/8 dark:bg-white/8">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-1000",
                          row.pct === null
                            ? "bg-zinc-400"
                            : row.pct >= 0
                              ? "bg-gradient-to-r from-[#1D9E75] to-[#34d399]"
                              : "bg-gradient-to-r from-red-500 to-red-400"
                        )}
                        style={{ width: `${row.pct === null ? 0 : Math.max(2, Math.min(100, Math.abs(row.pct) * 100))}%` }}
                      />
                    </div>
                    {prices[row.teamId]?.price && (
                      <p className="mt-1 font-display text-[11px] tabular-nums text-zinc-400 dark:text-zinc-600">
                        Live NAV: ${Number(prices[row.teamId]?.price ?? 0).toLocaleString("en-US")}, {prices[row.teamId]?.source ?? "Chainlink NAV"}
                      </p>
                    )}
                  </div>
                ))}
                {!snapshot && (
                  <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-500">
                    Kickoff snapshot not yet on-chain, bars appear once the backend submits start NAV values.
                  </p>
                )}
              </div>
              {bettingOpen && effectiveBettingCloseMs !== null && effectiveBettingCloseMs > now ? (
                <div className="glass rounded-2xl border-emerald-500/25! p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-display text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                      <span className="live-badge mr-2">Live</span> In-play betting open
                    </h3>
                    <span className="text-right text-xs text-zinc-500">
                      <span className="block">Closes in <Countdown target={effectiveBettingCloseMs} /></span>
                      <span className="block">Ends in <Countdown target={effectiveMatchEndMs} /></span>
                    </span>
                  </div>
                  <StockStakePanel
                    fixture={fixture}
                    pool={pool}
                    playerAddress={playerAddress}
                    balance={balance}
                    authenticated={authenticated}
                    onLogin={login}
                    onStaked={handleStaked}
                  />
                </div>
              ) : bettingOpen ? (
                <p className="text-center text-sm text-amber-600 dark:text-amber-400">
                  In-play betting closes 5 minutes before full time.
                </p>
              ) : null}
            </div>
          ) : status === "awaiting" ? (
            <div className="glass rounded-2xl border-amber-500/25! p-8 text-center">
              <p className="font-display text-lg font-bold text-zinc-900 dark:text-white">Full time</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                The window has closed, the result is being finalized on-chain.
              </p>
            </div>
          ) : (
            <StockStakePanel
              fixture={fixture}
              pool={pool}
              playerAddress={playerAddress}
              balance={balance}
              authenticated={authenticated}
              onLogin={login}
              onStaked={handleStaked}
            />
          )}
          <StockScoringExplainer compact />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <div className="glass rounded-2xl p-5">
            <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Pool, live
            </h3>
            {pool ? (
              <PoolBars pool={pool} />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                No stakes yet, be the first to move the odds.
              </p>
            )}
            <div className="mt-4 border-t border-black/8 pt-3 text-xs text-zinc-500 dark:border-white/8 dark:text-zinc-500">
              <p className="font-medium text-[#1D4ED8] dark:text-[#7db3ff]">
                Seeded liquidity: {pool ? formatTick(BigInt(pool.seed ?? "0")) : "250"} TICK
              </p>
              <p>Window: {formatUtcDateTime(fixture.windowStart)}</p>
              <p className="mt-1">Outcome 1 = home win, X = draw, 2 = away win</p>
            </div>
          </div>
          <StockAuditCard fixture={fixture} snapshot={snapshot} />
        </div>
      </div>
    </div>
  );
}

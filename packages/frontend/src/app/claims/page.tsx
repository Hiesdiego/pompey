
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Wallet } from "lucide-react";
import type { Address } from "viem";
import { useTickr } from "../../hooks/useTickr";
import { useTickBalance } from "../../hooks/useTickBalance";
import { useContractWrite } from "../../hooks/useContractWrite";
import { getPublicClient } from "../../hooks/usePublicClient";
import {
  CONTRACTS,
  PREDICTION_POOL_ABI,
  SEASON_ID,
  globalFixtureId,
} from "../../lib/contracts";
import { api, type ApiFixture } from "../../lib/api";
import { formatTick, OUTCOME_SHORT, outcomeLabel } from "../../lib/format";
import { cn } from "../../lib/cn";
import { celebrateClaim } from "../../lib/confetti";
import { SectionTitle, LoadingState, ErrorState, EmptyState } from "../../components/States";
import { TeamBadge } from "../../components/TeamBadge";
import { MARKET_FACTORY_ABI, MARKET_FACTORY_ADDRESS, TEMPLATE_NAMES } from "../../lib/marketFactory";
import { scanMarketClaims, type ClaimableMarket } from "../../lib/marketClaims";

interface ClaimableMatch {
  kind: "match";
  fixture: ApiFixture;
  stakes: [bigint, bigint, bigint];
  winningOutcome: number | null;
  voided: boolean;
}

type Claimable = ClaimableMatch | ClaimableMarket;

const CHUNK = 25;

async function scanClaimable(player: Address): Promise<Claimable[]> {
  if (!CONTRACTS.predictionPool) return [];
  const fixtures = await api.fixtures();
  const settled = fixtures.filter((f) => f.settled || f.voided);
  const client = getPublicClient();
  const out: Claimable[] = [];

  for (let i = 0; i < settled.length; i += CHUNK) {
    const chunk = settled.slice(i, i + CHUNK);
    const stakeContracts = chunk.flatMap((f) =>
      [0, 1, 2].map((o) => ({
        address: CONTRACTS.predictionPool as Address,
        abi: PREDICTION_POOL_ABI,
        functionName: "getStake" as const,
        args: [BigInt(f.seasonId), BigInt(f.fixtureId), player, o] as const,
      }))
    );
    const claimedContracts = chunk.map((f) => ({
      address: CONTRACTS.predictionPool as Address,
      abi: PREDICTION_POOL_ABI,
      functionName: "claimed" as const,
      args: [globalFixtureId(BigInt(f.seasonId), BigInt(f.fixtureId)), player] as const,
    }));
    const [stakeRes, claimedRes] = await Promise.all([
      client.multicall({ contracts: stakeContracts }),
      client.multicall({ contracts: claimedContracts }),
    ]);
    for (let j = 0; j < chunk.length; j++) {
      const stakes = [
        (stakeRes[j * 3].result ?? 0n) as bigint,
        (stakeRes[j * 3 + 1].result ?? 0n) as bigint,
        (stakeRes[j * 3 + 2].result ?? 0n) as bigint,
      ] as [bigint, bigint, bigint];
      const claimed = (claimedRes[j].result ?? false) as boolean;
      if (stakes.some((s) => s > 0n) && !claimed) {
        const pool = await api.pool(chunk[j].fixtureId);
        const winningOutcome = pool.winningOutcome;
        const voided = chunk[j].voided || pool.voided;
        if (!voided && (winningOutcome === null || stakes[winningOutcome] <= 0n)) continue;
        out.push({
          kind: "match",
          fixture: chunk[j],
          stakes,
          winningOutcome,
          voided,
        });
      }
    }
  }
  return out;
}

export default function ClaimsPage() {
  const { authenticated, login, playerAddress } = useTickr();
  const {
    balance,
    refresh: refreshBalance,
    claimFaucet,
    faucetBusy,
    faucetError,
    faucetTx,
    faucetReady,
    walletReady,
  } = useTickBalance(playerAddress);
  const { write } = useContractWrite();
  const [items, setItems] = useState<Claimable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [done, setDone] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [playerStats, setPlayerStats] = useState<{ totalStakedTick: string; totalWonTick: string } | null>(null);

  const runScan = useCallback(async () => {
    if (!playerAddress) return;
    setScanning(true);
    setError(null);
    setDone(false);
    try {
      const [matches, markets, stats] = await Promise.all([
        scanClaimable(playerAddress),
        scanMarketClaims(playerAddress),
        api.player(playerAddress).catch(() => null),
      ]);
      setItems([...matches, ...markets]);
      setPlayerStats(stats ? {
        totalStakedTick: stats.totalStakedTick,
        totalWonTick: stats.totalWonTick,
      } : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [playerAddress]);

  useEffect(() => {
    if (authenticated && playerAddress) runScan();
  }, [authenticated, playerAddress, runScan]);

  useEffect(() => {
    if (!authenticated || !playerAddress) return;
    const timer = window.setInterval(runScan, 15_000);
    const onFocus = () => runScan();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [authenticated, playerAddress, runScan]);

  const claimAll = async () => {
    if (!items || items.length === 0) return;
    setClaiming(true);
    setClaimError(null);
    setProgress({ done: 0, total: items.length });
    try {
      for (let i = 0; i < items.length; i++) {
        const c = items[i];
        if (c.kind === "market") {
          if (!MARKET_FACTORY_ADDRESS) throw new Error("MarketFactory address not configured.");
          await write({
            to: MARKET_FACTORY_ADDRESS,
            abi: MARKET_FACTORY_ABI,
            functionName: "claim",
            args: [BigInt(c.market.id)],
            label: `Claim market ${c.market.id}`,
          });
        } else {
          if (!CONTRACTS.predictionPool) throw new Error("PredictionPool address not configured.");
          await write({
            to: CONTRACTS.predictionPool,
            abi: PREDICTION_POOL_ABI,
            functionName: c.voided ? "claimVoid" : "claim",
            args: [BigInt(c.fixture.seasonId), BigInt(c.fixture.fixtureId)],
            label: `${c.voided ? "Reclaim" : "Claim"} match ${c.fixture.fixtureId}`,
          });
        }
        celebrateClaim();
        setProgress({ done: i + 1, total: items.length });
      }
      setDone(true);
      setItems([]);
      refreshBalance();
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : String(e));

      runScan();
    } finally {
      setClaiming(false);
    }
  };

  if (!authenticated) {
    return (
      <div className="py-10">
        <EmptyState
          icon={<Wallet className="h-8 w-8 text-zinc-400 dark:text-zinc-600" />}
          title="Sign in to see your claimable rewards."
        >
          <button
            onClick={login}
            className="mt-3 rounded-xl bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] px-6 py-2.5 text-sm font-bold text-white shadow-[0_0_20px_rgba(46,124,246,.4)] transition-all hover:shadow-[0_0_28px_rgba(46,124,246,.55)] active:scale-[.97]"
          >
            Sign in
          </button>
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle
        title="Your claims"
        action={
          <button
            onClick={runScan}
            disabled={scanning}
            className="text-sm font-semibold text-[#1D4ED8] transition-colors hover:text-[#2E7CF6] disabled:opacity-50 dark:text-[#7db3ff] dark:hover:text-[#4B93FF]"
          >
            {scanning ? "Scanning…" : "Rescan"}
          </button>
        }
      />

      {playerStats && (() => {
        const pnl = BigInt(playerStats.totalWonTick) - BigInt(playerStats.totalStakedTick);
        return (
          <section aria-label="Prediction analytics" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="glass rounded-2xl p-4">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total PnL</p>
              <p className={cn("mt-1 font-display text-xl font-bold tabular-nums", pnl >= 0n ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-400")}>
                {pnl >= 0n ? "+" : "−"}{formatTick(pnl >= 0n ? pnl : -pnl)} TICK
              </p>
            </div>
            <div className="glass rounded-2xl p-4">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total won</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums text-zinc-900 dark:text-white">{formatTick(playerStats.totalWonTick)} TICK</p>
            </div>
            <div className="glass rounded-2xl p-4">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total staked</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums text-zinc-900 dark:text-white">{formatTick(playerStats.totalStakedTick)} TICK</p>
            </div>
            <div className="glass rounded-2xl p-4">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Pending claims</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums text-zinc-900 dark:text-white">{items?.length ?? "—"}</p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">matches and markets</p>
            </div>
          </section>
        );
      })()}

      <section aria-label="Daily TICK claim" className="glass mb-5 flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base font-bold text-zinc-900 dark:text-white">Daily TICK</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Claim free TICK once every 24 hours to use in matches and markets.
          </p>
          {faucetError && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">{faucetError}</p>}
          {faucetTx && <p role="status" className="mt-2 text-sm text-[#1D9E75] dark:text-[#7fe0bd]">TICK claimed successfully.</p>}
        </div>
        {balance !== null && faucetReady ? (
          <button
            onClick={claimFaucet}
            disabled={faucetBusy || !walletReady}
            className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] px-6 py-2.5 text-sm font-bold text-white shadow-[0_0_20px_rgba(46,124,246,.3)] transition-all hover:shadow-[0_0_28px_rgba(46,124,246,.45)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {faucetBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            {faucetBusy ? "Claiming…" : "Claim TICK"}
          </button>
        ) : (
          <span className="shrink-0 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {balance === null ? "Checking availability…" : "Claimed for now"}
          </span>
        )}
      </section>

      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={runScan} />
        </div>
      )}

      {scanning || items === null ? (
        <LoadingState label="Scanning matches and markets for your claims…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-[#1D9E75]" />}
          title={done ? "All claimed — nice work!" : "Nothing to claim right now."}
        >
          Winning predictions and refundable stakes will show up here after settlement.
        </EmptyState>
      ) : (
        <>
          <div className="glass mb-4 flex flex-col items-stretch justify-between gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-300">
              <span className="font-display font-bold tabular-nums text-zinc-900 dark:text-white">
                {items.length}
              </span>{" "}
              claim{items.length === 1 ? "" : "s"} ready
            </p>
            <div className="flex flex-col gap-2">
              {claiming && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/8 dark:bg-white/8">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#2E7CF6] to-[#1D4ED8] transition-all duration-300"
                    style={{
                      width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              )}
              <button
                onClick={claimAll}
                disabled={claiming}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white transition-all active:scale-[.98]",
                  claiming
                    ? "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
                    : "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_24px_rgba(46,124,246,.45)] hover:shadow-[0_0_36px_rgba(46,124,246,.6)]"
                )}
              >
                {claiming && <Loader2 className="h-4 w-4 animate-spin" />}
                {claiming
                  ? `Claiming ${progress.done}/${progress.total}…`
                  : `Claim all (${items.length})`}
              </button>
            </div>
          </div>
          {claimError && (
            <p className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-200">
              {claimError}
            </p>
          )}
          <div className="space-y-3">
            {items.map((c) => c.kind === "market" ? (
              <Link
                key={`market-${c.market.id}`}
                href={`/markets/${c.market.id}`}
                className="glass card-interactive flex items-center gap-4 rounded-2xl p-4"
              >
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    {TEMPLATE_NAMES[c.market.templateId] ?? "Market"} #{c.market.id}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {c.market.state === 2 ? "Stake refund" : "Winnings"} · {formatTick(c.amount)} TICK
                  </span>
                </div>
                <span className="shrink-0 rounded-full bg-[#1D9E75]/12 px-3 py-1 text-xs font-bold text-[#0f7a55] dark:bg-[#1D9E75]/15 dark:text-[#7fe0bd]">
                  {c.market.state === 2 ? "Claim refund" : "Claim winnings"}
                </span>
              </Link>
            ) : (
              <Link
                key={`match-${c.fixture.seasonId}-${c.fixture.fixtureId}`}
                href={`/match/${c.fixture.fixtureId}`}
                className="glass card-interactive flex items-center gap-4 rounded-2xl p-4"
              >
                <div className="flex flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-6">
                  {c.fixture.home && c.fixture.away && (
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                      <TeamBadge teamId={c.fixture.home.teamId} size={24} showName={false} />
                      <span className="hidden sm:inline">{c.fixture.home.name}</span>
                      <span className="text-zinc-400 dark:text-zinc-600">vs</span>
                      <TeamBadge teamId={c.fixture.away.teamId} size={24} showName={false} />
                      <span className="hidden sm:inline">{c.fixture.away.name}</span>
                    </div>
                  )}
                  <span className="font-display text-xs tabular-nums text-zinc-500 dark:text-zinc-500">
                    Matchday {(c.fixture.matchdayIndex ?? 0) + 1} · staked{" "}
                    {c.stakes
                      .map((s, i) => (s > 0n ? `${OUTCOME_SHORT[i]} ${formatTick(s, 0)}` : null))
                      .filter(Boolean)
                      .join(" · ")}{" "}
                    TICK
                  </span>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-xs font-bold",
                    c.voided
                      ? "bg-amber-500/12 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                      : "bg-[#1D9E75]/12 text-[#0f7a55] shadow-[0_0_14px_rgba(29,158,117,.25)] dark:bg-[#1D9E75]/15 dark:text-[#7fe0bd]"
                  )}
                >
                  {c.voided
                    ? "Claim refund"
                    : `Won — ${outcomeLabel(c.winningOutcome!)}`}
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-4 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
            Batch claiming sends one gasless transaction per claim, in sequence.
          </p>
        </>
      )}
    </div>
  );
}

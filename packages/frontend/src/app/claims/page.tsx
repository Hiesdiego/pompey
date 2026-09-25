/**
 * Claims page (spec P3.11): all claimable rewards for the connected player
 * across settled matches, with sequential batch claiming.
 *
 * Scan: settled fixtures → chunked multicall of
 * getStake(season, fixture, player, outcome)×3 + claimed(gid, player).
 * A fixture is claimable when the player staked > 0 and hasn't claimed.
 * (Claiming also records forfeits as losses when the pool went to treasury.)
 */

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
import { SectionTitle, LoadingState, ErrorState, EmptyState } from "../../components/States";
import { TeamBadge } from "../../components/TeamBadge";

interface Claimable {
  fixture: ApiFixture;
  stakes: [bigint, bigint, bigint];
  winningOutcome: number | null;
  won: boolean;
}

const CHUNK = 25; // fixtures per multicall

async function scanClaimable(player: Address): Promise<Claimable[]> {
  if (!CONTRACTS.predictionPool) throw new Error("PredictionPool address not configured.");
  const fixtures = await api.fixtures();
  const settled = fixtures.filter((f) => f.settled);
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
        let winningOutcome: number | null = null;
        try {
          const pool = await api.pool(chunk[j].fixtureId);
          winningOutcome = pool.winningOutcome;
        } catch {
          /* pool endpoint missing — still claimable */
        }
        out.push({
          fixture: chunk[j],
          stakes,
          winningOutcome,
          won: winningOutcome !== null && stakes[winningOutcome] > 0n,
        });
      }
    }
  }
  return out;
}

export default function ClaimsPage() {
  const { authenticated, login, playerAddress } = useTickr();
  const { refresh: refreshBalance } = useTickBalance(playerAddress);
  const { write } = useContractWrite();
  const [items, setItems] = useState<Claimable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [done, setDone] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    if (!playerAddress) return;
    setScanning(true);
    setError(null);
    setDone(false);
    try {
      setItems(await scanClaimable(playerAddress));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [playerAddress]);

  useEffect(() => {
    if (authenticated && playerAddress) runScan();
  }, [authenticated, playerAddress, runScan]);

  const claimAll = async () => {
    if (!items || items.length === 0 || !CONTRACTS.predictionPool) return;
    setClaiming(true);
    setClaimError(null);
    setProgress({ done: 0, total: items.length });
    try {
      for (let i = 0; i < items.length; i++) {
        const c = items[i];
        await write({
          to: CONTRACTS.predictionPool,
          abi: PREDICTION_POOL_ABI,
          functionName: "claim",
          args: [BigInt(c.fixture.seasonId), BigInt(c.fixture.fixtureId)],
          label: `Claim match ${c.fixture.fixtureId}`,
        });
        setProgress({ done: i + 1, total: items.length });
      }
      setDone(true);
      setItems([]);
      refreshBalance();
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : String(e));
      // Rescan to show what remains.
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

      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={runScan} />
        </div>
      )}

      {scanning || items === null ? (
        <LoadingState label="Scanning settled matches for your stakes…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-[#1D9E75]" />}
          title={done ? "All claimed — nice work!" : "Nothing to claim right now."}
        >
          Settle a winning prediction and it will show up here.
        </EmptyState>
      ) : (
        <>
          <div className="glass mb-4 flex flex-col items-stretch justify-between gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-300">
              <span className="font-display font-bold tabular-nums text-zinc-900 dark:text-white">
                {items.length}
              </span>{" "}
              match{items.length === 1 ? "" : "es"} ready to claim
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
            {items.map((c) => (
              <Link
                key={c.fixture.fixtureId}
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
                    c.won
                      ? "bg-[#1D9E75]/12 text-[#0f7a55] shadow-[0_0_14px_rgba(29,158,117,.25)] dark:bg-[#1D9E75]/15 dark:text-[#7fe0bd]"
                      : c.winningOutcome !== null
                        ? "bg-black/5 text-zinc-500 dark:bg-white/8 dark:text-zinc-400"
                        : "bg-amber-500/12 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
                  )}
                >
                  {c.won
                    ? `Won — ${outcomeLabel(c.winningOutcome!)}`
                    : c.winningOutcome !== null
                      ? `Lost — ${outcomeLabel(c.winningOutcome)}`
                      : "Settled"}
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-4 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
            Batch claiming sends one gasless transaction per match, in sequence.
          </p>
        </>
      )}
    </div>
  );
}

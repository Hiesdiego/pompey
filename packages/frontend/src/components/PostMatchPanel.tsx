/**
 * PostMatchPanel — post-match view (spec P3.8).
 * Final result with rounded % scores, plus the claim button for the
 * connected player (reads getStake for all 3 outcomes + claimed status).
 *
 * Also handles VOIDED fixtures (escape hatch): no result is shown — the
 * match never happened — and the button becomes a 1:1 stake reclaim via
 * PredictionPool.claimVoid instead of a payout claim.
 */

"use client";

import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Loader2, Trophy } from "lucide-react";
import type { Address } from "viem";
import {
  CONTRACTS,
  PREDICTION_POOL_ABI,
  PRICE_DECIMALS,
  SEASON_ID,
  globalFixtureId,
} from "../lib/contracts";
import {
  formatTick,
  formatSignedPct,
  outcomeLabel,
  OUTCOME_SHORT,
} from "../lib/format";
import { cn } from "../lib/cn";
import { celebrateClaim } from "../lib/confetti";
import { getPublicClient } from "../hooks/usePublicClient";
import { useContractWrite } from "../hooks/useContractWrite";
import { TeamBadge } from "./TeamBadge";
import type { ApiFixture, ApiPool } from "../lib/api";

export interface FullSnapshot {
  homeStart: bigint;
  awayStart: bigint;
  homeEnd: bigint;
  awayEnd: bigint;
  endSubmitted: boolean;
}

function pctOf(start: bigint, end: bigint): number | null {
  if (start <= 0n || end <= 0n) return null;
  const s = Number(start) / 10 ** PRICE_DECIMALS;
  const e = Number(end) / 10 ** PRICE_DECIMALS;
  if (s <= 0) return null;
  return ((e - s) / s) * 100;
}

export function PostMatchPanel({
  fixture,
  pool,
  snapshot,
  playerAddress,
  onClaimed,
}: {
  fixture: ApiFixture;
  pool: ApiPool | null;
  snapshot: FullSnapshot | null;
  playerAddress: Address | null;
  onClaimed: () => void;
}) {
  const [stakes, setStakes] = useState<[bigint, bigint, bigint] | null>(null);
  const [claimed, setClaimed] = useState<boolean | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const { write } = useContractWrite();

  const fixtureId = BigInt(fixture.fixtureId);
  const winning = pool?.winningOutcome ?? null;
  // Escape hatch: the fixture was voided by the owner (window elapsed with
  // no settlement possible). Stakes are refundable 1:1 — never payable.
  const voided = fixture.voided || pool?.voided || false;

  useEffect(() => {
    let alive = true;
    setStakes(null);
    setClaimed(null);
    if (!playerAddress || !CONTRACTS.predictionPool) return;
    const client = getPublicClient();
    const contracts = [0, 1, 2].map((o) => ({
      address: CONTRACTS.predictionPool as Address,
      abi: PREDICTION_POOL_ABI,
      functionName: "getStake" as const,
      args: [SEASON_ID, fixtureId, playerAddress, o] as const,
    }));
    Promise.all([
      client.multicall({ contracts }),
      client.readContract({
        address: CONTRACTS.predictionPool as Address,
        abi: PREDICTION_POOL_ABI,
        functionName: "claimed",
        args: [globalFixtureId(SEASON_ID, fixtureId), playerAddress],
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
  }, [playerAddress, fixtureId]);

  const handleClaim = async () => {
    setClaimError(null);
    setClaimTx(null);
    if (!CONTRACTS.predictionPool) {
      setClaimError("Contract addresses not configured.");
      return;
    }
    setClaimBusy(true);
    try {
      const hash = await write({
        to: CONTRACTS.predictionPool,
        abi: PREDICTION_POOL_ABI,
        functionName: voided ? "claimVoid" : "claim",
        args: [SEASON_ID, fixtureId],
        label: voided ? "Reclaim stake" : "Claim payout",
      });
      setClaimTx(hash);
      setClaimed(true);
      celebrateClaim();
      onClaimed();
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

  if (!fixture.home || !fixture.away) return null;

  const homePct = snapshot ? pctOf(snapshot.homeStart, snapshot.homeEnd) : null;
  const awayPct = snapshot ? pctOf(snapshot.awayStart, snapshot.awayEnd) : null;
  // Same normalization the oracle applies at full time — the final board
  // never shows a negative scoreline.
  const hasStake = stakes !== null && stakes.some((s) => s > 0n);
  const won = winning !== null && stakes !== null && stakes[winning] > 0n;

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-center gap-2">
        {voided ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-400 to-zinc-600 shadow-[0_0_18px_rgba(161,161,170,.4)]">
            <Ban className="h-4 w-4 text-white" />
          </span>
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-[0_0_18px_rgba(251,191,36,.4)]">
            <Trophy className="h-4 w-4 text-white" />
          </span>
        )}
        <h3 className="font-display text-base font-bold text-zinc-900 dark:text-white">
          {voided ? "Match voided" : "Final match analytics"}
        </h3>
      </div>

      {voided && (
        <p className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          This match could not be played and was voided. No result stands —
          every stake is refundable in full.
        </p>
      )}

      {!voided && (
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        {[
          { team: fixture.home, pct: homePct, winning: winning === 0, color: "from-emerald-500 to-lime-300", glow: "bg-emerald-400" },
          { team: fixture.away, pct: awayPct, winning: winning === 2, color: "from-[#2E7CF6] to-cyan-300", glow: "bg-[#2E7CF6]" },
        ].map(({ team, pct, winning: isWinner, color, glow }) => {
          const width = pct === null ? 0 : Math.max(3, Math.min(100, Math.abs(pct) * 10));
          return <div key={team.teamId} className="relative overflow-hidden rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
            <div className={`pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full ${glow} opacity-[.09] blur-2xl`} />
            <div className="relative flex items-center gap-3">
              <TeamBadge teamId={team.teamId} size={38} showName={false} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-zinc-900 dark:text-white">{team.name}</p><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{isWinner ? "Match winner" : "Price performance"}</p></div>
              <strong className={`font-display text-xl tabular-nums ${pct === null ? "text-zinc-400" : pct >= 0 ? "text-emerald-500" : "text-red-500"}`}>{pct === null ? "—" : formatSignedPct(pct)}</strong>
            </div>
            <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-black/[.07] dark:bg-white/[.08]"><div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700`} style={{ width: `${width}%` }} /></div>
            <p className="relative mt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{pct === null ? "Oracle performance unavailable" : `${pct >= 0 ? "Gained" : "Declined"} over the match window`}</p>
          </div>;
        })}
      </div>
      )}

      {!voided && winning !== null && (
        <p className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-300">
          Result:{" "}
          <span className="font-display font-bold text-zinc-900 dark:text-white">
            {winning === 0
              ? `${fixture.home.name} win`
              : winning === 2
                ? `${fixture.away.name} win`
                : "Draw"}
          </span>{" "}
          <span className="text-zinc-400 dark:text-zinc-500">({OUTCOME_SHORT[winning]} · {outcomeLabel(winning)})</span>
        </p>
      )}

      {/* Claim section */}
      {playerAddress && stakes === null && (
        <p className="text-center text-sm text-zinc-500">Checking your stakes…</p>
      )}
      {playerAddress && stakes !== null && !hasStake && (
        <p className="text-center text-sm text-zinc-500">You didn't stake on this match.</p>
      )}
      {playerAddress && hasStake && claimed === false && (won || voided) && (
        <div className="rounded-2xl border border-black/8 bg-black/[.03] p-4 dark:border-white/8 dark:bg-white/[.03]">
          <p className="mb-1 font-display text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
            Your stakes:{" "}
            {stakes
              .map((s, i) => (s > 0n ? `${OUTCOME_SHORT[i]} ${formatTick(s)}` : null))
              .filter(Boolean)
              .join(" · ")}{" "}
            TICK
          </p>
          <p className={cn("mb-3 text-sm font-semibold", won ? "text-[#0f7a55] dark:text-[#7fe0bd]" : "text-zinc-500 dark:text-zinc-400")}>
            {voided
              ? "Match voided — reclaim your full stake (1:1, no fee)."
              : won
                ? "You won — claim your payout!"
                : "No win this time — your stake was forfeited to the winning pool."}
          </p>
          <button
            onClick={handleClaim}
            disabled={claimBusy}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-all active:scale-[.98]",
              claimBusy
                ? "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
                : won || voided
                  ? "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_24px_rgba(46,124,246,.45)] hover:shadow-[0_0_36px_rgba(46,124,246,.6)]"
                  : "bg-zinc-500 hover:bg-zinc-600 dark:bg-zinc-600 dark:hover:bg-zinc-500"
            )}
          >
            {claimBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            {claimBusy
              ? voided
                ? "Reclaiming…"
                : won
                  ? "Claiming…"
                  : "Recording…"
              : voided
                ? "Reclaim stake"
                : won
                  ? "Claim payout"
                  : "Record result"}
          </button>
          <p className="mt-2 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
            {won || voided
              ? "Gasless — sent from your smart wallet, sponsored by TICKR."
              : "No payout — this only records the result on your profile."}
          </p>
        </div>
      )}
      {playerAddress && hasStake && claimed === false && !won && !voided && (
        <p className="text-center text-sm text-zinc-500">Your pick lost. There is no payout to claim.</p>
      )}
      {playerAddress && hasStake && claimed === true && (
        <p className="flex items-center justify-center gap-2 text-sm font-medium text-[#0f7a55] dark:text-[#7fe0bd]">
          <CheckCircle2 className="h-4 w-4" /> {voided ? "Reclaimed" : won ? "Payout claimed" : "Result recorded"}
          {claimTx && (
            <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{claimTx.slice(0, 10)}…</span>
          )}
        </p>
      )}
      {claimError && (
        <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-200">
          {claimError}
        </p>
      )}
    </div>
  );
}

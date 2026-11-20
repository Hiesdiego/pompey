"use client";

import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Loader2, Trophy } from "lucide-react";
import type { Address } from "viem";
import {
  STOCK_CONTRACTS,
  STOCK_PREDICTION_POOL_ABI,
  STOCK_SEASON_ID,
  stockGlobalFixtureId,
  type StockApiFixture,
  type StockApiPool,
} from "../lib/stockContracts";
import { formatTick, OUTCOME_LABELS, OUTCOME_SHORT } from "../lib/format";
import { formatSignedPctStock } from "../lib/stockFormat";
import { cn } from "../lib/cn";
import { celebrateClaim } from "../lib/confetti";
import { getPublicClient } from "../hooks/usePublicClient";
import { useContractWrite } from "../hooks/useContractWrite";

export interface StockFullSnapshot {
  homeStart: bigint;
  awayStart: bigint;
  homeEnd: bigint;
  awayEnd: bigint;
  endSubmitted: boolean;
}

function pctOf(start: bigint, end: bigint): number | null {
  if (start <= 0n || end <= 0n) return null;
  return ((Number(end) - Number(start)) / Number(start)) * 100;
}

export function StockPostMatchPanel({
  fixture,
  pool,
  snapshot,
  playerAddress,
  onClaimed,
}: {
  fixture: StockApiFixture;
  pool: StockApiPool | null;
  snapshot: StockFullSnapshot | null;
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
  const voided = fixture.voided === true || pool?.voided === true;

  useEffect(() => {
    let alive = true;
    setStakes(null);
    setClaimed(null);
    const poolAddress = STOCK_CONTRACTS.predictionPool;
    if (!playerAddress || !poolAddress) return;

    const client = getPublicClient();
    const contracts = [0, 1, 2].map((outcome) => ({
      address: poolAddress,
      abi: STOCK_PREDICTION_POOL_ABI,
      functionName: "getStake" as const,
      args: [STOCK_SEASON_ID, fixtureId, playerAddress, outcome] as const,
    }));
    Promise.all([
      client.multicall({ contracts }),
      client.readContract({
        address: poolAddress,
        abi: STOCK_PREDICTION_POOL_ABI,
        functionName: "claimed",
        args: [stockGlobalFixtureId(STOCK_SEASON_ID, fixtureId), playerAddress],
      }),
    ])
      .then(([stakeResults, claimedResult]) => {
        if (!alive) return;
        setStakes([
          (stakeResults[0].result ?? 0n) as bigint,
          (stakeResults[1].result ?? 0n) as bigint,
          (stakeResults[2].result ?? 0n) as bigint,
        ]);
        setClaimed(claimedResult as boolean);
      })
      .catch(() => {
        if (!alive) return;
        setStakes(null);
        setClaimed(null);
      });

    return () => {
      alive = false;
    };
  }, [fixtureId, playerAddress]);

  const handleClaim = async () => {
    setClaimError(null);
    setClaimTx(null);
    if (!STOCK_CONTRACTS.predictionPool) {
      setClaimError("Stock pool contract address is not configured.");
      return;
    }

    setClaimBusy(true);
    try {
      const hash = await write({
        to: STOCK_CONTRACTS.predictionPool,
        abi: STOCK_PREDICTION_POOL_ABI,
        functionName: "claim",
        args: [STOCK_SEASON_ID, fixtureId],
        label: voided ? "Refund stock match stake" : won ? "Claim stock match payout" : "Record stock match result",
      });
      setClaimTx(hash);
      setClaimed(true);
      celebrateClaim();
      onClaimed();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setClaimError(
        message.includes("NothingToClaim")
          ? "Nothing to claim on this match."
          : message.includes("AlreadyClaimed")
            ? "This match has already been claimed."
            : message,
      );
    } finally {
      setClaimBusy(false);
    }
  };

  if (!fixture.home || !fixture.away) return null;

  const homePct = snapshot?.endSubmitted
    ? pctOf(snapshot.homeStart, snapshot.homeEnd)
    : null;
  const awayPct = snapshot?.endSubmitted
    ? pctOf(snapshot.awayStart, snapshot.awayEnd)
    : null;
  const hasStake = stakes !== null && stakes.some((stake) => stake > 0n);
  const won = winning !== null && stakes !== null && stakes[winning] > 0n;
  const performance = [
    { team: fixture.home, pct: homePct, winner: winning === 0, color: "from-emerald-500 to-lime-300" },
    { team: fixture.away, pct: awayPct, winner: winning === 2, color: "from-[#2E7CF6] to-cyan-300" },
  ];

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-center gap-2">
        <span className={cn(
          "flex h-9 w-9 items-center justify-center rounded-xl shadow-[0_0_18px_rgba(46,124,246,.3)]",
          voided ? "bg-gradient-to-br from-zinc-400 to-zinc-600" : "bg-gradient-to-br from-amber-400 to-amber-600",
        )}>
          {voided ? <Ban className="h-4 w-4 text-white" /> : <Trophy className="h-4 w-4 text-white" />}
        </span>
        <h3 className="font-display text-base font-bold text-zinc-900 dark:text-white">
          {voided ? "Match voided" : "Final match analytics"}
        </h3>
      </div>

      {voided && (
        <p className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          This match was voided because neither side had a result. Stakes can be refunded in full.
        </p>
      )}

      {!voided && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {performance.map(({ team, pct, winner, color }) => {
            const width = pct === null ? 0 : Math.max(3, Math.min(100, Math.abs(pct) * 10));
            return (
              <div key={team.teamId} className="rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2E7CF6]/10 text-xs font-extrabold text-[#1D4ED8] dark:text-[#7db3ff]">
                    {team.symbol.slice(0, 4)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-zinc-900 dark:text-white">{team.name}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      {winner ? "Match winner" : "Price performance"}
                    </p>
                  </div>
                  <strong className={cn(
                    "font-display text-xl tabular-nums",
                    pct === null ? "text-zinc-400" : pct >= 0 ? "text-emerald-500" : "text-red-500",
                  )}>
                    {pct === null ? "—" : formatSignedPctStock(pct)}
                  </strong>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/[.07] dark:bg-white/[.08]">
                  <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700`} style={{ width: `${width}%` }} />
                </div>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {pct === null ? "Oracle performance unavailable" : `${pct >= 0 ? "Gained" : "Declined"} over the match window`}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {!voided && winning !== null && (
        <p className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-300">
          Result: <span className="font-display font-bold text-zinc-900 dark:text-white">
            {winning === 0 ? `${fixture.home.name} win` : winning === 2 ? `${fixture.away.name} win` : "Draw"}
          </span>{" "}
          <span className="text-zinc-400 dark:text-zinc-500">({OUTCOME_SHORT[winning]} · {OUTCOME_LABELS[winning]})</span>
        </p>
      )}

      {playerAddress && stakes === null && <p className="text-center text-sm text-zinc-500">Checking your stakes…</p>}
      {playerAddress && stakes !== null && !hasStake && <p className="text-center text-sm text-zinc-500">You didn’t stake on this match.</p>}
      {playerAddress && hasStake && claimed === false && (
        <div className="rounded-2xl border border-black/8 bg-black/[.03] p-4 dark:border-white/8 dark:bg-white/[.03]">
          <p className="mb-1 font-display text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
            Your stakes: {stakes.map((stake, index) => stake > 0n ? `${OUTCOME_SHORT[index]} ${formatTick(stake)}` : null).filter(Boolean).join(" · ")}
          </p>
          <p className={cn("mb-3 text-sm font-semibold", won ? "text-[#0f7a55] dark:text-[#7fe0bd]" : "text-zinc-500 dark:text-zinc-400")}>
            {voided ? "Match voided — reclaim your full stake." : won ? "You won — claim your payout." : "No payout for this pick. Record the result on your profile."}
          </p>
          <button
            onClick={handleClaim}
            disabled={claimBusy}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-all active:scale-[.98]",
              claimBusy
                ? "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
                : won || voided
                  ? "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_24px_rgba(46,124,246,.35)] hover:shadow-[0_0_36px_rgba(46,124,246,.5)]"
                  : "bg-zinc-500 hover:bg-zinc-600 dark:bg-zinc-600 dark:hover:bg-zinc-500",
            )}
          >
            {claimBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            {claimBusy ? voided ? "Refunding…" : won ? "Claiming…" : "Recording…" : voided ? "Reclaim stake" : won ? "Claim payout" : "Record result"}
          </button>
          <p className="mt-2 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
            {won || voided ? "Gasless — sent from your smart wallet, sponsored by TICKR." : "No payout — this records the result on your profile."}
          </p>
        </div>
      )}
      {playerAddress && hasStake && claimed === true && (
        <p className="flex items-center justify-center gap-2 text-sm font-medium text-[#0f7a55] dark:text-[#7fe0bd]">
          <CheckCircle2 className="h-4 w-4" /> {voided ? "Refund claimed" : won ? "Payout claimed" : "Result recorded"}
          {claimTx && <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{claimTx.slice(0, 10)}…</span>}
        </p>
      )}
      {claimError && <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-200">{claimError}</p>}
    </section>
  );
}

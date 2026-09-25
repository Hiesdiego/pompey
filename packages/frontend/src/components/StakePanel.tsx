/**
 * StakePanel — pre-match staking form (spec P3.6).
 * Outcome picker (1/X/2) + amount input + approve→stake via the
 * gas-sponsored smart-wallet path. Shows live pool distribution and an
 * estimated payout.
 *
 * Estimated payout for a new stake a on outcome with current winning pool w
 * and pool total T (mirrors PredictionPool.claim):
 *   payout ≈ a · (T + a) · (1 − fee) / (w + a),  fee = 700 bps
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import type { Address } from "viem";
import { PLATFORM_FEE_BPS } from "@tickr/shared/constants";
import {
  CONTRACTS,
  MIN_STAKE_TICK,
  PREDICTION_POOL_ABI,
  SEASON_ID,
  TICK_TOKEN_ABI,
} from "../lib/contracts";
import { type ApiFixture, type ApiPool } from "../lib/api";
import {
  formatTick,
  parseTickInput,
  OUTCOME_LABELS,
  OUTCOME_SHORT,
} from "../lib/format";
import { cn } from "../lib/cn";
import { getPublicClient } from "../hooks/usePublicClient";
import { useContractWrite } from "../hooks/useContractWrite";
import { PoolBars } from "./PoolBars";

const OUTCOME_ACTIVE = [
  "border-[#2E7CF6] bg-[#2E7CF6]/12 text-[#1D4ED8] shadow-[0_0_18px_rgba(46,124,246,.25)] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]",
  "border-zinc-400 bg-zinc-500/12 text-zinc-600 dark:border-zinc-500 dark:text-zinc-200",
  "border-[#1D9E75] bg-[#1D9E75]/12 text-[#0f7a55] dark:bg-[#1D9E75]/15 dark:text-[#7fe0bd]",
];
const OUTCOME_IDLE =
  "border-black/10 bg-black/[.02] text-zinc-500 hover:border-[#2E7CF6]/40 hover:text-zinc-800 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-400 dark:hover:border-[#2E7CF6]/40 dark:hover:text-zinc-200";

type Step = "idle" | "approving" | "staking" | "done";

export function StakePanel({
  fixture,
  pool,
  playerAddress,
  balance,
  authenticated,
  onLogin,
  onStaked,
}: {
  fixture: ApiFixture;
  pool: ApiPool | null;
  playerAddress: Address | null;
  balance: bigint | null;
  authenticated: boolean;
  onLogin: () => void;
  onStaked: () => void;
}) {
  const [outcome, setOutcome] = useState<number>(0);
  const [amountStr, setAmountStr] = useState("10");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const { write } = useContractWrite();

  const fixtureId = BigInt(fixture.fixtureId);
  const amount = useMemo(() => parseTickInput(amountStr), [amountStr]);

  // Refresh allowance when the player/amount changes.
  useEffect(() => {
    let alive = true;
    if (!playerAddress || !CONTRACTS.tickToken || !CONTRACTS.predictionPool) {
      setAllowance(null);
      return;
    }
    getPublicClient()
      .readContract({
        address: CONTRACTS.tickToken,
        abi: TICK_TOKEN_ABI,
        functionName: "allowance",
        args: [playerAddress, CONTRACTS.predictionPool],
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
  const totalPool = pool ? BigInt(pool.totalPool) : 0n;

  const estimatedPayout = useMemo(() => {
    if (!amount || totalPool < 0n) return null;
    const w = totals[outcome];
    const T = totalPool + amount;
    const distributable = (T * BigInt(10_000 - PLATFORM_FEE_BPS)) / 10_000n;
    return (amount * distributable) / (w + amount);
  }, [amount, outcome, totals, totalPool]);

  // Null allowance (read failed) → approve defensively; approve is idempotent.
  const needsApproval = amount !== null && (allowance === null || allowance < amount);
  const balanceOk = amount !== null && balance !== null && balance >= amount;
  const minOk = amount !== null;

  const busy = step === "approving" || step === "staking";

  const handleStake = async () => {
    setError(null);
    if (!playerAddress) {
      setError("Connect your wallet first.");
      return;
    }
    if (!CONTRACTS.tickToken || !CONTRACTS.predictionPool) {
      setError("Contract addresses not configured — fill in .env.local.");
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
      setError("Insufficient TICK balance — use the faucet in the header.");
      return;
    }
    try {
      if (needsApproval) {
        setStep("approving");
        await write({
          to: CONTRACTS.tickToken,
          abi: TICK_TOKEN_ABI,
          functionName: "approve",
          args: [CONTRACTS.predictionPool, amount],
          label: "TICK approval",
        });
      }
      setStep("staking");
      await write({
        to: CONTRACTS.predictionPool,
        abi: PREDICTION_POOL_ABI,
        functionName: "stake",
        args: [SEASON_ID, fixtureId, outcome, amount],
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
          Sign in to stake on this match
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Privy login is gasless — your smart wallet covers transaction fees.
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
                outcome === opt.o ? OUTCOME_ACTIVE[opt.o] : OUTCOME_IDLE
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
            Pool total: {formatTick(totalPool)} TICK · {PLATFORM_FEE_BPS / 100}% platform fee
          </p>
        </div>
      )}

      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Amount (TICK) — min {MIN_STAKE_TICK}
      </label>
      <div className="flex gap-2">
        <input
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          inputMode="decimal"
          disabled={busy}
          className="w-full rounded-xl border border-black/10 bg-black/[.03] px-3 py-2.5 font-display tabular-nums text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:border-[#2E7CF6] focus:ring-2 focus:ring-[#2E7CF6]/40 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-zinc-600"
          placeholder="10"
        />
        {["10", "50", "100"].map((q) => (
          <button
            key={q}
            onClick={() => setAmountStr(q)}
            disabled={busy}
            className="rounded-xl border border-black/10 px-3 text-sm font-semibold text-zinc-600 transition-all hover:border-[#2E7CF6]/60 hover:text-[#1D4ED8] active:scale-95 dark:border-white/10 dark:text-zinc-300 dark:hover:border-[#2E7CF6]/60 dark:hover:text-[#7db3ff]"
          >
            {q}
          </button>
        ))}
        <button
          onClick={() =>
            setAmountStr(
              balance !== null ? String(balance / 10n ** 18n) : "0"
            )
          }
          disabled={busy}
          className="rounded-xl border border-black/10 px-3 text-sm font-semibold text-zinc-600 transition-all hover:border-[#2E7CF6]/60 hover:text-[#1D4ED8] active:scale-95 dark:border-white/10 dark:text-zinc-300 dark:hover:border-[#2E7CF6]/60 dark:hover:text-[#7db3ff]"
        >
          MAX
        </button>
      </div>
      <p className="mt-1 font-display text-xs tabular-nums text-zinc-500 dark:text-zinc-500">
        Balance: {balance === null ? "—" : `${formatTick(balance)} TICK`}
      </p>

      {estimatedPayout !== null && minOk && (
        <div className="mt-3 rounded-xl border border-[#2E7CF6]/20 bg-[#2E7CF6]/6 p-3 text-sm dark:bg-[#2E7CF6]/8">
          <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
            <span>Est. payout if {OUTCOME_LABELS[outcome].toLowerCase()} wins</span>
            <span className="font-display font-bold tabular-nums text-[#1D4ED8] dark:text-[#7fe0bd]">
              {formatTick(estimatedPayout)} TICK
            </span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-600">
            Estimate only — final odds move as others stake. Winners split the pool minus fee.
          </p>
        </div>
      )}

      {step === "done" && (
        <p className="mt-3 rounded-xl bg-[#1D9E75]/12 p-3 text-sm font-medium text-[#0f7a55] dark:bg-[#1D9E75]/15 dark:text-[#7fe0bd]">
          Stake placed — good luck! Pool totals update live below.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      <button
        onClick={handleStake}
        disabled={busy || !minOk || !balanceOk}
        className={cn(
          "mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-all active:scale-[.98]",
          busy || !minOk || !balanceOk
            ? "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
            : "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_24px_rgba(46,124,246,.45)] hover:shadow-[0_0_36px_rgba(46,124,246,.6)]"
        )}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {step === "approving"
          ? "Approving TICK…"
          : step === "staking"
            ? "Staking…"
            : needsApproval
              ? `Approve & stake ${amount ? formatTick(amount, 0) : ""} TICK`
              : `Stake ${amount ? formatTick(amount, 0) : ""} TICK`}
      </button>
      <p className="mt-2 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
        Gasless — sent from your smart wallet, sponsored by TICKR.
      </p>
    </div>
  );
}

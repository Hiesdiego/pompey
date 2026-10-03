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
import { Loader2, Wallet, X } from "lucide-react";
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
import { toast } from "./Toast";
import {
  formatTick,
  parseTickInput,
  OUTCOME_LABELS,
  OUTCOME_SHORT,
} from "../lib/format";
import { cn } from "../lib/cn";
import { getPublicClient } from "../hooks/usePublicClient";
import { useContractWrite } from "../hooks/useContractWrite";

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
  bare = false,
}: {
  fixture: ApiFixture;
  pool: ApiPool | null;
  playerAddress: Address | null;
  balance: bigint | null;
  authenticated: boolean;
  onLogin: () => void;
  onStaked: () => void;
  /**
   * Render without the outer card chrome — for embedding inside a modal
   * shell (StakeModal) that provides its own card.
   */
  bare?: boolean;
}) {
  const [outcome, setOutcome] = useState<number>(0);
  const [amountStr, setAmountStr] = useState("10");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const { write, writeBatch } = useContractWrite();

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
  // Prize pool includes the protocol seed, which is paid into the winners'
  // pool at settlement but is not itself a selectable outcome.
  const seed = pool ? BigInt(pool.seed ?? "0") : 0n;
  const totalPool = (pool ? BigInt(pool.totalPool) : 0n) + seed;

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
      // Improvement B — when the allowance is short, batch approve+stake:
      // one userOp on smart wallets, sequential sponsored txs on embedded.
      // The approve grants a buffer (max amount × 10, 10k TICK) so later
      // stakes need no approve at all.
      const stakeCall = {
        to: CONTRACTS.predictionPool,
        abi: PREDICTION_POOL_ABI,
        functionName: "stake",
        args: [SEASON_ID, fixtureId, outcome, amount],
        label: "Stake",
      };
      if (needsApproval) {
        const floor = BigInt(10_000) * 10n ** 18n;
        const scaled = amount * 10n;
        const buffer =
          balance !== null && balance < floor
            ? balance > amount
              ? balance
              : amount
            : scaled > floor
              ? scaled
              : floor;
        await writeBatch(
          [
            {
              to: CONTRACTS.tickToken,
              abi: TICK_TOKEN_ABI,
              functionName: "approve",
              args: [CONTRACTS.predictionPool, buffer],
              label: "TICK approval",
            },
            stakeCall,
          ],
          {
            label: "Stake",
            onHashed: (hash) => {
              // Optimistic: toast at broadcast — receipt is awaited in the
              // background; the match page reconciles from queries.
              toast.success("Stake submitted ⚡", {
                detail: `${Number(amount / 10n ** 18n).toLocaleString()} TICK on ${OUTCOME_LABELS[outcome]}`,
                link: `https://sepolia.basescan.org/tx/${hash}`,
              });
            },
          }
        );
      } else {
        await write({
          ...stakeCall,
          onHashed: (hash) => {
            toast.success("Stake submitted ⚡", {
              detail: `${Number(amount / 10n ** 18n).toLocaleString()} TICK on ${OUTCOME_LABELS[outcome]}`,
              link: `https://sepolia.basescan.org/tx/${hash}`,
            });
          },
        });
      }
      setStep("done");
      onStaked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("idle");
      toast.error("Stake failed", err instanceof Error ? err.message : String(err));
    }
  };

  if (!authenticated) {
    return (
      <div
        className={
          bare
            ? "flex flex-col items-center gap-3 py-6 text-center"
            : "glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center"
        }
      >
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
    <div
      className={
        bare
          ? ""
          : "glass rounded-3xl p-5 shadow-[0_16px_45px_rgba(15,23,42,.06)] sm:p-6"
      }
    >
      <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#2E7CF6]">Your prediction</p><h3 className="mt-1 font-display text-lg font-extrabold text-zinc-900 dark:text-white">Place your stake</h3></div><span className="rounded-full bg-[#2E7CF6]/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-[#2E7CF6]">TICK</span></div>

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

      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Amount (TICK) — min {MIN_STAKE_TICK}
      </label>
      <div className="min-w-0">
        <input
          type="text"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          inputMode="decimal"
          aria-label="Stake amount in TICK"
          disabled={busy}
          className="w-full rounded-xl border border-black/10 bg-black/[.03] px-3 py-2.5 font-display text-lg font-bold tabular-nums text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:border-[#2E7CF6] focus:ring-2 focus:ring-[#2E7CF6]/40 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-zinc-600"
          placeholder="10"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {["10", "50", "100"].map((q) => (
            <button
              key={q}
              onClick={() => setAmountStr(q)}
              disabled={busy}
              className="rounded-xl border border-black/10 px-3 py-1.5 text-sm font-semibold text-zinc-600 transition-all hover:border-[#2E7CF6]/60 hover:text-[#1D4ED8] active:scale-95 dark:border-white/10 dark:text-zinc-300 dark:hover:border-[#2E7CF6]/60 dark:hover:text-[#7db3ff]"
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
            className="rounded-xl border border-black/10 px-3 py-1.5 text-sm font-semibold text-zinc-600 transition-all hover:border-[#2E7CF6]/60 hover:text-[#1D4ED8] active:scale-95 dark:border-white/10 dark:text-zinc-300 dark:hover:border-[#2E7CF6]/60 dark:hover:text-[#7db3ff]"
          >
            MAX
          </button>
        </div>
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
        {step === "staking"
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

/**
 * StakeModal — the match staking form in a fixed, viewport-centered modal.
 *
 * Opens wherever the user is on the page: fixed overlay, backdrop-click and
 * Escape to close, body scroll locked while open. Same shell pattern as
 * QuickStakeSheet (bottom sheet on mobile, centered card on desktop).
 */
export function StakeModal({
  fixture,
  pool,
  playerAddress,
  balance,
  authenticated,
  onLogin,
  onStaked,
  onClose,
}: {
  fixture: ApiFixture;
  pool: ApiPool | null;
  playerAddress: Address | null;
  balance: bigint | null;
  authenticated: boolean;
  onLogin: () => void;
  onStaked: () => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const r = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(r);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const title =
    fixture.home && fixture.away
      ? `${fixture.home.name} vs ${fixture.away.name}`
      : "Stake on this match";

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
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-[1.5rem] border border-black/10 bg-white p-5 pt-4 text-zinc-900 shadow-[0_28px_100px_rgba(0,0,0,.45)] transition-all duration-300 dark:border-white/10 dark:bg-[#101722] dark:text-white sm:p-6",
          mounted ? "translate-y-0 opacity-100 scale-100" : "translate-y-4 opacity-0 scale-95"
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#2E7CF6]">
              Your prediction
            </p>
            <h3 className="mt-1 truncate font-display text-lg font-extrabold">
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <StakePanel
          bare
          fixture={fixture}
          pool={pool}
          playerAddress={playerAddress}
          balance={balance}
          authenticated={authenticated}
          onLogin={onLogin}
          onStaked={() => {
            onStaked();
            onClose();
          }}
        />
      </div>
    </div>
  );
}

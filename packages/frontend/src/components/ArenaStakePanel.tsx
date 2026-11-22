"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Wallet, X } from "lucide-react";
import type { Address } from "viem";
import {
  ARENA_CLASH_FACTORY_ADDRESS,
  ARENA_MIN_STAKE_TICK,
  MEME_CLASH_FACTORY_ABI,
  arenaDisplaySymbol,
  type ClashDetail,
} from "../lib/arenaContracts";
import { CONTRACTS, TICK_TOKEN_ABI } from "../lib/contracts";
import { toast } from "./Toast";
import { formatTick, parseTickInput } from "../lib/format";
import { formatMarketOdds } from "../lib/marketOdds";
import { formatUtcDateTime } from "../lib/utcTime";
import { cn } from "../lib/cn";
import { getPublicClient } from "../hooks/usePublicClient";
import { useContractWrite } from "../hooks/useContractWrite";
import { StakeDialog } from "./StakeDialog";
import { CONFIRM_THRESHOLD_WEI, LargeStakeConfirm } from "./LargeStakeConfirm";

/**
 * ArenaStakePanel and ArenaStakeModal.
 *
 * Target locations in the repo:
 *   packages/frontend/src/components/ArenaStakePanel.tsx
 *
 * This is the Arena mirror of StockStakePanel in ./StockStakePanel.tsx:
 * same layout, same outcome buttons, same amount row, same estimated
 * payout box, same approve then stake flow with the large-stake
 * confirm, same gasless copy, same StakeDialog modal shell. It cannot
 * reuse the stock panel directly because that panel is typed on
 * StockApiFixture and StockApiPool and stakes on the stock prediction
 * pool with three outcomes (1, X, 2). A clash stakes on the
 * MemeClashFactory with two outcomes (0 = Yes, 1 = No), and its fee is
 * the factory fee split (treasuryFeeBps plus creatorFeeBps plus
 * resolverFeeBps, read on-chain) instead of a single platformFeeBps.
 *
 * Locked Arena differences inside this mirror:
 *   - Outcomes are Yes and No on the outperformance question. Yes wins
 *     only on a strictly greater percent move, an exact tie is No.
 *   - Staking closes at window start. The page only opens this panel
 *     before the window starts, and the factory reverts stake() at or
 *     after windowStart with BettingClosed.
 *   - The approval is for the exact stake amount, because the factory
 *     pulls the stake by transferFrom in the same call shape the old
 *     Arena delivery used. The stock panel's approval buffer is a
 *     stock pool behaviour and is not carried over.
 */

const OUTCOME_ACTIVE = [
  "border-[#2E7CF6] bg-[#2E7CF6]/12 text-[#1D4ED8] shadow-[0_0_18px_rgba(46,124,246,.25)] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]",
  "border-[#1D9E75] bg-[#1D9E75]/12 text-[#0f7a55] dark:bg-[#1D9E75]/15 dark:text-[#7fe0bd]",
];
const OUTCOME_IDLE =
  "border-black/10 bg-black/[.02] text-zinc-500 hover:border-[#2E7CF6]/40 hover:text-zinc-800 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-400 dark:hover:border-[#2E7CF6]/40 dark:hover:text-zinc-200";
const OUTCOME_LABELS = ["Yes", "No"] as const;

type Step = "idle" | "approving" | "staking" | "done";

export function ArenaStakePanel({
  clash,
  playerAddress,
  balance,
  authenticated,
  onLogin,
  onStaked,
  bare = false,
}: {
  clash: ClashDetail;
  playerAddress: Address | null;
  balance: bigint | null;
  authenticated: boolean;
  onLogin: () => void;
  onStaked: () => void;
  bare?: boolean;
}) {
  const [outcome, setOutcome] = useState<number>(0);
  const [amountStr, setAmountStr] = useState("10");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [feeBps, setFeeBps] = useState<number | null>(null);
  const { write, writeBatch } = useContractWrite();

  const clashId = BigInt(clash.id);
  const amount = useMemo(() => parseTickInput(amountStr), [amountStr]);
  useEffect(() => {
    if (!ARENA_CLASH_FACTORY_ADDRESS) return;
    let alive = true;
    const client = getPublicClient();
    Promise.all([
      client.readContract({ address: ARENA_CLASH_FACTORY_ADDRESS, abi: MEME_CLASH_FACTORY_ABI, functionName: "treasuryFeeBps" }),
      client.readContract({ address: ARENA_CLASH_FACTORY_ADDRESS, abi: MEME_CLASH_FACTORY_ABI, functionName: "creatorFeeBps" }),
      client.readContract({ address: ARENA_CLASH_FACTORY_ADDRESS, abi: MEME_CLASH_FACTORY_ABI, functionName: "resolverFeeBps" }),
    ]).then(([treasury, creator, resolver]) => {
      if (alive) setFeeBps(Number(treasury) + Number(creator) + Number(resolver));
    }).catch(() => {
      if (alive) setFeeBps(null);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!playerAddress || !CONTRACTS.tickToken || !ARENA_CLASH_FACTORY_ADDRESS) {
      setAllowance(null);
      return;
    }
    getPublicClient()
      .readContract({
        address: CONTRACTS.tickToken,
        abi: TICK_TOKEN_ABI,
        functionName: "allowance",
        args: [playerAddress, ARENA_CLASH_FACTORY_ADDRESS],
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

  const totals = clash.outcomeTotals.map((t) => {
    try {
      return BigInt(t);
    } catch {
      return 0n;
    }
  });
  const seed = (() => {
    try {
      return BigInt(clash.seedAmount);
    } catch {
      return 0n;
    }
  })();
  const totalPool = totals.reduce((sum, value) => sum + value, 0n) + seed;

  const estimatedPayout = useMemo(() => {
    if (!amount || feeBps === null || feeBps < 0 || feeBps > 10_000) return null;
    const w = totals[outcome] ?? 0n;
    const T = totalPool + amount;
    const distributable = (T * BigInt(10_000 - feeBps)) / 10_000n;
    return (amount * distributable) / (w + amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, outcome, totalPool, feeBps]);

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
    if (!CONTRACTS.tickToken || !ARENA_CLASH_FACTORY_ADDRESS) {
      setError("Arena contract addresses not configured, fill in .env.local.");
      return;
    }
    if (!amount) {
      setError("Enter a valid stake amount.");
      return;
    }
    if (amount < BigInt(ARENA_MIN_STAKE_TICK) * 10n ** 18n) {
      setError(`Minimum stake is ${ARENA_MIN_STAKE_TICK} TICK.`);
      return;
    }
    if (!balanceOk) {
      setError("Insufficient TICK balance, use the faucet in the header.");
      return;
    }
    if (amount >= CONFIRM_THRESHOLD_WEI && !confirming) {
      setConfirming(true);
      return;
    }
    try {
      const factory = ARENA_CLASH_FACTORY_ADDRESS as Address;
      const tickToken = CONTRACTS.tickToken as Address;
      const stakeCall = {
        to: factory,
        abi: MEME_CLASH_FACTORY_ABI,
        functionName: "stake",
        args: [clashId, BigInt(outcome), amount],
        label: "Stake",
      };
      if (needsApproval) {
        setStep("approving");
        await writeBatch(
          [
            { to: tickToken, abi: TICK_TOKEN_ABI, functionName: "approve", args: [factory, amount], label: "TICK approval" },
            stakeCall,
          ],
          { label: "Approve and stake" }
        );
      } else {
        setStep("staking");
        await write(stakeCall);
      }
      setStep("done");
      setConfirming(false);
      toast.success("Stake placed", { detail: `${formatTick(amount, 0)} TICK on ${OUTCOME_LABELS[outcome]}` });
      onStaked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("idle");
      setConfirming(false);
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
          Sign in to stake on this clash
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

  if (confirming) {
    return (
      <LargeStakeConfirm
        amount={formatTick(amount ?? 0n)}
        outcome={OUTCOME_LABELS[outcome]}
        busy={busy}
        onBack={() => setConfirming(false)}
        onConfirm={handleStake}
      />
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

      <div className="mb-4 grid grid-cols-2 gap-2">
        {[
          { label: "Yes", sub: `${arenaDisplaySymbol(clash.memeSymbol)} outperforms`, o: 0 },
          { label: "No", sub: "Tie or opponent ahead", o: 1 },
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
            <div className="mt-1 font-display text-sm font-black tabular-nums">{formatMarketOdds(clash.multipliers?.[opt.o] ?? null)}</div>
          </button>
        ))}
      </div>

      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Amount (TICK), min {ARENA_MIN_STAKE_TICK}
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
        Balance: {balance === null ? "–" : `${formatTick(balance)} TICK`}
      </p>

      {estimatedPayout !== null && minOk && (
        <div className="mt-3 rounded-xl border border-[#2E7CF6]/20 bg-[#2E7CF6]/6 p-3 text-sm dark:bg-[#2E7CF6]/8">
          <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
            <span>Est. payout if {OUTCOME_LABELS[outcome]} wins</span>
            <span className="font-display font-bold tabular-nums text-[#1D4ED8] dark:text-[#7fe0bd]">
              {formatTick(estimatedPayout)} TICK
            </span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-600">
            Estimate only, final odds move as others stake. Winners split the pool minus fees.
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
        disabled={busy || !minOk || !balanceOk}
        aria-busy={busy}
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
        Gasless, sent from your smart wallet, sponsored by TICKR. Staking closes at window start, {formatUtcDateTime(clash.windowStart * 1000)} UTC.
      </p>
    </div>
  );
}

export function ArenaStakeModal({
  clash,
  playerAddress,
  balance,
  authenticated,
  onLogin,
  onStaked,
  onReady,
  onClose,
}: {
  clash: ClashDetail;
  playerAddress: Address | null;
  balance: bigint | null;
  authenticated: boolean;
  onLogin: () => void;
  onStaked: () => void;
  onReady?: () => void;
  onClose: () => void;
}) {
  const memeName = clash.memeName ?? arenaDisplaySymbol(clash.memeSymbol);
  const oppName = clash.opponentName ?? arenaDisplaySymbol(clash.opponentSymbol);
  const title = `${memeName} vs ${oppName}`;

  return (
    <StakeDialog title={title} onClose={onClose} onReady={onReady}>
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
        <ArenaStakePanel
          bare
          clash={clash}
          playerAddress={playerAddress}
          balance={balance}
          authenticated={authenticated}
          onLogin={() => { onClose(); onLogin(); }}
          onStaked={() => {
            onStaked();
            onClose();
          }}
        />
    </StakeDialog>
  );
}

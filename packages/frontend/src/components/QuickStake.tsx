/**
 * QuickStake — stake from the markets board without opening market details.
 *
 * A `QuickStakeChips` strip renders on each open market card (desktop:
 * revealed on hover; mobile: always visible). Tapping a chip opens a
 * compact bottom-sheet (dialog on desktop) with just amount + estimated
 * payout + a single confirm. The transaction path is identical to the
 * detail page: approve-if-needed → stake, both gas-sponsored via
 * useContractWrite.
 *
 * MarketFactory chips show a seed-aware, post-fee 10 TICK projection.
 * The sheet recalculates for the entered stake; match pools use their own
 * fee rule and show no chip quote before the pool is loaded.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck, X, Zap } from "lucide-react";
import type { Address } from "viem";
import { marketOdds, formatMarketOdds } from "../lib/marketOdds";
import { PLATFORM_FEE_BPS } from "@tickr/shared/constants";
import {
  CONTRACTS,
  PREDICTION_POOL_ABI,
  SEASON_ID,
  TICK_TOKEN_ABI,
} from "../lib/contracts";
import {
  MARKET_FACTORY_ABI,
  MARKET_FACTORY_ADDRESS,
  FACTORY_MIN_STAKE_TICK,
} from "../lib/marketFactory";
import { MIN_STAKE_TICK } from "../lib/contracts";
import { cn } from "../lib/cn";
import { getPublicClient } from "../hooks/usePublicClient";
import { useContractWrite } from "../hooks/useContractWrite";
import { useTickBalance } from "../lib/query/useTickBalance";
import { useTickr } from "../hooks/useTickr";
import { queryClient } from "../lib/query/queryClient";
import { qks } from "../lib/query/keys";
import { toast } from "./Toast";
import { TeamBadge } from "./TeamBadge";
import { StakeDialog } from "./StakeDialog";

const QUICK_AMOUNTS = [25, 100, 250, 1000];

/**
 * Stakes at or above this many TICK require an explicit in-app confirm step
 * before the (silent) wallet signature fires. Below it, "Stake" submits
 * immediately — one tap, no modal. Gas is sponsored either way.
 */
export const CONFIRM_THRESHOLD_TICK = 500;

/** Basescan link for a tx hash on the active chain. */
function explorerTxUrl(hash: string): string {
  return `https://sepolia.basescan.org/tx/${hash}`;
}

/**
 * Which staking contract the sheet targets:
 * - "factory": permissionless v0.3 markets via MarketFactory.stake(marketId, outcome, amount)
 * - "match":   PredictionPool 1/X/2 via stake(seasonId, fixtureId, outcome, amount)
 */
export type QuickStakeVariant = "factory" | "match";

export interface QuickStakeOutcome {
  index: number;
  label: string;
  /** 0–100 share of staked volume, used only for the thin pool bar. */
  share: number;
  odds?: number | null;
  total: bigint;
  teamId: number | null;
}

/** Estimated payout if the picked outcome wins (detail-page formula). */
function potentialWin(
  amountTick: number,
  outcomeTotal: bigint,
  totalStaked: bigint,
  seedAmount: bigint,
  feesBps: readonly [number, number, number] | null
): { win: number; multiple: number } {
  if (amountTick <= 0 || !feesBps) return { win: 0, multiple: 0 };
  const quote = marketOdds({ stake: BigInt(Math.round(amountTick * 1e18)), sideStaked: outcomeTotal, totalStaked, seed: seedAmount, feesBps });
  return quote ? { win: Number(quote.payout) / 1e18, multiple: quote.multiplier } : { win: 0, multiple: 0 };
}

// ── the sheet ───────────────────────────────────────────────────────

export function QuickStakeSheet({
  marketId,
  question,
  outcome,
  outcomeTotals,
  totalStaked,
  seedAmount,
  feesBps = null,
  variant = "factory",
  onClose,
}: {
  /** Factory: market id. Match: fixture id (global id is derived inside). */
  marketId: bigint;
  question: string;
  outcome: QuickStakeOutcome | null;
  outcomeTotals: bigint[];
  totalStaked: bigint;
  seedAmount: bigint;
  feesBps?: readonly [number, number, number] | null;
  variant?: QuickStakeVariant;
  onClose: () => void;
}) {
  const { playerAddress, authenticated, login } = useTickr();
  const { balance } = useTickBalance(playerAddress ?? null);
  const { writeBatch, pending: busy, clearError } = useContractWrite();
  const [amountStr, setAmountStr] = useState("25");
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  /** "form" → direct submit; "confirm" → explicit step for large stakes. */
  const [stage, setStage] = useState<"form" | "confirm">("form");

  const amountNum = Number(amountStr) || 0;
  const amountWei = BigInt(Math.round(amountNum * 1e18));

  // Allowance read (approve defensively when unknown — approve is idempotent).
  useEffect(() => {
    let alive = true;
    if (!playerAddress || !CONTRACTS.tickToken || !MARKET_FACTORY_ADDRESS) {
      setAllowance(null);
      return;
    }
    getPublicClient()
      .readContract({
        address: CONTRACTS.tickToken,
        abi: TICK_TOKEN_ABI,
        functionName: "allowance",
        args: [playerAddress, MARKET_FACTORY_ADDRESS],
      })
      .then((v) => alive && setAllowance(v as bigint))
      .catch(() => alive && setAllowance(null));
    return () => { alive = false; };
  }, [playerAddress]);

  const needsApproval = amountWei > 0n && (allowance === null || allowance < amountWei);
  const balanceOk = balance === null || amountWei <= balance;
  const minTick = variant === "match" ? MIN_STAKE_TICK : FACTORY_MIN_STAKE_TICK;
  const valid = amountNum >= minTick && balanceOk && (variant === "match" || feesBps !== null);
  const balanceTick = balance !== null ? Number(balance) / 1e18 : null;

  const est = useMemo(
    () =>
      outcome
        ? variant === "match"
          ? (() => { const stake = BigInt(Math.round(amountNum * 1e18)); const side = (outcomeTotals[outcome.index] ?? 0n) + stake; if (stake <= 0n || side <= 0n) return { win: 0, multiple: 0 }; const pool = (totalStaked + stake + seedAmount) * BigInt(10_000 - PLATFORM_FEE_BPS) / 10_000n; const win = Number(stake * pool / side) / 1e18; return { win, multiple: win / amountNum }; })()
          : potentialWin(amountNum, outcomeTotals[outcome.index] ?? 0n, totalStaked, seedAmount, feesBps)
        : { win: 0, multiple: 0 },
    [amountNum, outcome, outcomeTotals, totalStaked, seedAmount, feesBps, variant]
  );

  async function submit() {
    if (!outcome || !playerAddress || !valid) return;
    setTxError(null);
    // Large stakes get one explicit confirmation; everything else is one-tap.
    if (amountNum >= CONFIRM_THRESHOLD_TICK && stage !== "confirm") {
      setStage("confirm");
      return;
    }
    const isMatch = variant === "match";
    const spender = isMatch ? CONTRACTS.predictionPool : MARKET_FACTORY_ADDRESS;
    if (!spender) {
      toast.error("Staking contract is not deployed on this network.");
      return;
    }
    const label = outcome.label;
    const amountTick = amountNum;
    const onStakeHashed = (hash: string) => {
      // Fires at BROADCAST — the receipt can take seconds; the UI never
      // blocks on it. Queries reconcile whenever it lands.
      toast.success("Stake submitted ⚡", {
        detail: `${amountTick.toLocaleString()} TICK on ${label}`,
        link: explorerTxUrl(hash),
      });
      onClose();
    };
    // Improvement B — approval buffer: when an approve is needed we grant
    // max(amount × 10, 10k TICK) instead of the exact amount, so subsequent
    // stakes skip the approve entirely. On smart wallets the approve+stake
    // calls land as ONE batched userOp; on embedded wallets they run as
    // sequential sponsored txs (nonce-ordered, approve mines first).
    const approvalBuffer = (() => {
      const floor = BigInt(10_000) * 10n ** 18n;
      const scaled = amountWei * 10n;
      // Cap the buffer at the balance (faucet-limited) to avoid pointless
      // oversized grants — a 10k buffer is plenty for repeated staking.
      if (balance !== null && balance < floor) return balance > amountWei ? balance : amountWei;
      return scaled > floor ? scaled : floor;
    })();
    const stakeCall = isMatch
      ? {
          address: CONTRACTS.predictionPool as `0x${string}`,
          abi: PREDICTION_POOL_ABI,
          functionName: "stake",
          args: [SEASON_ID, marketId, BigInt(outcome.index), amountWei],
          label: "Stake",
        }
      : {
          address: MARKET_FACTORY_ADDRESS!,
          abi: MARKET_FACTORY_ABI,
          functionName: "stake",
          args: [marketId, BigInt(outcome.index), amountWei],
          label: "Stake",
        };
    try {
      clearError();
      if (needsApproval) {
        await writeBatch(
          [
            {
              address: CONTRACTS.tickToken as `0x${string}`,
              abi: TICK_TOKEN_ABI,
              functionName: "approve",
              args: [spender, approvalBuffer],
              label: "TICK approval",
            },
            stakeCall,
          ],
          { label: "Approve & stake", onHashed: onStakeHashed }
        );
        // Local allowance state now covers future stakes — no re-read wait.
        setAllowance(approvalBuffer);
      } else {
        await writeBatch([stakeCall], { label: "Stake", onHashed: onStakeHashed });
      }
      // Reconcile optimistically shown pools + balance.
      void queryClient.invalidateQueries({ queryKey: qks.market(marketId.toString()) });
      void queryClient.invalidateQueries({ queryKey: qks.markets });
      void queryClient.invalidateQueries({
        queryKey: qks.balance(playerAddress.toLowerCase()),
      });
    } catch (err) {
      // Failure feedback: if the sheet is still open the inline error shows
      // too; if it already closed (toast fired at broadcast, then a revert
      // came back), this error toast is the only visible signal.
      const msg = err instanceof Error ? err.message : String(err);
      setTxError(msg);
      toast.error("Stake failed", msg);
      void queryClient.invalidateQueries({
        queryKey: qks.balance(playerAddress.toLowerCase()),
      });
    }
  }

  if (!outcome) return null;

  return (
    <StakeDialog title={`Quick stake: ${question}`} onClose={onClose}>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-200"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {stage === "confirm" ? (
          /* Explicit confirm step — only for stakes ≥ CONFIRM_THRESHOLD_TICK */
          <div className="py-4 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-amber-500/15 text-amber-500">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h3 className="font-display text-xl font-extrabold">Confirm large stake</h3>
            <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
              You're about to stake{" "}
              <span className="font-bold text-zinc-900 dark:text-white">
                {amountNum.toLocaleString()} TICK
              </span>{" "}
              on <span className="font-bold text-zinc-900 dark:text-white">{outcome.label}</span>.
              This locks funds until the market settles.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setStage("form")}
                disabled={busy}
                className="flex-1 rounded-xl border border-black/10 py-3 text-sm font-bold text-zinc-600 transition-colors hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              >
                Back
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className={cn(
                  "flex-1 rounded-xl py-3 text-sm font-extrabold text-white transition-all active:scale-[.98]",
                  busy
                    ? "cursor-not-allowed bg-zinc-400 dark:bg-zinc-700"
                    : "gradient-cta shadow-[0_0_24px_rgba(46,124,246,0.4)]"
                )}
              >
                {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Confirm stake"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pr-8">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                <Zap className="h-3 w-3 text-[#2E7CF6]" /> Quick stake
              </div>
              <div className="mt-1 line-clamp-2 font-display text-base font-extrabold leading-snug text-zinc-900 dark:text-white sm:text-lg">
                {question}
              </div>
            </div>

            {/* Selected outcome */}
            <div className="mt-3 flex items-center justify-between rounded-xl border border-[#2E7CF6]/30 bg-[#2E7CF6]/10 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                {outcome.teamId !== null ? (
                  <TeamBadge teamId={outcome.teamId} size={34} showName={false} />
                ) : (
                  <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[#2E7CF6]/15 font-display text-xs font-extrabold text-[#2E7CF6]">
                    {outcome.index + 1}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="truncate font-display text-base font-extrabold">{outcome.label}</div>
                  <div className="text-xs text-zinc-500 dark:text-white/50">Projected payout odds</div>
                </div>
              </div>
              <div className="ml-3 text-right">
                <div className="font-display text-2xl font-black tabular-nums text-[#1D4ED8] dark:text-[#75aaff]">
                  {formatMarketOdds(est.multiple > 0 ? est.multiple : null)}
                </div>
                <div className="text-[10px] font-bold tabular-nums text-zinc-500">
                  {amountNum > 0 ? `For ${amountNum} TICK` : "Enter a stake"} · includes fees and seed
                </div>
              </div>
            </div>

            {!authenticated ? (
              <button
                onClick={() => { onClose(); login(); }}
                className="gradient-cta mt-4 w-full rounded-xl py-3 text-sm font-bold text-white"
              >
                Sign in to stake
              </button>
            ) : (
              <>
                {/* Amount */}
                <div className="mt-4">
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                      Amount
                    </label>
                    {balanceTick !== null && (
                      <span className="text-[11px] font-semibold tabular-nums text-zinc-500">
                        Balance: {balanceTick.toLocaleString(undefined, { maximumFractionDigits: 0 })} TICK
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={minTick}
                      value={amountStr}
                      onChange={(e) => setAmountStr(e.target.value)}
                      className={cn(
                        "w-full rounded-xl border bg-transparent px-4 py-3 font-display text-lg font-extrabold tabular-nums outline-none transition-colors",
                        "focus:border-[#2E7CF6]",
                        balanceOk
                          ? "border-black/10 dark:border-white/10"
                          : "border-red-400 dark:border-red-500"
                      )}
                    />
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-400">
                      TICK
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {QUICK_AMOUNTS.map((q) => (
                      <button
                        key={q}
                        onClick={() => setAmountStr(String(q))}
                        className={cn(
                          "rounded-lg border px-2.5 py-1 text-xs font-bold tabular-nums transition-colors",
                          Number(amountStr) === q
                            ? "border-[#2E7CF6] bg-[#2E7CF6]/10 text-[#1D4ED8] dark:text-[#7db3ff]"
                            : "border-black/10 text-zinc-500 hover:border-[#2E7CF6]/40 hover:text-zinc-800 dark:border-white/10 dark:text-zinc-400 dark:hover:text-zinc-200"
                        )}
                      >
                        {q}
                      </button>
                    ))}
                    <button
                      onClick={() => balanceTick !== null && setAmountStr(String(Math.floor(balanceTick)))}
                      disabled={balanceTick === null || balanceTick <= 0}
                      title={balanceTick !== null && balanceTick > 0 ? "Stake your full balance" : "No TICK balance"}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-40",
                        balanceTick !== null && Number(amountStr) === Math.floor(balanceTick) && balanceTick > 0
                          ? "border-[#2E7CF6] bg-[#2E7CF6]/10 text-[#1D4ED8] dark:text-[#7db3ff]"
                          : "border-black/10 text-zinc-500 hover:border-[#2E7CF6]/40 hover:text-zinc-800 dark:border-white/10 dark:text-zinc-400 dark:hover:text-zinc-200"
                      )}
                    >
                      MAX
                    </button>
                  </div>
                </div>

                {/* Estimated payout */}
                <div className="mt-4 flex items-center justify-between rounded-xl bg-emerald-500/[.08] px-4 py-3">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Est. payout if it wins
                  </span>
                  <span className="font-display text-base font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {est.win > 0 ? `${est.win.toLocaleString(undefined, { maximumFractionDigits: 1 })} TICK` : "—"}
                    {est.multiple >= 1 && (
                      <span className="ml-1.5 text-xs font-bold opacity-70">{est.multiple.toFixed(2)}×</span>
                    )}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">Projection at the latest pool snapshot. Final odds can move before betting closes; multi-winner results may pay less.</p>

                {!balanceOk && (
                  <p className="mt-3 rounded-xl bg-amber-500/[.07] px-4 py-2.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                    Not enough TICK. Grab some from the faucet in the header.
                  </p>
                )}
                {variant === "factory" && !feesBps && <p className="mt-3 text-xs font-semibold text-amber-600 dark:text-amber-300">Fetching current market fees before staking…</p>}
                {amountNum > 0 && amountNum < minTick && (
                  <p className="mt-3 rounded-xl bg-amber-500/[.07] px-4 py-2.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                    Minimum stake is {minTick} TICK.
                  </p>
                )}
                {txError && (
                  <p className="mt-3 rounded-xl bg-red-500/[.07] px-4 py-2.5 text-xs font-semibold text-red-600 dark:text-red-400">
                    {txError}
                  </p>
                )}

                <button
                  onClick={submit}
                  disabled={busy || !valid}
                  className={cn(
                    "mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-display text-base font-extrabold text-white transition-all active:scale-[.98]",
                    busy || !valid
                      ? "cursor-not-allowed bg-zinc-400 dark:bg-zinc-700"
                      : "gradient-cta shadow-[0_0_24px_rgba(46,124,246,0.4)] hover:shadow-[0_0_32px_rgba(46,124,246,0.6)]"
                  )}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {busy
                    ? "Submitting…"
                    : needsApproval
                      ? `Approve & stake ${amountNum || 0} TICK`
                      : `Stake ${amountNum || 0} TICK`}
                </button>
                <p className="mt-2.5 flex items-center justify-center gap-1 text-center text-[10px] text-zinc-400">
                  <ShieldCheck className="h-3 w-3" />
                  {amountNum >= CONFIRM_THRESHOLD_TICK
                    ? `Stakes of ${CONFIRM_THRESHOLD_TICK}+ TICK ask for one extra tap`
                    : "One tap · gas sponsored · no wallet popup"}
                </p>
              </>
            )}
          </>
        )}
    </StakeDialog>
  );
}

// ── card chips ──────────────────────────────────────────────────────

/**
 * Quick-stake chips for a market card. Renders the top 3 outcomes by pool
 * share. Desktop: fades in on card hover. Mobile: always visible.
 * Each chip opens the QuickStakeSheet via `onPick`.
 */
export function QuickStakeChips({
  outcomes,
  bettingOpen,
  onPick,
}: {
  outcomes: QuickStakeOutcome[];
  bettingOpen: boolean;
  onPick: (o: QuickStakeOutcome) => void;
}) {
  if (!bettingOpen || outcomes.length === 0) return null;
  const top = outcomes.slice(0, 3);

  return (
    <div
      className={cn(
        "relative flex flex-wrap items-center gap-1.5",
        // Mobile: always visible; sm+: hidden until the card is hovered/focused.
        "opacity-100 sm:opacity-0 sm:transition-opacity sm:duration-200",
        "sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
      )}
    >
      {top.map((o) => (
        <button
          key={o.index}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPick(o);
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-[#2E7CF6]/25 bg-[#2E7CF6]/[.06] px-2.5 py-1 text-[11px] font-bold text-zinc-700 transition-all active:scale-95",
            "hover:border-[#2E7CF6] hover:bg-[#2E7CF6]/15 hover:text-[#1D4ED8]",
            "dark:border-[#2E7CF6]/30 dark:bg-[#2E7CF6]/10 dark:text-zinc-200 dark:hover:border-[#2E7CF6] dark:hover:text-[#7db3ff]"
          )}
          title={`Quick-stake on ${o.label}${o.odds != null ? ` — projected ${formatMarketOdds(o.odds)} for 10 TICK` : ""}`}
        >
          {o.teamId !== null ? (
            <TeamBadge teamId={o.teamId} size={16} showName={false} />
          ) : (
            <span className="text-[9px] font-extrabold text-[#2E7CF6]">{o.index + 1}</span>
          )}
          <span className="max-w-20 truncate">{o.label}</span>
          <span className="font-display tabular-nums text-[#2E7CF6] dark:text-[#7db3ff]">
            {o.odds == null ? "Pick" : formatMarketOdds(o.odds)}
          </span>
        </button>
      ))}
      <span className="hidden items-center gap-1 pl-0.5 text-[10px] font-bold uppercase tracking-wider text-[#2E7CF6] sm:flex">
        <Zap className="h-3 w-3" /> Quick
      </span>
    </div>
  );
}

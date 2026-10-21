/**
 * Cup staking panels — tournament-gold themed.
 *
 * CupMatchStakePanel: binary (no draws) staking on one cup match.
 * CupOutrightPanel: pick the tournament champion (open until the final
 * kicks off). Both use the gas-sponsored write path + TICK approve flow,
 * mirroring the league's StakePanel.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Trophy, Wallet } from "lucide-react";
import type { Address } from "viem";
import {
  CUP_CONTRACTS,
  CUP_FEE_BPS,
  CUP_MIN_STAKE_TICK,
  CUP_POOL_ABI,
  CUP_STATE,
  CUP_TBD,
  CUP_TEAMS,
  CUP_TEAM_SYMBOLS,
  cupTeamName,
  TICK_TOKEN_ABI,
} from "../lib/cup";
import type { CupMatch } from "../hooks/useCupBracket";
import { useCupMatchPool, useCupOutrightTotals } from "../hooks/useCupPool";
import { formatTick, parseTickInput } from "../lib/format";
import { cn } from "../lib/cn";
import { getPublicClient } from "../hooks/usePublicClient";
import { useContractWrite } from "../hooks/useContractWrite";
import { CupTeamBadge } from "./CupTeamBadge";

type Step = "idle" | "approving" | "staking" | "claiming" | "done";

function SignInPrompt({ onLogin, label }: { onLogin: () => void; label: string }) {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
      <Wallet className="h-8 w-8 text-amber-400/60" />
      <p className="font-display font-semibold text-zinc-800 dark:text-zinc-200">{label}</p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Privy login is gasless — your smart wallet covers transaction fees.
      </p>
      <button
        onClick={onLogin}
        className="rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-6 py-2.5 text-sm font-bold text-black shadow-[0_0_20px_rgba(251,191,36,.4)] transition-all hover:shadow-[0_0_28px_rgba(251,191,36,.55)] active:scale-[.97]"
      >
        Sign in
      </button>
    </div>
  );
}

function useTickAllowance(
  playerAddress: Address | null,
  spender: Address | "",
  step: Step
): bigint | null {
  const [allowance, setAllowance] = useState<bigint | null>(null);
  useEffect(() => {
    let alive = true;
    if (!playerAddress || !CUP_CONTRACTS.tickToken || !spender) {
      setAllowance(null);
      return;
    }
    getPublicClient()
      .readContract({
        address: CUP_CONTRACTS.tickToken,
        abi: TICK_TOKEN_ABI,
        functionName: "allowance",
        args: [playerAddress, spender],
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
  }, [playerAddress, spender, step]);
  return allowance;
}

/** Estimated payout: a·(T+a)·(1−fee)/(w+a) — mirrors CupPool.claim math. */
function estimatedPayout(amount: bigint, winningTotal: bigint, poolTotal: bigint): bigint {
  const distributable = (poolTotal * BigInt(10_000 - CUP_FEE_BPS)) / 10_000n;
  return (amount * distributable) / (winningTotal + amount);
}

// ── Per-match binary panel ───────────────────────────────────────────────────

export function CupMatchStakePanel({
  match,
  initialSide = 0,
  playerAddress,
  balance,
  authenticated,
  onLogin,
  onStaked,
}: {
  match: CupMatch;
  initialSide?: 0 | 1;
  playerAddress: Address | null;
  balance: bigint | null;
  authenticated: boolean;
  onLogin: () => void;
  onStaked: () => void;
}) {
  const [side, setSide] = useState<0 | 1>(initialSide);
  const [amountStr, setAmountStr] = useState("10");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const { write } = useContractWrite();
  const { pool, myStakeA, myStakeB, reload } = useCupMatchPool(match.matchId, playerAddress);
  const allowance = useTickAllowance(playerAddress, CUP_CONTRACTS.pool, step);

  const amount = useMemo(() => parseTickInput(amountStr), [amountStr]);
  const now = Date.now();
  const bettingOpen =
    match.teamA !== CUP_TBD &&
    match.teamB !== CUP_TBD &&
    (match.state === CUP_STATE.Created || match.state === CUP_STATE.Open) &&
    (match.kickoffMs === 0 || now < match.kickoffMs);
  const settled = match.state === CUP_STATE.Settled || pool?.settled;

  const totals: [bigint, bigint] = pool ? [pool.totalA, pool.totalB] : [0n, 0n];
  const seed = pool?.seed ?? 0n;
  const totalPool = totals[0] + totals[1] + seed;

  const iWon =
    settled &&
    pool?.winner !== undefined &&
    pool.winner !== CUP_TBD &&
    ((pool.winner === match.teamA && (myStakeA ?? 0n) > 0n) ||
      (pool.winner === match.teamB && (myStakeB ?? 0n) > 0n));

  const needsApproval = amount !== null && (allowance === null || allowance < amount);
  const balanceOk = amount !== null && balance !== null && balance >= amount;
  const busy = step === "approving" || step === "staking" || step === "claiming";

  const handleStake = async () => {
    setError(null);
    if (!playerAddress) return setError("Connect your wallet first.");
    if (!CUP_CONTRACTS.tickToken || !CUP_CONTRACTS.pool)
      return setError("Cup contracts not configured.");
    if (!amount) return setError("Enter a valid stake amount.");
    if (amount < BigInt(CUP_MIN_STAKE_TICK) * 10n ** 18n)
      return setError(`Minimum stake is ${CUP_MIN_STAKE_TICK} TICK.`);
    if (!balanceOk) return setError("Insufficient TICK balance.");
    try {
      if (needsApproval) {
        setStep("approving");
        await write({
          to: CUP_CONTRACTS.tickToken,
          abi: TICK_TOKEN_ABI,
          functionName: "approve",
          args: [CUP_CONTRACTS.pool, amount],
          label: "TICK approval",
        });
      }
      setStep("staking");
      await write({
        to: CUP_CONTRACTS.pool,
        abi: CUP_POOL_ABI,
        functionName: "stakeMatch",
        args: [match.matchId, side, amount],
        label: "Cup stake",
      });
      setStep("done");
      onStaked();
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("idle");
    }
  };

  const handleClaim = async () => {
    setError(null);
    if (!CUP_CONTRACTS.pool) return;
    try {
      setStep("claiming");
      await write({
        to: CUP_CONTRACTS.pool,
        abi: CUP_POOL_ABI,
        functionName: "claimMatch",
        args: [match.matchId],
        label: "Claim cup winnings",
      });
      setStep("done");
      onStaked();
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("idle");
    }
  };

  if (!authenticated) {
    return <SignInPrompt onLogin={onLogin} label="Sign in to stake on this match" />;
  }

  const labelA = CUP_TEAM_SYMBOLS[match.teamA] ?? "TBA";
  const labelB = CUP_TEAM_SYMBOLS[match.teamB] ?? "TBA";

  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="mb-1 font-display text-base font-bold text-zinc-900 dark:text-white">
        Back a winner
      </h3>

      {bettingOpen && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {(
              [
                { label: labelA, s: 0 as const },
                { label: labelB, s: 1 as const },
              ]
            ).map((opt) => (
              <button
                key={opt.s}
                onClick={() => setSide(opt.s)}
                disabled={busy}
                className={cn(
                  "rounded-xl border-2 px-2 py-3 text-center transition-all active:scale-[.97]",
                  side === opt.s
                    ? "border-amber-400 bg-amber-400/15 text-amber-700 shadow-[0_0_18px_rgba(251,191,36,.3)] dark:text-amber-300"
                    : "border-black/10 bg-black/[.02] text-zinc-500 hover:border-amber-400/40 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-400"
                )}
              >
                <div className="flex justify-center"><CupTeamBadge teamId={opt.s === 0 ? match.teamA : match.teamB} size={28} showName={false} /></div>
                <div className="mt-1 truncate font-display text-sm font-black">{cupTeamName(opt.s === 0 ? match.teamA : match.teamB)}</div>
                <div className="text-[11px] tabular-nums opacity-80">
                  {formatTick(totals[opt.s])} TICK
                </div>
              </button>
            ))}
          </div>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Amount (TICK) — min {CUP_MIN_STAKE_TICK}
          </label>
          <input
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            inputMode="decimal"
            disabled={busy}
            className="mb-3 w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2.5 font-display text-lg font-bold tabular-nums text-zinc-900 outline-none focus:border-amber-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          {amount !== null && totalPool > 0n && (
            <p className="mb-3 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              Est. payout if {side === 0 ? labelA : labelB} wins:{" "}
              <span className="font-bold text-amber-600 dark:text-amber-300">
                {formatTick(estimatedPayout(amount, totals[side], totalPool + amount))} TICK
              </span>
            </p>
          )}

          <button
            onClick={handleStake}
            disabled={busy || !amount}
            className="w-full rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-6 py-3 text-sm font-black uppercase tracking-wider text-black shadow-[0_0_20px_rgba(251,191,36,.4)] transition-all hover:shadow-[0_0_28px_rgba(251,191,36,.55)] active:scale-[.97] disabled:opacity-40"
          >
            {step === "approving" ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Approving TICK…</span>
            ) : step === "staking" ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Staking…</span>
            ) : (
              `Stake ${side === 0 ? labelA : labelB}`
            )}
          </button>
          {(myStakeA ?? 0n) + (myStakeB ?? 0n) > 0n && (
            <p className="mt-2 text-center text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              Your stakes: {formatTick(myStakeA ?? 0n)} on {labelA} · {formatTick(myStakeB ?? 0n)} on {labelB}
            </p>
          )}
        </>
      )}

      {!bettingOpen && !settled && match.state !== CUP_STATE.Disputed && (
        <p className="rounded-xl bg-black/5 p-4 text-center text-sm text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
          {match.teamA === CUP_TBD || match.teamB === CUP_TBD
            ? "Staking opens once both teams are known."
            : "Staking closed — kickoff reached."}
        </p>
      )}

      {match.state === CUP_STATE.Disputed && (
        <p className="rounded-xl bg-amber-500/10 p-4 text-center text-sm text-amber-700 dark:text-amber-300">
          This match is under DAO review — the circuit breaker tripped. Settlement is paused
          until the ballot resolves.
        </p>
      )}

      {settled && (
        <div className="rounded-xl bg-black/5 p-4 text-center dark:bg-white/5">
          {iWon ? (
            <>
              <p className="mb-3 flex items-center justify-center gap-2 font-display font-bold text-amber-600 dark:text-amber-300">
                <Trophy className="h-5 w-5" /> You won this match!
              </p>
              <button
                onClick={handleClaim}
                disabled={busy}
                className="rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-6 py-2.5 text-sm font-black uppercase tracking-wider text-black shadow-[0_0_20px_rgba(251,191,36,.4)] transition-all active:scale-[.97] disabled:opacity-40"
              >
                {step === "claiming" ? (
                  <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Claiming…</span>
                ) : (
                  "Claim winnings"
                )}
              </button>
            </>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {pool?.winner !== undefined && pool.winner !== CUP_TBD
                ? `${CUP_TEAM_SYMBOLS[pool.winner] ?? "TBA"} won this match.`
                : "Match settled."}
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
      {step === "done" && !error && (
        <p className="mt-3 rounded-xl bg-amber-500/10 p-3 text-center text-xs font-bold text-amber-700 dark:text-amber-300">
          Done — good luck!
        </p>
      )}
    </div>
  );
}

// ── Outright champion panel ──────────────────────────────────────────────────

export function CupOutrightPanel({
  outrightOpen,
  tournamentComplete,
  initialTeamId = null,
  lockedTeam = false,
  embedded = false,
  playerAddress,
  balance,
  authenticated,
  onLogin,
  onStaked,
}: {
  outrightOpen: boolean;
  tournamentComplete: boolean;
  initialTeamId?: number | null;
  lockedTeam?: boolean;
  embedded?: boolean;
  playerAddress: Address | null;
  balance: bigint | null;
  authenticated: boolean;
  onLogin: () => void;
  onStaked: () => void;
}) {
  const [teamId, setTeamId] = useState<number | null>(initialTeamId);
  const [amountStr, setAmountStr] = useState("10");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { write } = useContractWrite();
  const { totals, reload: reloadTotals } = useCupOutrightTotals(true);
  const allowance = useTickAllowance(playerAddress, CUP_CONTRACTS.pool, step);

  const amount = useMemo(() => parseTickInput(amountStr), [amountStr]);
  const needsApproval = amount !== null && (allowance === null || allowance < amount);
  const balanceOk = amount !== null && balance !== null && balance >= amount;
  const busy = step === "approving" || step === "staking" || step === "claiming";

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return CUP_TEAMS;
    return CUP_TEAMS.filter((t) => t.symbol.includes(q) || cupTeamName(t.teamId).toUpperCase().includes(q));
  }, [query]);

  const totalAll = useMemo(() => {
    if (!totals) return 0n;
    return Object.values(totals).reduce((a, b) => a + b, 0n);
  }, [totals]);

  const handleStake = async () => {
    setError(null);
    if (!playerAddress) return setError("Connect your wallet first.");
    if (!CUP_CONTRACTS.tickToken || !CUP_CONTRACTS.pool)
      return setError("Cup contracts not configured.");
    if (!amount) return setError("Enter a valid stake amount.");
    if (teamId === null) return setError("Choose a coin first.");
    if (amount < BigInt(CUP_MIN_STAKE_TICK) * 10n ** 18n)
      return setError(`Minimum stake is ${CUP_MIN_STAKE_TICK} TICK.`);
    if (!balanceOk) return setError("Insufficient TICK balance.");
    try {
      if (needsApproval) {
        setStep("approving");
        await write({
          to: CUP_CONTRACTS.tickToken,
          abi: TICK_TOKEN_ABI,
          functionName: "approve",
          args: [CUP_CONTRACTS.pool, amount],
          label: "TICK approval",
        });
      }
      setStep("staking");
      await write({
        to: CUP_CONTRACTS.pool,
        abi: CUP_POOL_ABI,
        functionName: "stakeOutright",
        args: [teamId, amount],
        label: "Outright stake",
      });
      setStep("done");
      onStaked();
      void reloadTotals();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("idle");
    }
  };

  const handleClaim = async () => {
    setError(null);
    if (!CUP_CONTRACTS.pool) return;
    try {
      setStep("claiming");
      await write({
        to: CUP_CONTRACTS.pool,
        abi: CUP_POOL_ABI,
        functionName: "claimOutright",
        args: [],
        label: "Claim outright winnings",
      });
      setStep("done");
      onStaked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("idle");
    }
  };

  if (!authenticated) {
    return <SignInPrompt onLogin={onLogin} label="Sign in to back a champion" />;
  }

  return (
    <div className={embedded ? "p-1" : "glass rounded-2xl p-5"}>
      <h3 className="mb-1 flex items-center gap-2 font-display text-base font-bold text-zinc-900 dark:text-white">
        <Trophy className="h-5 w-5 text-amber-500" /> Champion — outright winner
      </h3>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        {outrightOpen
          ? "Open until the final kicks off. Back one of 64 coins to lift the trophy."
          : "The outright pool is closed."}{" "}
        {totalAll > 0n && (
          <span className="tabular-nums">Total staked: {formatTick(totalAll)} TICK.</span>
        )}
      </p>

      {outrightOpen && (
        <>
          {lockedTeam && teamId !== null && <div className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/[.08] p-4"><CupTeamBadge teamId={teamId} size={40} showName={false} /><div><p className="font-display text-lg font-black">{cupTeamName(teamId)}</p><p className="text-xs text-zinc-500">{CUP_TEAM_SYMBOLS[teamId]} · {formatTick(totals?.[teamId] ?? 0n)} TICK staked</p></div></div>}
          {!lockedTeam && <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teams…"
            disabled={busy}
            className="mb-2 w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-amber-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          <div className="mb-4 grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-4">
            {filtered.map((t) => {
              const tot = totals?.[t.teamId] ?? 0n;
              return (
                <button
                  key={t.teamId}
                  onClick={() => setTeamId(t.teamId)}
                  disabled={busy}
                  title={`${t.symbol} — ${formatTick(tot)} TICK staked`}
                  className={cn(
                    "rounded-lg border px-1 py-1.5 text-center transition-all active:scale-95",
                    teamId === t.teamId
                      ? "border-amber-400 bg-amber-400/20 shadow-[0_0_12px_rgba(251,191,36,.35)]"
                      : "border-black/10 bg-black/[.02] hover:border-amber-400/40 dark:border-white/10 dark:bg-white/[.03]"
                  )}
                >
                  <div className="flex items-center gap-1.5"><CupTeamBadge teamId={t.teamId} size={22} showName={false} /><span className="min-w-0 truncate text-left font-display text-[11px] font-black text-zinc-800 dark:text-zinc-100" title={cupTeamName(t.teamId)}>{cupTeamName(t.teamId)}</span></div>
                  <div className="text-[9px] tabular-nums text-zinc-400">
                    {tot > 0n ? formatTick(tot, 0) : "—"}
                  </div>
                </button>
              );
            })}
          </div>
          </>}

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Back {teamId === null ? "TBA" : CUP_TEAM_SYMBOLS[teamId]} — amount (TICK), min {CUP_MIN_STAKE_TICK}
          </label>
          <input
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            inputMode="decimal"
            disabled={busy}
            className="mb-3 w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2.5 font-display text-lg font-bold tabular-nums text-zinc-900 outline-none focus:border-amber-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          <button
            onClick={handleStake}
            disabled={busy || !amount || teamId === null}
            className="w-full rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-6 py-3 text-sm font-black uppercase tracking-wider text-black shadow-[0_0_20px_rgba(251,191,36,.4)] transition-all hover:shadow-[0_0_28px_rgba(251,191,36,.55)] active:scale-[.97] disabled:opacity-40"
          >
            {step === "approving" ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Approving TICK…</span>
            ) : step === "staking" ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Staking…</span>
            ) : (
              teamId === null ? "Choose a coin" : `Back ${CUP_TEAM_SYMBOLS[teamId]} to win it all`
            )}
          </button>
        </>
      )}

      {!outrightOpen && tournamentComplete && (
        <button
          onClick={handleClaim}
          disabled={busy}
          className="w-full rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-6 py-3 text-sm font-black uppercase tracking-wider text-black shadow-[0_0_20px_rgba(251,191,36,.4)] transition-all active:scale-[.97] disabled:opacity-40"
        >
          {step === "claiming" ? (
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Claiming…</span>
          ) : (
            "Claim outright winnings"
          )}
        </button>
      )}

      {error && (
        <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
      {step === "done" && !error && (
        <p className="mt-3 rounded-xl bg-amber-500/10 p-3 text-center text-xs font-bold text-amber-700 dark:text-amber-300">
          Done — good luck!
        </p>
      )}
    </div>
  );
}

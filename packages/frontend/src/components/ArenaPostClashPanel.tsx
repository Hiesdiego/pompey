"use client";

import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Loader2, Trophy } from "lucide-react";
import type { Address } from "viem";
import {
  ARENA_CLASH_FACTORY_ADDRESS,
  MEME_CLASH_FACTORY_ABI,
  arenaDisplaySymbol,
  type ArenaUserPosition,
  type ClashDetail,
} from "../lib/arenaContracts";
import { formatTick } from "../lib/format";
import { formatSignedPct } from "../lib/format";
import { cn } from "../lib/cn";
import { celebrateClaim } from "../lib/confetti";
import { getPublicClient } from "../hooks/usePublicClient";
import { useContractWrite } from "../hooks/useContractWrite";

/**
 * ArenaPostClashPanel, post-clash view for settled and voided clashes.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/ArenaPostClashPanel.tsx
 *
 * This is the Arena mirror of StockPostMatchPanel in
 * ./StockPostMatchPanel.tsx: same section shell, same trophy or ban
 * header, same two performance cards, same result line, same stake
 * read, claim button, claimed line and error box. It cannot reuse the
 * stock panel directly because that panel is typed on StockApiFixture
 * and StockApiPool and reads the stock prediction pool (getStake and
 * claimed keyed by season and global fixture id). The clash factory
 * carries its own stakes and claimed mappings keyed by clash id, with
 * two outcomes (0 = Yes, 1 = No), and claim(clashId) pays a settled
 * win or refunds a voided stake 1:1, so this panel reads and claims
 * against MEME_CLASH_FACTORY_ABI instead.
 *
 * Stake read fallback: when the factory address is not configured or
 * the on-chain read fails, the panel falls back to the userPosition
 * the backend detail already returned, so the claim state still
 * renders before deploy.
 */

const OUTCOME_SHORT = ["Yes", "No"] as const;

export function ArenaPostClashPanel({
  clash,
  userPosition,
  playerAddress,
  onClaimed,
}: {
  clash: ClashDetail;
  userPosition: ArenaUserPosition | null;
  playerAddress: Address | null;
  onClaimed: () => void;
}) {
  const [stakes, setStakes] = useState<[bigint, bigint] | null>(null);
  const [claimed, setClaimed] = useState<boolean | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const { write } = useContractWrite();
  const clashId = BigInt(clash.id);
  const voided = clash.status === "voided";
  const winning = clash.winner;

  useEffect(() => {
    let alive = true;
    setStakes(null);
    setClaimed(null);
    if (!playerAddress) return;
    if (!ARENA_CLASH_FACTORY_ADDRESS) {
      if (userPosition) {
        setStakes([BigInt(userPosition.yesStake || "0"), BigInt(userPosition.noStake || "0")]);
        setClaimed(userPosition.claimed);
      }
      return;
    }
    const client = getPublicClient();
    const contracts = [0, 1].map((outcome) => ({
      address: ARENA_CLASH_FACTORY_ADDRESS,
      abi: MEME_CLASH_FACTORY_ABI,
      functionName: "stakes" as const,
      args: [clashId, playerAddress, BigInt(outcome)] as const,
    }));
    Promise.all([
      client.multicall({ contracts }),
      client.readContract({
        address: ARENA_CLASH_FACTORY_ADDRESS,
        abi: MEME_CLASH_FACTORY_ABI,
        functionName: "claimed",
        args: [clashId, playerAddress],
      }),
    ])
      .then(([stakeResults, claimedResult]) => {
        if (!alive) return;
        setStakes([
          (stakeResults[0].result ?? 0n) as bigint,
          (stakeResults[1].result ?? 0n) as bigint,
        ]);
        setClaimed(claimedResult as boolean);
      })
      .catch(() => {
        if (!alive) return;
        if (userPosition) {
          setStakes([BigInt(userPosition.yesStake || "0"), BigInt(userPosition.noStake || "0")]);
          setClaimed(userPosition.claimed);
        } else {
          setStakes(null);
          setClaimed(null);
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clash.id, playerAddress]);

  const handleClaim = async () => {
    setClaimError(null);
    setClaimTx(null);
    if (!ARENA_CLASH_FACTORY_ADDRESS) {
      setClaimError("Arena contract addresses not configured.");
      return;
    }
    setClaimBusy(true);
    try {
      const hash = await write({
        to: ARENA_CLASH_FACTORY_ADDRESS,
        abi: MEME_CLASH_FACTORY_ABI,
        functionName: "claim",
        args: [clashId],
        label: voided ? "Refund clash stake" : "Claim clash payout",
      });
      setClaimTx(hash);
      setClaimed(true);
      celebrateClaim();
      onClaimed();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setClaimError(
        message.includes("NothingToClaim")
          ? "Nothing to claim on this clash."
          : message.includes("AlreadyClaimed")
            ? "This clash has already been claimed."
            : message,
      );
    } finally {
      setClaimBusy(false);
    }
  };

  const memeName = clash.memeName ?? arenaDisplaySymbol(clash.memeSymbol);
  const oppName = clash.opponentName ?? arenaDisplaySymbol(clash.opponentSymbol);
  const hasStake = stakes !== null && stakes.some((stake) => stake > 0n);
  const won = winning !== null && stakes !== null && stakes[winning] > 0n;
  const performance = [
    { name: memeName, symbol: arenaDisplaySymbol(clash.memeSymbol), pct: clash.memeMovePct, winner: winning === 0, color: "from-emerald-500 to-lime-300" },
    { name: oppName, symbol: arenaDisplaySymbol(clash.opponentSymbol), pct: clash.oppMovePct, winner: winning === 1, color: "from-[#2E7CF6] to-cyan-300" },
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
          {voided ? "Clash voided" : "Final clash analytics"}
        </h3>
      </div>

      {voided && (
        <p className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          This clash was voided because a raw move of 30 percent or more on either side triggered the breaker, or a snapshot price was missing. Stakes can be refunded in full.
        </p>
      )}

      {!voided && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {performance.map(({ name, symbol, pct, winner, color }) => {
            const width = pct === null ? 0 : Math.max(3, Math.min(100, Math.abs(pct) / 30 * 100));
            return (
              <div key={symbol} className="rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2E7CF6]/10 text-xs font-extrabold text-[#1D4ED8] dark:text-[#7db3ff]">
                    {symbol.slice(0, 4)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-zinc-900 dark:text-white">{name}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      {winner ? "Winning side" : "Price performance"}
                    </p>
                  </div>
                  <strong className={cn(
                    "font-display text-xl tabular-nums",
                    pct === null ? "text-zinc-400" : pct >= 0 ? "text-emerald-500" : "text-red-500",
                  )}>
                    {pct === null ? "-" : formatSignedPct(pct)}
                  </strong>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/[.07] dark:bg-white/[.08]">
                  <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700`} style={{ width: `${width}%` }} />
                </div>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {pct === null ? "Snapshot performance unavailable" : `${pct >= 0 ? "Gained" : "Declined"} over the clash window`}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {!voided && winning !== null && (
        <p className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-300">
          Result: <span className="font-display font-bold text-zinc-900 dark:text-white">
            {winning === 0 ? "Yes, the meme outperformed" : "No, the meme did not outperform"}
          </span>{" "}
          <span className="text-zinc-400 dark:text-zinc-500">({winning === 0 ? "Yes · meme strictly greater" : "No · tie or opponent ahead"})</span>
        </p>
      )}

      {playerAddress && stakes === null && <p className="text-center text-sm text-zinc-500">Checking your stakes…</p>}
      {playerAddress && stakes !== null && !hasStake && <p className="text-center text-sm text-zinc-500">You didn’t stake on this clash.</p>}
      {playerAddress && hasStake && claimed === false && (
        <div className="rounded-2xl border border-black/8 bg-black/[.03] p-4 dark:border-white/8 dark:bg-white/[.03]">
          <p className="mb-1 font-display text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
            Your stakes: {stakes.map((stake, index) => stake > 0n ? `${OUTCOME_SHORT[index]} ${formatTick(stake)}` : null).filter(Boolean).join(" · ")}
          </p>
          <p className={cn("mb-3 text-sm font-semibold", won || voided ? "text-[#0f7a55] dark:text-[#7fe0bd]" : "text-zinc-500 dark:text-zinc-400")}>
            {voided ? "Clash voided, reclaim your full stake." : won ? "You won, claim your payout." : "No payout for this pick."}
          </p>
          {(won || voided) && (
            <button
              onClick={handleClaim}
              disabled={claimBusy}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-all active:scale-[.98]",
                claimBusy
                  ? "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
                  : "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_24px_rgba(46,124,246,.35)] hover:shadow-[0_0_36px_rgba(46,124,246,.5)]",
              )}
            >
              {claimBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {claimBusy ? voided ? "Refunding…" : "Claiming…" : voided ? "Reclaim stake" : "Claim payout"}
            </button>
          )}
          {(won || voided) && (
            <p className="mt-2 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
              Gasless, sent from your smart wallet, sponsored by TICKR.
            </p>
          )}
        </div>
      )}
      {playerAddress && hasStake && claimed === true && (
        <p className="flex items-center justify-center gap-2 text-sm font-medium text-[#0f7a55] dark:text-[#7fe0bd]">
          <CheckCircle2 className="h-4 w-4" /> {voided ? "Refund claimed" : won ? "Payout claimed" : "Already claimed"}
          {claimTx && <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{claimTx.slice(0, 10)}…</span>}
        </p>
      )}
      {claimError && <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-200">{claimError}</p>}
    </section>
  );
}

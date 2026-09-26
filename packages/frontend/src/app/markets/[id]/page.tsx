/**
 * Market detail page (v0.2): /markets/[id].
 *
 * - Header: template, creator, state, pool, betting-close countdown.
 * - Outcome bars + stake panel (mirrors the fixture StakePanel UX).
 * - "How this resolves" transparency panel: the exact rule in plain
 *   language plus the LIVE resolving data (top-gainer table / checkpoint
 *   prices / fixture end prices) so anyone can verify the outcome.
 * - Resolve / void / claim actions (all permissionless).
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Info, Gavel, Ban, HandCoins } from "lucide-react";
import { useAccount } from "wagmi";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { getPublicClient } from "../../../hooks/usePublicClient";
import { useTeams } from "../../../hooks/useTeams";
import { useContractWrite } from "../../../hooks/useContractWrite";
import { useTickBalance } from "../../../hooks/useTickBalance";
import {
  MARKET_FACTORY_ADDRESS,
  MARKET_FACTORY_ABI,
  TEMPLATES,
  TEMPLATE_NAMES,
  TEMPLATE_DESCRIPTIONS,
  MARKET_STATE_NAMES,
  FACTORY_MIN_STAKE_TICK,
  CREATION_SEED_TICK,
} from "../../../lib/marketFactory";
import { CONTRACTS, TICK_TOKEN_ABI, PRICE_DECIMALS } from "../../../lib/contracts";
import { SectionTitle, ErrorState, SkeletonCards } from "../../../components/States";
import { Countdown } from "../../../components/Countdown";
import { PoolBars } from "../../../components/PoolBars";
import { cn } from "../../../lib/cn";
import { formatTick } from "../../../lib/format";

interface MarketDetail {
  id: bigint;
  templateId: number;
  creator: string;
  creatorName: string;
  bettingCloseTime: bigint;
  endTime: bigint;
  voidAfter: bigint;
  params: `0x${string}`;
  outcomeCount: number;
  seedAmount: bigint;
  totalStaked: bigint;
  state: number;
  winnerBitmap: bigint;
  payoutPerShare: bigint;
}

export default function MarketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = BigInt(params.id as string);
  const { address } = useAccount();
  const publicClient = getPublicClient();
  const { teams } = useTeams();
  const { write, status } = useContractWrite();
  const { balance } = useTickBalance(address ?? null);

  const [market, setMarket] = useState<MarketDetail | null>(null);
  const [outcomeTotals, setOutcomeTotals] = useState<bigint[] | null>(null);
  const [userStakes, setUserStakes] = useState<bigint[] | null>(null);
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stakeOutcome, setStakeOutcome] = useState(0);
  const [stakeAmount, setStakeAmount] = useState("");

  const load = async () => {
    if (!publicClient || !MARKET_FACTORY_ADDRESS) return;
    try {
      const [m, settlement] = await Promise.all([
        publicClient.readContract({
          address: MARKET_FACTORY_ADDRESS,
          abi: MARKET_FACTORY_ABI,
          functionName: "marketInfo",
          args: [id],
        }),
        publicClient.readContract({
          address: MARKET_FACTORY_ADDRESS,
          abi: MARKET_FACTORY_ABI,
          functionName: "marketSettlement",
          args: [id],
        }),
      ]) as [any, any];
      const detail: MarketDetail = {
        id,
        templateId: m.templateId as number,
        creator: m.creator as string,
        creatorName: m.creatorName as string,
        bettingCloseTime: m.bettingCloseTime as bigint,
        endTime: m.endTime as bigint,
        voidAfter: m.voidAfter as bigint,
        params: m.params as `0x${string}`,
        outcomeCount: m.outcomeCount as number,
        seedAmount: settlement.seedAmount as bigint,
        totalStaked: settlement.totalStaked as bigint,
        state: settlement.state as number,
        winnerBitmap: settlement.winnerBitmap as bigint,
        payoutPerShare: settlement.payoutPerShare as bigint,
      };
      setMarket(detail);

      const totals = await Promise.all(
        Array.from({ length: detail.outcomeCount }, (_, o) =>
          publicClient.readContract({
            address: MARKET_FACTORY_ADDRESS!,
            abi: MARKET_FACTORY_ABI,
            functionName: "outcomeTotals",
            args: [id, BigInt(o)],
          })
        )
      );
      setOutcomeTotals(totals as bigint[]);

      if (address) {
        const stakes = await Promise.all(
          Array.from({ length: detail.outcomeCount }, (_, o) =>
            publicClient.readContract({
              address: MARKET_FACTORY_ADDRESS!,
              abi: MARKET_FACTORY_ABI,
              functionName: "stakes",
              args: [id, address, BigInt(o)],
            })
          )
        );
        setUserStakes(stakes as bigint[]);
        const claimed = (await publicClient.readContract({
          address: MARKET_FACTORY_ADDRESS!,
          abi: MARKET_FACTORY_ABI,
          functionName: "claimed",
          args: [id, address],
        })) as boolean;
        setAlreadyClaimed(claimed);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, address]);

  const outcomeLabels = useMemo(() => {
    if (!market || !teams) return [];
    return getOutcomeLabels(market, teams);
  }, [market, teams]);

  const nowSec = Math.floor(Date.now() / 1000);
  const bettingOpen =
    market !== null &&
    market.state === 0 &&
    (market.templateId === TEMPLATES.SPREAD
      ? true // SPREAD mirrors the fixture window — contract enforces it
      : Number(market.bettingCloseTime) > nowSec);
  const resolvable = market !== null && market.state === 0 && Number(market.endTime) <= nowSec;
  const voidable = market !== null && market.state === 0 && Number(market.voidAfter) <= nowSec;

  async function handleStake() {
    if (!market || !address || !publicClient) return;
    const amount = Number(stakeAmount);
    if (!amount || amount < FACTORY_MIN_STAKE_TICK) return;
    const amountWei = BigInt(Math.round(amount * 1e18));

    const allowance = (await publicClient.readContract({
      address: CONTRACTS.tickToken as `0x${string}`,
      abi: TICK_TOKEN_ABI,
      functionName: "allowance",
      args: [address, MARKET_FACTORY_ADDRESS!],
    })) as bigint;
    if (allowance < amountWei) {
      await write({
        address: CONTRACTS.tickToken as `0x${string}`,
        abi: TICK_TOKEN_ABI,
        functionName: "approve",
        args: [MARKET_FACTORY_ADDRESS!, amountWei],
      });
    }
    await write({
      address: MARKET_FACTORY_ADDRESS!,
      abi: MARKET_FACTORY_ABI,
      functionName: "stake",
      args: [id, BigInt(stakeOutcome), amountWei],
    });
    setStakeAmount("");
    load();
  }

  async function handleResolve() {
    await write({
      address: MARKET_FACTORY_ADDRESS!,
      abi: MARKET_FACTORY_ABI,
      functionName: "resolve",
      args: [id],
    });
    load();
  }

  async function handleVoid() {
    await write({
      address: MARKET_FACTORY_ADDRESS!,
      abi: MARKET_FACTORY_ABI,
      functionName: "voidMarket",
      args: [id],
    });
    load();
  }

  async function handleClaim() {
    await write({
      address: MARKET_FACTORY_ADDRESS!,
      abi: MARKET_FACTORY_ABI,
      functionName: "claim",
      args: [id],
    });
    load();
  }

  if (!MARKET_FACTORY_ADDRESS) {
    return (
      <div className="py-10">
        <ErrorState message="Markets not deployed on this network yet." onRetry={() => router.back()} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (!market || !outcomeTotals) {
    return (
      <div className="py-10">
        <SkeletonCards cards={3} />
      </div>
    );
  }

  const poolTick = Number(market.totalStaked + market.seedAmount) / 1e18;
  const busy = status === "pending";

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/markets"
        className="mb-4 flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-[#2E7CF6]"
      >
        <ArrowLeft className="h-4 w-4" /> All markets
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-[#2E7CF6]">
            {TEMPLATE_NAMES[market.templateId]}
          </div>
          <h1 className="mt-1 text-2xl font-bold">
            {describeMarket(market, teams ?? [])}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Created by{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-200">
              {market.creatorName || `${market.creator.slice(0, 6)}…${market.creator.slice(-4)}`}
            </span>
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium",
            market.state === 0 && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            market.state === 1 && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
            market.state === 2 && "bg-zinc-500/10 text-zinc-500"
          )}
        >
          {MARKET_STATE_NAMES[market.state]}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {/* Outcome pools */}
          <div className="glass mb-6 rounded-2xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Pools</h2>
              <span className="text-sm text-zinc-500">
                {poolTick.toLocaleString()} TICK total
                <span className="text-zinc-400">
                  {" "}
                  (incl. {formatTick(market.seedAmount)} seed)
                </span>
              </span>
            </div>
            <PoolBars pool={{
              totalHome: (outcomeTotals[0] ?? 0n).toString(),
              totalDraw: (outcomeTotals[1] ?? 0n).toString(),
              totalAway: (outcomeTotals[2] ?? 0n).toString(),
              totalPool: outcomeTotals.reduce((sum, total) => sum + total, 0n).toString(),
              seasonId: "0",
              fixtureId: "0",
              settled: false,
              winningOutcome: null,
            }} />
            {userStakes && userStakes.some((s) => s > 0n) && (
              <div className="mt-4 border-t border-black/5 pt-4 text-sm dark:border-white/5">
                <div className="mb-1 font-medium">Your stakes</div>
                {userStakes.map(
                  (s, o) =>
                    s > 0n && (
                      <div key={o} className="flex justify-between text-zinc-600 dark:text-zinc-300">
                        <span>{outcomeLabels[o]}</span>
                        <span>{formatTick(s)} TICK</span>
                      </div>
                    )
                )}
              </div>
            )}
          </div>

          {/* Stake panel */}
          {market.state === 0 && (
            <div className="glass mb-6 rounded-2xl p-6">
              <h2 className="mb-4 font-semibold">Stake</h2>
              {bettingOpen ? (
                <>
                  {market.templateId !== TEMPLATES.SPREAD && (
                    <p className="mb-4 text-sm text-zinc-500">
                      Betting closes in{" "}
                      <Countdown target={Number(market.bettingCloseTime) * 1000} />
                    </p>
                  )}
                  {market.templateId === TEMPLATES.SPREAD && (
                    <p className="mb-4 text-sm text-amber-600 dark:text-amber-400">
                      In-play market — betting follows the fixture's window and closes
                      5 minutes before the match ends (enforced on-chain).
                    </p>
                  )}
                  {!address ? (
                    <p className="text-sm text-amber-600">Connect your wallet to stake.</p>
                  ) : (
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500">Outcome</label>
                        <select
                          value={stakeOutcome}
                          onChange={(e) => setStakeOutcome(Number(e.target.value))}
                          className="rounded-xl border border-black/10 bg-white/50 px-3 py-2 text-sm dark:border-white/10 dark:bg-black/30"
                        >
                          {outcomeLabels.map((l, o) => (
                            <option key={o} value={o}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Amount (TICK, min {FACTORY_MIN_STAKE_TICK})
                        </label>
                        <input
                          type="number"
                          min={FACTORY_MIN_STAKE_TICK}
                          value={stakeAmount}
                          onChange={(e) => setStakeAmount(e.target.value)}
                          placeholder="100"
                          className="w-36 rounded-xl border border-black/10 bg-white/50 px-3 py-2 text-sm dark:border-white/10 dark:bg-black/30"
                        />
                      </div>
                      <button
                        onClick={handleStake}
                        disabled={busy || !stakeAmount || Number(stakeAmount) < FACTORY_MIN_STAKE_TICK}
                        className="gradient-cta rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        {busy ? "Confirm…" : "Stake"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-zinc-500">
                  Betting is closed for this market.
                  {resolvable && " It can now be resolved by anyone."}
                </p>
              )}
            </div>
          )}

          {/* Actions: resolve / void / claim */}
          <div className="glass rounded-2xl p-6">
            <h2 className="mb-4 font-semibold">Settle</h2>
            <div className="flex flex-wrap gap-3">
              {market.state === 0 && (
                <>
                  <button
                    onClick={handleResolve}
                    disabled={busy || !resolvable || !address}
                    title={resolvable ? "Resolve this market (earns the 1% resolver bounty)" : "Resolving unlocks after the end time"}
                    className="flex items-center gap-2 rounded-xl border border-[#2E7CF6]/40 px-4 py-2 text-sm font-medium text-[#2E7CF6] transition-all hover:bg-[#2E7CF6]/10 disabled:opacity-40"
                  >
                    <Gavel className="h-4 w-4" />
                    {busy ? "Confirm…" : "Resolve (earn 1% bounty)"}
                  </button>
                  <button
                    onClick={handleVoid}
                    disabled={busy || !voidable || !address}
                    title={voidable ? "Void this market — refunds all stakes" : "Voiding unlocks 7 days after the end time, only if unresolvable"}
                    className="flex items-center gap-2 rounded-xl border border-black/10 px-4 py-2 text-sm font-medium text-zinc-600 transition-all hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
                  >
                    <Ban className="h-4 w-4" />
                    Void
                  </button>
                </>
              )}
              {market.state !== 0 && address && !alreadyClaimed && (
                <button
                  onClick={handleClaim}
                  disabled={busy}
                  className="gradient-cta flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  <HandCoins className="h-4 w-4" />
                  {busy ? "Confirm…" : market.state === 1 ? "Claim winnings" : "Claim refund"}
                </button>
              )}
              {alreadyClaimed && (
                <p className="text-sm text-zinc-500">You've claimed this market.</p>
              )}
            </div>
            {market.state === 1 && (
              <p className="mt-3 text-xs text-zinc-500">
                Fees at settlement: 3% treasury · 2% creator · 1% resolver. Winners
                shared the remaining 94% of stakes plus the entire {CREATION_SEED_TICK} TICK
                seed subsidy.
              </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          {/* How this resolves — transparency panel */}
          <HowThisResolves market={market} teams={teams ?? []} />
        </div>
      </div>
    </div>
  );
}

// ── helpers ──

function getOutcomeLabels(
  market: MarketDetail,
  teams: { teamId: number; symbol: string; name: string }[]
): string[] {
  const t = market.templateId;
  if (t === TEMPLATES.TOP_GAINER || t === TEMPLATES.CHAMPION) {
    return teams.slice(0, market.outcomeCount).map((tm) => `${tm.symbol}`);
  }
  if (t === TEMPLATES.H2H || t === TEMPLATES.TARGET || t === TEMPLATES.SPREAD) {
    try {
      if (t === TEMPLATES.H2H) {
        const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params);
        const sa = teams.find((tm) => tm.teamId === a)?.symbol ?? `#${a}`;
        const sb = teams.find((tm) => tm.teamId === b)?.symbol ?? `#${b}`;
        return [`${sa} gains more`, `${sb} gains more`];
      }
      if (t === TEMPLATES.TARGET) {
        return ["Yes", "No"];
      }
      return ["Home covers", "Home doesn't cover"];
    } catch {
      return Array.from({ length: market.outcomeCount }, (_, i) => `Outcome ${i}`);
    }
  }
  return Array.from({ length: market.outcomeCount }, (_, i) => `Outcome ${i}`);
}

function describeMarket(
  market: MarketDetail,
  teams: { teamId: number; symbol: string; name: string }[]
): string {
  const t = market.templateId;
  try {
    if (t === TEMPLATES.TOP_GAINER) {
      const [, md] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), market.params);
      return `Top gainer of matchday ${md}`;
    }
    if (t === TEMPLATES.CHAMPION) return "Season 1 champion";
    if (t === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params);
      const sa = teams.find((tm) => tm.teamId === a)?.symbol ?? `#${a}`;
      const sb = teams.find((tm) => tm.teamId === b)?.symbol ?? `#${b}`;
      return `${sa} vs ${sb} — bigger gain wins`;
    }
    if (t === TEMPLATES.TARGET) {
      const [teamId, target, , above] = decodeAbiParameters(
        parseAbiParameters("uint16, uint256, uint64, bool"),
        market.params
      );
      const s = teams.find((tm) => tm.teamId === teamId)?.symbol ?? `#${teamId}`;
      return `${s} ${above ? "≥" : "≤"} $${(Number(target) / 1e8).toLocaleString()}`;
    }
    if (t === TEMPLATES.SPREAD) {
      const [, fixtureId, spread] = decodeAbiParameters(
        parseAbiParameters("uint256, uint256, int16"),
        market.params
      );
      return `Fixture ${fixtureId} — home covers ${spread > 0 ? "+" : ""}${spread}`;
    }
  } catch {
    // fall through
  }
  return TEMPLATE_NAMES[t] ?? "Market";
}

function HowThisResolves({
  market,
  teams,
}: {
  market: MarketDetail;
  teams: { teamId: number; symbol: string; name: string }[];
}) {
  const publicClient = getPublicClient();
  const [table, setTable] = useState<null | {
    teams: number[];
    priceStart: bigint[];
    priceEnd: bigint[];
    gainBps: bigint[];
    valid: boolean[];
  }>(null);

  // For TOP_GAINER, pull the live resolving table from the contract.
  useEffect(() => {
    if (!publicClient || !MARKET_FACTORY_ADDRESS || market.templateId !== TEMPLATES.TOP_GAINER)
      return;
    let alive = true;
    publicClient
      .readContract({
        address: MARKET_FACTORY_ADDRESS,
        abi: MARKET_FACTORY_ABI,
        functionName: "getTopGainerTable",
        args: [market.id],
      })
      .then((r: any) => {
        if (!alive) return;
        setTable({
          teams: r.teams as number[],
          priceStart: r.priceStart as bigint[],
          priceEnd: r.priceEnd as bigint[],
          gainBps: r.gainBps as bigint[],
          valid: r.valid as boolean[],
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [publicClient, market.id, market.templateId]);

  const ruleText = useMemo(() => {
    const t = market.templateId;
    if (t === TEMPLATES.TOP_GAINER) {
      try {
        const [, md] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), market.params);
        return `Winner = the team with the highest % price gain over matchday ${md}'s window, measured from the oracle's hourly checkpoints at the window edges. Ties split the pool. Anyone can recompute the winner from the live table below — no votes, no judges.`;
      } catch {
        return TEMPLATE_DESCRIPTIONS[t];
      }
    }
    if (t === TEMPLATES.CHAMPION)
      return "Winner = the team with the most league points when the season completes (all 380 fixtures settled), then goal difference. Resolves only via the on-chain league table.";
    if (t === TEMPLATES.H2H)
      return "Winner = whichever team gained more (%) between the two checkpoint timestamps. An exact tie splits the pool between both outcomes.";
    if (t === TEMPLATES.TARGET)
      return "Yes wins if the team's oracle checkpoint price at the target time is ≥ (or ≤) the target. One checkpoint, one comparison, no ambiguity.";
    return "Home covers if (home rounded % − away rounded %) is strictly greater than the spread, using the fixture's on-chain start/end prices and the same rounding the league uses.";
  }, [market]);

  return (
    <div className="glass rounded-2xl p-6">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <Info className="h-4 w-4 text-[#2E7CF6]" />
        How this resolves
      </h2>
      <p className="mb-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{ruleText}</p>

      {market.templateId === TEMPLATES.TOP_GAINER && table && (
        <div className="overflow-hidden rounded-xl border border-black/5 dark:border-white/5">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-black/5 text-left text-zinc-500 dark:bg-white/5">
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 text-right font-medium">Gain</th>
              </tr>
            </thead>
            <tbody>
              {table.teams
                .map((teamId, i) => ({
                  teamId,
                  gainBps: table.gainBps[i],
                  valid: table.valid[i],
                  symbol: teams.find((t) => t.teamId === teamId)?.symbol ?? `#${teamId}`,
                }))
                .sort((a, b) => Number(b.gainBps - a.gainBps))
                .slice(0, 8)
                .map((row) => (
                  <tr
                    key={row.teamId}
                    className="border-t border-black/5 dark:border-white/5"
                  >
                    <td className="px-3 py-1.5 font-medium">{row.symbol}</td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right tabular-nums",
                        !row.valid && "text-zinc-400",
                        row.valid && row.gainBps >= 0n && "text-emerald-600 dark:text-emerald-400",
                        row.valid && row.gainBps < 0n && "text-red-500"
                      )}
                    >
                      {row.valid ? `${(Number(row.gainBps) / 100).toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-zinc-400">
            Live resolving data — checkpoints update hourly. Top 8 shown.
          </p>
        </div>
      )}

      <div className="mt-4 border-t border-black/5 pt-3 text-xs text-zinc-500 dark:border-white/5">
        <div className="flex justify-between py-0.5">
          <span>Betting closes</span>
          <span className="tabular-nums">
            {market.templateId === TEMPLATES.SPREAD
              ? "5 min before match end"
              : new Date(Number(market.bettingCloseTime) * 1000).toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between py-0.5">
          <span>Resolvable after</span>
          <span className="tabular-nums">
            {new Date(Number(market.endTime) * 1000).toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between py-0.5">
          <span>Voidable after</span>
          <span className="tabular-nums">
            {new Date(Number(market.voidAfter) * 1000).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

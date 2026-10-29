/**
 * Markets page (v0.3): the permissionless outright-markets board.
 *
 * Two sections:
 * - Featured markets (league-created templates, e.g. Matchday Top Gainer)
 * - Community markets (created by anyone via the factory)
 *
 * Market cards share the homepage layout, with template-specific questions,
 * team identity, live pool shares, and close-time context.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Trophy,
  Users,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getPublicClient } from "../../hooks/usePublicClient";
import { useTickr } from "../../hooks/useTickr";
import { useTeams } from "../../hooks/useTeams";
import {
  MARKET_FACTORY_ADDRESS,
  NEW_MARKET_FACTORY_ADDRESS,
  MARKET_FACTORY_ABI,
  TEMPLATES,
} from "../../lib/marketFactory";
import { SectionTitle, ErrorState, EmptyState, SkeletonCards } from "../../components/States";
import { cn } from "../../lib/cn";
import { CupOutrightMarketCard } from "../../components/CupOutrightMarketCard";
import { cupConfigured } from "../../lib/cup";
import { api, type ApiFixture } from "../../lib/api";
import { useMarkets as useCachedMarkets } from "../../lib/query/useMarkets";
import { useFactoryEvents } from "../../lib/query/useFactoryEvents";
import { usePriceFeed } from "../../lib/price/usePriceFeed";
import { useMarketFees } from "../../lib/query/useMarketFees";
import { MarketCard, type MarketSummary } from "../../components/MarketCard";

function useMarkets() {
  const { markets: summaries, error: queryError, dataUpdatedAt } = useCachedMarkets();
  useFactoryEvents();
  const markets = useMemo<MarketSummary[] | null>(() => summaries?.map((s) => ({
    id: BigInt(s.id),
    marketKey: s.marketKey ?? String(s.id),
    factoryAddress: s.factoryAddress ?? MARKET_FACTORY_ADDRESS,
    templateId: s.templateId,
    creator: s.creator,
    creatorName: s.creatorName,
    bettingCloseTime: BigInt(s.bettingCloseTime),
    endTime: BigInt(s.endTime),
    outcomeCount: s.outcomeCount,
    seedAmount: BigInt(s.seedAmount),
    totalStaked: BigInt(s.totalStaked),
    state: s.state,
    winnerBitmap: BigInt(s.winnerBitmap),
    params: s.params as `0x${string}`,
    outcomeTotals: s.outcomeTotals.map((t) => BigInt(t)),
    lastStakeAt: 0,
  })) ?? null, [summaries]);
  return { markets, error: queryError?.message ?? null, updatedAt: dataUpdatedAt };
}

export default function MarketsPage() {
  const { markets, error, updatedAt } = useMarkets();
  const { feesBps } = useMarketFees();
  const { teams } = useTeams();
  const { playerAddress } = useTickr();
  const { prices, status: priceStatus } = usePriceFeed(true);
  const [tab, setTab] = useState<"all" | "featured" | "bounty" | "winnings">("all");

  // Fixture directory for spread markets: teams in home/away order,
  // matchday, kickoff. Fails soft — spread cards fall back to generic text.
  const [fixtures, setFixtures] = useState<Map<string, ApiFixture>>(new Map());
  useEffect(() => {
    let alive = true;
    api
      .fixtures()
      .then((list) => {
        if (!alive) return;
        setFixtures(new Map(list.map((f) => [f.fixtureId, f])));
      })
      .catch(() => {
        /* Board still renders without fixture enrichment. */
      });
    return () => {
      alive = false;
    };
  }, []);

  const { unresolved, featured, community, bounty, bountyCandidates } = useMemo(() => {
    if (!markets) return { unresolved: [], featured: [], community: [], bounty: [], bountyCandidates: [] };
    const unresolved = markets.filter((m) => m.state === 0);
    // Featured = Matchday Top Gainer + Season Champion (league templates).
    const featured = unresolved.filter((m) => m.templateId === TEMPLATES.TOP_GAINER || m.templateId === TEMPLATES.CHAMPION);
    const community = unresolved.filter((m) => m.templateId !== TEMPLATES.TOP_GAINER && m.templateId !== TEMPLATES.CHAMPION);
    const nowSec = Math.floor(Date.now() / 1000);
    // Markets past their end time are awaiting permissionless resolution.
    // The contract checks whether the template's outcome data is available.
    const bounty = unresolved
      .filter((m) => Number(m.endTime) <= nowSec && m.totalStaked > 0n)
      .sort((a, b) => a.totalStaked > b.totalStaked ? -1 : a.totalStaked < b.totalStaked ? 1 : 0);
    // Only markets with winning stakes can have outstanding claims.
    const bountyCandidates = markets.filter((m) => m.state === 1 && m.outcomeTotals.some(
      (total, index) => total > 0n && (m.winnerBitmap & (1n << BigInt(index))) !== 0n
    ));
    return { unresolved, featured, community, bounty, bountyCandidates };
  }, [markets]);
  const claimQuery = useQuery({
    queryKey: ["marketClaims", playerAddress?.toLowerCase(), bountyCandidates.map((m) => m.marketKey)],
    enabled: Boolean(playerAddress && bountyCandidates.length),
    gcTime: 0,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!playerAddress) return [] as string[];
      const client = getPublicClient();
      const claimable: string[] = [];
      for (let offset = 0; offset < bountyCandidates.length; offset += 25) {
        const chunk = bountyCandidates.slice(offset, offset + 25);
        const claimedResults = await client.multicall({
          contracts: chunk.map((market) => ({
            address: market.factoryAddress, abi: MARKET_FACTORY_ABI,
            functionName: "claimed" as const, args: [market.id, playerAddress] as const,
          })),
          allowFailure: true,
        });
        if (claimedResults.some((result) => result.status !== "success")) throw new Error("Could not check market claims.");
        const unclaimed = chunk.filter((_, index) => claimedResults[index].result === false);
        if (unclaimed.length === 0) continue;
        const winningOutcomes = unclaimed.map((market) => market.outcomeTotals.flatMap((_, index) =>
          (market.winnerBitmap & (1n << BigInt(index))) !== 0n ? [index] : []
        ));
        const stakeResults = await client.multicall({
          contracts: unclaimed.flatMap((market, index) => winningOutcomes[index].map((outcome) => ({
            address: market.factoryAddress, abi: MARKET_FACTORY_ABI,
            functionName: "stakes" as const, args: [market.id, playerAddress, BigInt(outcome)] as const,
          }))),
          allowFailure: true,
        });
        if (stakeResults.some((result) => result.status !== "success")) throw new Error("Could not check winning stakes.");
        let resultIndex = 0;
        unclaimed.forEach((market, index) => {
          const count = winningOutcomes[index].length;
          const hasWinningStake = stakeResults.slice(resultIndex, resultIndex + count)
            .some((result) => result.status === "success" && result.result > 0n);
          if (hasWinningStake) claimable.push(market.marketKey);
          resultIndex += count;
        });
      }
      return claimable;
    },
  });
  const winnings = bountyCandidates.filter((market) => claimQuery.data?.includes(market.marketKey));
  const winningsLoading = Boolean(playerAddress && bountyCandidates.length && claimQuery.isPending);
  const visible = tab === "all" ? unresolved : tab === "featured" ? featured : tab === "bounty" ? bounty : winnings;

  if (!MARKET_FACTORY_ADDRESS && !NEW_MARKET_FACTORY_ADDRESS) {
    return (
      <div className="py-10">
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><CupOutrightMarketCard /></div>
        <EmptyState
          title="Markets not deployed yet"
          message="The MarketFactory contract hasn't been deployed on this network. Community markets go live with the v0.2 redeploy."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-10">
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><CupOutrightMarketCard /></div>
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <SectionTitle title="Prediction Markets" />
          <p className="mt-1 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Users className="h-4 w-4 text-[#2E7CF6]" />
            Permissionless outrights — anyone can create a market, anyone can resolve it.
            Every market resolves from on-chain data, never by vote.
          </p>
        </div>
        <Link
          href="/markets/create"
          className="gradient-cta flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(46,124,246,0.4)] transition-all hover:shadow-[0_0_30px_rgba(46,124,246,0.6)] active:scale-95"
        >
          <Plus className="h-4 w-4" />
          Create market
        </Link>
      </div>

      <div role="tablist" aria-label="Market filters" className="mb-6 flex flex-wrap gap-2">
        {([
          ["all", "All markets", unresolved.length + (cupConfigured ? 1 : 0)],
          ["featured", "Featured", featured.length + (cupConfigured ? 1 : 0)],
          ["bounty", "Bounty", bounty.length],
          ["winnings", "Winnings", winningsLoading ? "…" : winnings.length],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-xl border px-4 py-2 text-sm font-semibold transition-colors",
              tab === key
                ? "border-[#2E7CF6] bg-[#2E7CF6] text-white"
                : "border-black/10 text-zinc-600 hover:border-[#2E7CF6]/50 dark:border-white/10 dark:text-zinc-300"
            )}
          >
            {label} <span className="ml-1 opacity-70">{count}</span>
          </button>
        ))}
      </div>

      {tab === "bounty" && <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">These markets have passed their end time and have stakes. Anyone can resolve one to earn the resolver fee once its outcome data is available.</p>}
      {tab === "winnings" && <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">Resolved markets with your unclaimed winnings.</p>}

      {!markets || (tab === "winnings" && winningsLoading) ? (
        <SkeletonCards cards={6} />
      ) : tab === "winnings" && claimQuery.isError ? (
        <ErrorState message="Could not load your market claims." onRetry={() => void claimQuery.refetch()} />
      ) : visible.length === 0 && !((tab === "all" || tab === "featured") && cupConfigured) ? (
        <EmptyState
          title={tab === "winnings" ? playerAddress ? "No winnings to claim" : "Connect your wallet to view claims" : tab === "bounty" ? "No resolver bounties right now" : tab === "featured" ? "No featured markets right now" : "No unresolved markets right now"}
          message={tab === "winnings" ? playerAddress ? "Resolved markets with unclaimed winnings will appear here." : "Your unclaimed winnings will appear here once your wallet is connected." : tab === "bounty" ? "Markets with stakes will appear here after their end time until they resolve." : "New markets will appear here when they are created."}
        />
      ) : tab === "bounty" || tab === "winnings" ? (
        <div role="tabpanel" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((m) => <MarketCard key={m.marketKey} market={m} teams={teams ?? []} fixtures={fixtures} prices={prices} priceFresh={priceStatus !== "stale"} feesBps={feesBps} quoteAsOf={updatedAt} />)}
        </div>
      ) : (
        <div role="tabpanel">
          {(featured.length > 0 || cupConfigured) && (
            <section className="mb-10">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <Trophy className="h-5 w-5 text-amber-500" />
                Featured
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cupConfigured && <CupOutrightMarketCard />}
                {featured.map((m) => (
                  <MarketCard key={m.marketKey} market={m} teams={teams ?? []} fixtures={fixtures} prices={prices} priceFresh={priceStatus !== "stale"} feesBps={feesBps} quoteAsOf={updatedAt} />
                ))}
              </div>
            </section>
          )}
          {tab === "all" && <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Users className="h-5 w-5 text-[#2E7CF6]" />
              Community
              <span className="text-sm font-normal text-zinc-500">
                ({community.length})
              </span>
            </h2>
            {community.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {community.map((m) => (
                  <MarketCard key={m.marketKey} market={m} teams={teams ?? []} fixtures={fixtures} prices={prices} priceFresh={priceStatus !== "stale"} feesBps={feesBps} quoteAsOf={updatedAt} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No community markets yet"
                message="Create the first one with the button above."
              />
            )}
          </section>}
        </div>
      )}
    </div>
  );
}

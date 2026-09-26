/**
 * Markets page (v0.2): the permissionless outright-markets board.
 *
 * Two sections:
 * - Featured markets (league-created templates, e.g. Matchday Top Gainer)
 * - Community markets (created by anyone via the factory)
 *
 * Each card shows the template, outcomes, pool size, betting-close
 * countdown, creator name, and state. Click through to /markets/[id] for
 * the detail view with the "how this resolves" transparency panel.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trophy, Users, Clock } from "lucide-react";
import { getPublicClient } from "../../hooks/usePublicClient";
import { useTeams } from "../../hooks/useTeams";
import {
  MARKET_FACTORY_ADDRESS,
  MARKET_FACTORY_ABI,
  TEMPLATE_NAMES,
  MARKET_STATE_NAMES,
} from "../../lib/marketFactory";
import { SectionTitle, ErrorState, EmptyState, SkeletonCards } from "../../components/States";
import { Countdown } from "../../components/Countdown";
import { cn } from "../../lib/cn";
import { formatTick } from "../../lib/format";

export interface MarketSummary {
  id: bigint;
  templateId: number;
  creator: string;
  creatorName: string;
  bettingCloseTime: bigint;
  endTime: bigint;
  outcomeCount: number;
  seedAmount: bigint;
  totalStaked: bigint;
  state: number;
  winnerBitmap: bigint;
}

function useMarkets() {
  const publicClient = getPublicClient();
  const [markets, setMarkets] = useState<MarketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!MARKET_FACTORY_ADDRESS) return;
    let alive = true;
    (async () => {
      try {
        const count = (await publicClient.readContract({
          address: MARKET_FACTORY_ADDRESS,
          abi: MARKET_FACTORY_ABI,
          functionName: "marketCount",
        })) as bigint;
        const ids: bigint[] = [];
        for (let i = 0n; i < count; i++) ids.push(i);
        // Newest first.
        ids.reverse();
        const results = await Promise.all(
          ids.map(async (id) => {
            const [info, settlement] = await Promise.all([
              publicClient.readContract({
                address: MARKET_FACTORY_ADDRESS!,
                abi: MARKET_FACTORY_ABI,
                functionName: "marketInfo",
                args: [id],
              }),
              publicClient.readContract({
                address: MARKET_FACTORY_ADDRESS!,
                abi: MARKET_FACTORY_ABI,
                functionName: "marketSettlement",
                args: [id],
              }),
            ]);
            return { info: info as any, settlement: settlement as any };
          })
        );
        if (!alive) return;
        setMarkets(
          results.map(({ info: m, settlement: s }, i: number) => ({
            id: ids[i],
            templateId: m.templateId as number,
            creator: m.creator as string,
            creatorName: m.creatorName as string,
            bettingCloseTime: m.bettingCloseTime as bigint,
            endTime: m.endTime as bigint,
            outcomeCount: m.outcomeCount as number,
            seedAmount: s.seedAmount as bigint,
            totalStaked: s.totalStaked as bigint,
            state: s.state as number,
            winnerBitmap: s.winnerBitmap as bigint,
          }))
        );
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [publicClient]);

  return { markets, error };
}

function MarketCard({ market }: { market: MarketSummary }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const bettingOpen =
    market.state === 0 && Number(market.bettingCloseTime) > nowSec;
  const poolTick = Number(market.totalStaked + market.seedAmount) / 1e18;

  return (
    <Link
      href={`/markets/${market.id.toString()}`}
      className="glass group rounded-2xl p-5 transition-all hover:border-[#2E7CF6]/40 hover:shadow-[0_0_30px_rgba(46,124,246,0.15)]"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-[#2E7CF6]">
            {TEMPLATE_NAMES[market.templateId] ?? `Template ${market.templateId}`}
          </div>
          <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {market.outcomeCount} outcomes · created by{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-200">
              {market.creatorName || `${market.creator.slice(0, 6)}…${market.creator.slice(-4)}`}
            </span>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
            market.state === 0 &&
              "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            market.state === 1 && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
            market.state === 2 && "bg-zinc-500/10 text-zinc-500"
          )}
        >
          {MARKET_STATE_NAMES[market.state]}
        </span>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
          <Trophy className="h-4 w-4 text-amber-500" />
          <span className="font-semibold">{poolTick.toLocaleString()} TICK</span>
          <span className="text-zinc-400">pool</span>
        </div>
        {bettingOpen ? (
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Clock className="h-3.5 w-3.5" />
            <span>Closes in <Countdown target={Number(market.bettingCloseTime) * 1000} /></span>
          </div>
        ) : market.state === 0 ? (
          <span className="text-xs text-amber-600 dark:text-amber-400">Betting closed</span>
        ) : null}
      </div>
    </Link>
  );
}

export default function MarketsPage() {
  const { markets, error } = useMarkets();
  const { teams } = useTeams();

  const { featured, community } = useMemo(() => {
    if (!markets) return { featured: null, community: null };
    // Featured = Matchday Top Gainer + Season Champion (league templates).
    const featured = markets.filter((m) => m.templateId === 0 || m.templateId === 1);
    const community = markets.filter((m) => m.templateId !== 0 && m.templateId !== 1);
    return { featured, community };
  }, [markets]);

  if (!MARKET_FACTORY_ADDRESS) {
    return (
      <div className="py-10">
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

      {!markets ? (
        <SkeletonCards cards={6} />
      ) : markets.length === 0 ? (
        <EmptyState
          title="No markets yet"
          message="Be the first to create one — pick a template, pay the 250 TICK seed, and your market is live."
        />
      ) : (
        <>
          {featured && featured.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <Trophy className="h-5 w-5 text-amber-500" />
                Featured
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featured.map((m) => (
                  <MarketCard key={m.id.toString()} market={m} />
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Users className="h-5 w-5 text-[#2E7CF6]" />
              Community
              <span className="text-sm font-normal text-zinc-500">
                ({community?.length ?? 0})
              </span>
            </h2>
            {community && community.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {community.map((m) => (
                  <MarketCard key={m.id.toString()} market={m} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No community markets yet"
                message="Create the first one with the button above."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

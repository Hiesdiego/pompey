"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useMarkets } from "../lib/query/useMarkets";
import { useMarketFees } from "../lib/query/useMarketFees";
import { usePriceFeed } from "../lib/price/usePriceFeed";
import { MARKET_FACTORY_ADDRESS, TEMPLATES, marketRouteKey } from "../lib/marketFactory";
import { MarketCard, type MarketSummary, type TeamRef } from "./MarketCard";
import type { ApiFixture } from "../lib/api";

export function SimilarMarkets({
  currentId,
  factoryAddress,
  templateId,
  currentParams,
  teams,
  fixtures,
}: {
  currentId: bigint;
  factoryAddress: `0x${string}`;
  templateId: number;
  currentParams: `0x${string}`;
  teams: TeamRef[];
  fixtures: Map<string, ApiFixture>;
}) {
  const { markets, dataUpdatedAt } = useMarkets();
  const { feesBps } = useMarketFees();
  const { prices, status: priceStatus } = usePriceFeed(true);
  const nowSec = Math.floor(Date.now() / 1000);

  const items = useMemo(() => {
    const available: MarketSummary[] = [];
    for (const source of markets ?? []) {
      try {
        const address = source.factoryAddress ?? MARKET_FACTORY_ADDRESS;
        if (source.templateId !== templateId || source.state !== 0) continue;
        if (BigInt(source.bettingCloseTime) <= BigInt(nowSec)) continue;
        if (address.toLowerCase() === factoryAddress.toLowerCase() && BigInt(source.id) === currentId) continue;
        if (source.outcomeTotals.length !== source.outcomeCount) continue;
        available.push({
          id: BigInt(source.id),
          marketKey: source.marketKey ?? marketRouteKey(address, source.id),
          factoryAddress: address,
          templateId: source.templateId,
          creator: source.creator,
          creatorName: source.creatorName,
          bettingCloseTime: BigInt(source.bettingCloseTime),
          endTime: BigInt(source.endTime),
          outcomeCount: source.outcomeCount,
          seedAmount: BigInt(source.seedAmount),
          totalStaked: BigInt(source.totalStaked),
          state: source.state,
          winnerBitmap: BigInt(source.winnerBitmap),
          params: source.params as `0x${string}`,
          outcomeTotals: source.outcomeTotals.map((total) => BigInt(total)),
          lastStakeAt: 0,
        });
      } catch {
        continue;
      }
    }

    const currentTarget = currentParams.slice(2, 66).toLowerCase();
    available.sort((a, b) => {
      if (templateId === TEMPLATES.TARGET) {
        const aSame = a.params.slice(2, 66).toLowerCase() === currentTarget;
        const bSame = b.params.slice(2, 66).toLowerCase() === currentTarget;
        if (aSame !== bSame) return aSame ? -1 : 1;
      }
      const aPool = a.totalStaked + a.seedAmount;
      const bPool = b.totalStaked + b.seedAmount;
      return aPool > bPool ? -1 : aPool < bPool ? 1 : 0;
    });
    return available.slice(0, 10);
  }, [markets, nowSec, currentId, factoryAddress, templateId, currentParams]);

  if (!items.length) return null;

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl font-black">Similar markets</h2>
        <Link href="/markets" className="flex items-center gap-1 text-sm font-bold text-[#2E7CF6] hover:underline">
          View all <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((market) => (
          <MarketCard
            key={`${market.factoryAddress}:${market.id}`}
            market={market}
            teams={teams}
            fixtures={fixtures}
            prices={prices}
            priceFresh={priceStatus !== "stale"}
            feesBps={feesBps}
            quoteAsOf={dataUpdatedAt}
          />
        ))}
      </div>
    </section>
  );
}

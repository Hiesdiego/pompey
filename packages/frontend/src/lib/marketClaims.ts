import type { Address } from "viem";
import { getPublicClient } from "../hooks/usePublicClient";
import { fetchMarketsDirect, proxyGet, type MarketSummary } from "./chainDirect";
import { MARKET_FACTORY_ABI, MARKET_FACTORY_ADDRESS } from "./marketFactory";

export interface ClaimableMarket {
  kind: "market";
  market: MarketSummary;
  amount: bigint;
}

export async function scanMarketClaims(player: Address): Promise<ClaimableMarket[]> {
  if (!MARKET_FACTORY_ADDRESS) return [];
  let markets: MarketSummary[];
  try {
    markets = (await proxyGet<{ markets: MarketSummary[] }>("/api/chain/markets")).markets;
  } catch {
    markets = (await fetchMarketsDirect()).markets;
  }

  const candidates = markets.filter((market) =>
    market.state === 2 ||
    (market.state === 1 && BigInt(market.payoutPerShare) > 0n &&
      market.outcomeTotals.some((total, index) =>
        BigInt(total) > 0n && (BigInt(market.winnerBitmap) & (1n << BigInt(index))) !== 0n))
  );
  const client = getPublicClient();
  const claimable: ClaimableMarket[] = [];

  for (let offset = 0; offset < candidates.length; offset += 25) {
    const chunk = candidates.slice(offset, offset + 25);
    const claimed = await client.multicall({
      contracts: chunk.map((market) => ({
        address: MARKET_FACTORY_ADDRESS,
        abi: MARKET_FACTORY_ABI,
        functionName: "claimed" as const,
        args: [BigInt(market.id), player] as const,
      })),
      allowFailure: true,
    });
    if (claimed.some((result) => result.status !== "success")) {
      throw new Error("Could not check market claims.");
    }
    const pending = chunk.filter((_, index) => claimed[index].result === false);
    const outcomes = pending.map((market) =>
      Array.from({ length: market.outcomeCount }, (_, index) => index).filter((index) =>
        market.state === 2 || (BigInt(market.winnerBitmap) & (1n << BigInt(index))) !== 0n)
    );
    const stakeCalls = pending.flatMap((market, index) => outcomes[index].map((outcome) => ({
      address: MARKET_FACTORY_ADDRESS,
      abi: MARKET_FACTORY_ABI,
      functionName: "stakes" as const,
      args: [BigInt(market.id), player, BigInt(outcome)] as const,
    })));
    if (stakeCalls.length === 0) continue;
    const stakes = await client.multicall({ contracts: stakeCalls, allowFailure: true });
    if (stakes.some((result) => result.status !== "success")) {
      throw new Error("Could not check market stakes.");
    }
    let stakeIndex = 0;
    pending.forEach((market, index) => {
      const amount = outcomes[index].reduce((sum) => {
        const stake = stakes[stakeIndex++].result as bigint;
        return sum + (market.state === 2
          ? stake
          : stake * BigInt(market.payoutPerShare) / 10n ** 18n);
      }, 0n);
      if (amount > 0n) claimable.push({ kind: "market", market, amount });
    });
  }
  return claimable;
}

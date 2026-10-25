import assert from "node:assert/strict";
import test from "node:test";
import type { CoingeckoPoller } from "./coingecko.js";
import { PriceFeed, PriceValidationError, type PrimaryPriceSource, type TeamPriceMap } from "./priceFeed.js";

const team: TeamPriceMap = {
  teamId: 0,
  coinbasePair: "BTC-USD",
  binanceSymbol: "BTCUSDT",
  coingeckoId: "bitcoin",
};

function source(price: string | null): PrimaryPriceSource {
  return { getLatest: () => price === null ? undefined : { price, receivedAtMs: Date.now() } };
}

function feed(coinbase: string | null, binance: string | null, coingecko: string | null): PriceFeed {
  const cg = { getPrice: () => coingecko === null ? undefined : { priceUsd: coingecko, receivedAtMs: Date.now() } } as unknown as CoingeckoPoller;
  return new PriceFeed(source(coinbase), [source(binance)], cg, [team], {
    maxDeviationBps: 200,
    coinbaseStaleAfterMs: 180_000,
    binanceStaleAfterMs: 65_000,
    coingeckoStaleAfterMs: 600_000,
  });
}

test("uses Coinbase, then Binance, then CoinGecko for an available quote", () => {
  assert.equal(feed("100", "100.5", "100.2").getValidatedPrice(0).source, "coinbase");
  assert.equal(feed(null, "100", "100.2").getValidatedPrice(0).source, "binance");
  assert.equal(feed(null, null, "100").getValidatedPrice(0).source, "coingecko-fallback");
});

test("blocks a divergent source from deciding a snapshot", () => {
  assert.throws(() => feed("100", "110", null).getValidatedPrice(0), PriceValidationError);
});

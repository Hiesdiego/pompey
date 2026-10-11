import assert from "node:assert/strict";
import { test } from "node:test";
import { TICKR_TEAMS } from "@tickr/shared";
import { fetchPriceHistory } from "./priceHistory.js";

const team = TICKR_TEAMS.find((item) => item.symbol === "SOL")!;

test("uses Binance candle closes when available", async () => {
  const fetcher = (async (url: string) => {
    assert.match(url, /symbol=SOLUSDT/);
    return new Response(JSON.stringify([[1000, 0, 0, 0, "12"], [2000, 0, 0, 0, "13"]]));
  }) as typeof fetch;
  const points = await fetchPriceHistory(team, "https://binance.example", "https://coingecko.example", "", fetcher);
  assert.deepEqual(points, [
    { t: 1000, p: 12, source: "Binance" },
    { t: 2000, p: 13, source: "Binance" },
  ]);
});

test("uses CoinGecko history when Binance is unavailable", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string, options?: RequestInit) => {
    urls.push(url);
    if (urls.length === 1) return new Response("blocked", { status: 451 });
    assert.equal((options?.headers as Record<string, string>)["x-cg-demo-api-key"], "demo-key");
    return new Response(JSON.stringify({ prices: [[1000, 12], [2000, 13]] }));
  }) as typeof fetch;
  const points = await fetchPriceHistory(team, "https://binance.example", "https://coingecko.example", "demo-key", fetcher);
  assert.match(urls[1], /coins\/solana\/market_chart/);
  assert.deepEqual(points, [
    { t: 1000, p: 12, source: "CoinGecko" },
    { t: 2000, p: 13, source: "CoinGecko" },
  ]);
});

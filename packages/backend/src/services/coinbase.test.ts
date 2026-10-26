import assert from "node:assert/strict";
import test from "node:test";
import { CoinbasePoller } from "./coinbase.js";

test("accepts a Coinbase Exchange ticker price", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://api.exchange.coinbase.com/products/BTC-USD/ticker");
    return new Response(JSON.stringify({ price: "100.25" }), { status: 200 });
  };
  try {
    const poller = new CoinbasePoller(["BTC-USD"], "https://api.exchange.coinbase.com", 60_000);
    await poller.pollPairs(["BTC-USD"]);
    assert.equal(poller.getLatest("BTC-USD")?.price, "100.25");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a nonpositive Coinbase Exchange ticker price", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ price: "0" }), { status: 200 });
  try {
    const poller = new CoinbasePoller(["BTC-USD"], "https://api.exchange.coinbase.com", 60_000);
    await poller.pollPairs(["BTC-USD"]);
    assert.equal(poller.getLatest("BTC-USD"), undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

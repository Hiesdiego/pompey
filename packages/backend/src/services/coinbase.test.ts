import assert from "node:assert/strict";
import test from "node:test";
import { CoinbasePoller } from "./coinbase.js";

test("accepts Coinbase's documented spot response without a base field", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { amount: "100.25", currency: "USD" } }), { status: 200 });
  try {
    const poller = new CoinbasePoller(["BTC-USD"], "https://api.coinbase.com", 60_000);
    await poller.pollPairs(["BTC-USD"]);
    assert.equal(poller.getLatest("BTC-USD")?.price, "100.25");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a quote for the wrong currency", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { amount: "100.25", currency: "EUR" } }), { status: 200 });
  try {
    const poller = new CoinbasePoller(["BTC-USD"], "https://api.coinbase.com", 60_000);
    await poller.pollPairs(["BTC-USD"]);
    assert.equal(poller.getLatest("BTC-USD"), undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

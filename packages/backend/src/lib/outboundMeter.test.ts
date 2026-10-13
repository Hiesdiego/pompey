import assert from "node:assert/strict";
import test from "node:test";
import { installOutboundMeter } from "./outboundMeter.js";
import { meter } from "./net.js";

test("counts outgoing RPC request bytes and failed responses", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("failed", { status: 503 });
  try {
    installOutboundMeter();
    const response = await fetch("https://rpc.example/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getLogs", params: [], id: 1 }),
    });
    assert.equal(response.status, 503);
    const counts = meter.snapshot().counts;
    assert.equal(counts["outbound_calls:rpc:eth_getLogs"], 1);
    assert.equal(counts["outbound_failures:rpc:eth_getLogs"], 1);
    assert.ok(counts["outbound_bytes:rpc:eth_getLogs"] > 50);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

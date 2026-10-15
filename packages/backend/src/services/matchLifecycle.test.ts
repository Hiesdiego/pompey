import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicClient } from "viem";
import type { PriceFeed } from "./priceFeed.js";
import type { SnapshotSubmitter } from "./snapshotSubmitter.js";

test("lifecycle reads and reveals a fixture only when its reveal slot arrives", async () => {
  process.env.BACKEND_SIGNER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  process.env.MARKET_FACTORY_ADDRESS = `0x${"22".repeat(20)}`;
  process.env.SCHEDULER_MODE = "event";
  const { MatchLifecycle } = await import("./matchLifecycle.js");
  const actualNow = Date.now;
  const base = 2_000_000_000_000;
  let now = base;
  Date.now = () => now;
  let fixtureReads = 0;
  const reveals: Array<{ id: bigint; kickoff: bigint }> = [];
  const fixture = {
    homeTeamId: 0,
    awayTeamId: 1,
    matchdayIndex: 0,
    windowStart: BigInt((base + 60 * 60_000) / 1000),
    windowEnd: BigInt((base + 8 * 60 * 60_000) / 1000),
    kickoffTimestamp: 0n,
    kickoffRevealed: false,
    settled: false,
    matchEndTimestamp: 0n,
    voided: false,
  };
  const client = {
    readContract: async () => 1n,
    multicall: async () => {
      fixtureReads++;
      return [{ status: "success", result: fixture }];
    },
  } as unknown as PublicClient;
  const submitter = {
    revealKickoff: async (id: bigint, kickoff: bigint) => {
      reveals.push({ id, kickoff });
      return { fixtureId: id, kickoffTimestamp: kickoff, kind: "revealKickoff", seasonId: 1n };
    },
  } as unknown as SnapshotSubmitter;
  const lifecycle = new MatchLifecycle({} as PriceFeed, submitter, client);
  try {
    await lifecycle.start();
    assert.equal(fixtureReads, 1);
    assert.equal(reveals.length, 0);
    const slot = lifecycle.getScheduledKickoffs().get(0n)!;
    const nextWakeAt = (time: number) =>
      (lifecycle as unknown as { nextWakeAt(now: number): number }).nextWakeAt(time);
    assert.equal(nextWakeAt(now), slot - 120 * 60_000);
    now = slot - 120 * 60_000 - 1_000;
    await (lifecycle as unknown as { tick(): Promise<void> }).tick();
    assert.equal(fixtureReads, 1);
    now = slot - 120 * 60_000;
    await (lifecycle as unknown as { tick(): Promise<void> }).tick();
    assert.equal(fixtureReads, 2);
    assert.deepEqual(reveals, [{ id: 0n, kickoff: BigInt(Math.floor(slot / 1000)) }]);
    assert.equal(nextWakeAt(now), now + 2 * 60_000);
    fixture.kickoffRevealed = true;
    fixture.kickoffTimestamp = BigInt(Math.floor(slot / 1000));
    now += 2 * 60_000;
    await (lifecycle as unknown as { tick(): Promise<void> }).tick();
    assert.equal(fixtureReads, 3);
    assert.equal(lifecycle.getFixtures()[0].kickoffMs, slot);
    assert.equal(reveals.length, 1);
    assert.equal(nextWakeAt(now), slot);
  } finally {
    lifecycle.stop();
    Date.now = actualNow;
  }
});

test("boot reconciliation submits a missing end snapshot after a missed match", async () => {
  process.env.BACKEND_SIGNER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  process.env.MARKET_FACTORY_ADDRESS = `0x${"22".repeat(20)}`;
  process.env.SCHEDULER_MODE = "event";
  const { MatchLifecycle } = await import("./matchLifecycle.js");
  const actualNow = Date.now;
  const base = 2_000_000_000_000;
  Date.now = () => base;
  const fixture = {
    homeTeamId: 0,
    awayTeamId: 1,
    matchdayIndex: 0,
    windowStart: BigInt((base - 24 * 60 * 60_000) / 1000),
    windowEnd: BigInt((base + 24 * 60 * 60_000) / 1000),
    kickoffTimestamp: BigInt((base - 2 * 60 * 60_000) / 1000),
    kickoffRevealed: true,
    settled: false,
    matchEndTimestamp: BigInt((base - 60 * 60_000) / 1000),
    voided: false,
  };
  const client = {
    readContract: async () => 1n,
    multicall: async () => [{ status: "success", result: fixture }],
  } as unknown as PublicClient;
  const calls: bigint[] = [];
  const submitter = {
    submitEndPrice: async (id: bigint) => {
      calls.push(id);
      return { skipped: true, skipReason: "endPrice already submitted on-chain" };
    },
  } as unknown as SnapshotSubmitter;
  const feed = {
    getValidatedPrice: () => ({ scaled: 100n, source: "test" }),
    describeQuote: () => "test",
  } as unknown as PriceFeed;
  const lifecycle = new MatchLifecycle(feed, submitter, client);
  try {
    await lifecycle.start();
    assert.deepEqual(calls, [0n]);
  } finally {
    lifecycle.stop();
    Date.now = actualNow;
  }
});

test("revealed fixture wakes at kickoff for its start snapshot", async () => {
  process.env.BACKEND_SIGNER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  process.env.MARKET_FACTORY_ADDRESS = `0x${"22".repeat(20)}`;
  process.env.SCHEDULER_MODE = "event";
  const { MatchLifecycle } = await import("./matchLifecycle.js");
  const actualNow = Date.now;
  const base = 2_000_000_000_000;
  let now = base;
  Date.now = () => now;
  const kickoff = base + 60 * 60_000;
  const fixture = {
    homeTeamId: 0,
    awayTeamId: 1,
    matchdayIndex: 0,
    windowStart: BigInt((base - 60 * 60_000) / 1000),
    windowEnd: BigInt((base + 24 * 60 * 60_000) / 1000),
    kickoffTimestamp: BigInt(kickoff / 1000),
    kickoffRevealed: true,
    settled: false,
    matchEndTimestamp: BigInt((kickoff + 60 * 60_000) / 1000),
    voided: false,
  };
  const client = {
    readContract: async () => 1n,
    multicall: async () => [{ status: "success", result: fixture }],
  } as unknown as PublicClient;
  const starts: bigint[] = [];
  const submitter = {
    submitStartPrice: async (id: bigint) => {
      starts.push(id);
      return { skipped: true, skipReason: "startPrice already submitted on-chain" };
    },
  } as unknown as SnapshotSubmitter;
  const feed = {
    getValidatedPrice: () => ({ scaled: 100n, source: "test" }),
    describeQuote: () => "test",
  } as unknown as PriceFeed;
  const lifecycle = new MatchLifecycle(feed, submitter, client);
  try {
    await lifecycle.start();
    const nextWakeAt = (time: number) =>
      (lifecycle as unknown as { nextWakeAt(now: number): number }).nextWakeAt(time);
    assert.equal(nextWakeAt(now), kickoff);
    now = kickoff;
    await (lifecycle as unknown as { tick(): Promise<void> }).tick();
    assert.deepEqual(starts, [0n]);
    assert.equal(nextWakeAt(now), kickoff + 60 * 60_000);
  } finally {
    lifecycle.stop();
    Date.now = actualNow;
  }
});

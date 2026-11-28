import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";

process.env.BACKEND_SIGNER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
process.env.MARKET_FACTORY_ADDRESS = `0x${"22".repeat(20)}`;

const address = `0x${"33".repeat(20)}`;
const opponent = `0x${"44".repeat(20)}`;

test("Arena API supplies dates, hydrated sides and usable bracket rounds", async () => {
  const { buildArenaRouter } = await import("./arenaRoutes.js");
  const cup = { id: "cup", weekKey: "2026-11-23", status: "completed", champion: address,
    championSymbol: "MEME", runnerUp: opponent, runnerUpSymbol: "OTHER" };
  const deps = {
    registry: { getMemes: () => [{ address, symbol: "MEME", name: "My Meme", logoUrl: "https://example.com/logo.png", imageUrl: null }] },
    reader: {}, ratings: { getRankings: async () => ({ rankings: [{ address, symbol: "MEME", titles: 2 }] }) },
    cupService: { getCups: async () => [cup], getCurrentCup: async () => ({ cup, ties: [{
      round: "F", tieIndex: 0, memeA: address, symbolA: "MEME", memeB: opponent, symbolB: "OTHER", winner: address, status: "won",
    }] }) },
  } as unknown as Parameters<typeof buildArenaRouter>[0];
  const app = express(); app.use(buildArenaRouter(deps));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const history = await (await fetch(`${origin}/api/arena/cups`)).json() as {
      data: { cups: Array<{ weekStart: string; champion: { name: string; logoUrl: string }; runnerUp: { name: string } }> };
    };
    assert.equal(history.data.cups[0].weekStart, "2026-11-23");
    assert.equal(history.data.cups[0].champion.name, "My Meme");
    assert.equal(history.data.cups[0].champion.logoUrl, "https://example.com/logo.png");
    assert.equal(history.data.cups[0].runnerUp.name, "OTHER");
    const current = await (await fetch(`${origin}/api/arena/cups/current`)).json() as {
      data: { cup: { rounds: Array<{ round: number; ties: Array<{ memeA: { address: string }; status: string }> }> } };
    };
    assert.equal(current.data.cup.rounds[0].round, 0);
    assert.equal(current.data.cup.rounds[0].ties[0].memeA.address, address);
    assert.equal(current.data.cup.rounds[0].ties[0].status, "settled");
    const rankings = await (await fetch(`${origin}/api/arena/rankings`)).json() as {
      data: { rankings: Array<{ titles: number; name: string }> };
    };
    assert.equal(rankings.data.rankings[0].titles, 2);
    assert.equal(rankings.data.rankings[0].name, "My Meme");
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test("titles count completed cups by address across symbol changes", async () => {
  const { ArenaRatings } = await import("../services/arenaRatings.js");
  const db = { from: (table: string) => ({ select: () => table === "arena_ratings" ? {
    gte: () => ({ order: () => ({ limit: async () => ({ data: [{ address, symbol: "NEW", points: 1100,
      wins: 3, losses: 1, appearances: 2, first_appearance_at: "2026-11-01" }], error: null }) }) }),
  } : { eq: async (_column: string, status: string) => {
    assert.equal(status, "completed");
    return { data: [{ champion: address.toUpperCase(), runner_up: opponent }, { champion: address, runner_up: opponent },
      { champion: opponent, runner_up: address }], error: null };
  } } }) } as unknown as SupabaseClient;
  const result = await new ArenaRatings(db).getRankings();
  assert.equal(result.rankings[0].titles, 2);
  assert.equal(result.rankings[0].runnerUps, 1);
});

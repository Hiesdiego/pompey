import assert from "node:assert/strict";
import test from "node:test";
import { TICKR_TEAMS } from "@tickr/shared";
import { CUP_TEAM_PRICE_MAP, CUP_TEAM_SYMBOLS, CUP_TARGET_ORACLE_OFFSET } from "./cupTeams.js";
import { buildTargetTeamDirectory } from "./teamDirectory.js";

test("team directory includes every distinct Price Target coin with logo metadata", () => {
  const metadata = new Map([
    ["hyperliquid", { name: "Hyperliquid", imageUrl: "https://example.com/hype.png" }],
  ]);
  const teams = buildTargetTeamDirectory(metadata);
  const leagueSymbols = new Set(TICKR_TEAMS.map((team) => team.symbol));
  const cupOnly = CUP_TEAM_PRICE_MAP.filter((team) => {
    const cupSymbol = CUP_TEAM_SYMBOLS[team.teamId];
    return !leagueSymbols.has(cupSymbol === "TRON" ? "TRX" : cupSymbol === "PENGUIN" ? "PENGU" : cupSymbol);
  });

  assert.equal(teams.length, cupOnly.length);
  assert.equal(new Set(teams.map((team) => team.teamId)).size, teams.length);
  for (const coin of cupOnly) {
    assert.ok(teams.some((team) => team.teamId === CUP_TARGET_ORACLE_OFFSET + coin.teamId));
  }
  assert.equal(teams.find((team) => team.teamId === CUP_TARGET_ORACLE_OFFSET + 6)?.imageUrl, "https://example.com/hype.png");
  assert.ok(teams.every((team) => team.teamId >= CUP_TARGET_ORACLE_OFFSET));
});

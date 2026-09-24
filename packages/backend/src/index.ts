import "dotenv/config";
import express from "express";
import { TICKR_TEAMS, getChainConfig } from "@tickr/shared";

const app = express();
const PORT = process.env.PORT ?? 4000;

app.get("/health", (_req, res) => {
  const chain = getChainConfig();
  res.json({
    status: "ok",
    chain: chain.name,
    chainId: chain.chainId,
    teamCount: TICKR_TEAMS.length,
  });
});

/**
 * Phase 2 will add:
 * - /services/priceAggregator.ts   (CoinGecko poller + Binance WS client)
 * - /services/kickoffMonitor.ts    (VRF reveal window watcher)
 * - /services/matchTimer.ts        (match lifecycle automation)
 * - /routes/fixtures.ts, /routes/leaderboard.ts, /routes/profile.ts
 * - WebSocket server for live match price streams
 */

app.listen(PORT, () => {
  console.log(`TICKR backend (Phase 0 scaffold) listening on :${PORT}`);
});

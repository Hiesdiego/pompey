/**
 * WebSocket server for the frontend (spec P2.7 — live channels).
 *
 * Broadcasts every 5 seconds to all connected clients:
 *   { type: "prices", prices: [{ teamId, symbol, price, source, ok }] }
 *   { type: "fixtures", fixtures: [...] }   (only when the set changes)
 *
 * Clients get a full snapshot on connect, then deltas via the broadcast.
 * This keeps the frontend's match pages (live % bars, pool sizes, timers)
 * fresh without polling the REST API.
 */

import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { TICKR_TEAMS } from "@tickr/shared";
import { logger } from "../lib/logger.js";
import { scaledToPrice } from "../lib/priceMath.js";
import type { PriceFeed } from "../services/priceFeed.js";
import type { MatchLifecycle } from "../services/matchLifecycle.js";

const BROADCAST_MS = 5_000;

export class LiveWsServer {
  private wss: WebSocketServer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastFixtureHash = "";

  constructor(
    private readonly priceFeed: PriceFeed,
    private readonly lifecycle: MatchLifecycle
  ) {}

  attach(httpServer: Server, path = "/ws"): void {
    this.wss = new WebSocketServer({ server: httpServer, path });
    this.wss.on("connection", (socket: WebSocket) => {
      logger.debug("[LiveWs] client connected");
      this.sendSnapshot(socket);
      socket.on("error", (err) => logger.debug("[LiveWs] socket error", { error: String(err) }));
    });

    this.timer = setInterval(() => this.broadcast(), BROADCAST_MS);
    this.timer.unref?.();
    logger.info("[LiveWs] listening", { path, everyMs: BROADCAST_MS });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.wss?.close();
    this.wss = null;
  }

  private snapshot() {
    const prices = TICKR_TEAMS.map((t) => {
      try {
        const q = this.priceFeed.getValidatedPrice(t.teamId);
        return { teamId: t.teamId, symbol: t.symbol, price: scaledToPrice(q.scaled), source: q.source, ok: true as const };
      } catch {
        return { teamId: t.teamId, symbol: t.symbol, price: null, source: null, ok: false as const };
      }
    });
    const fixtures = this.lifecycle.getFixtures().map((f) => ({
      fixtureId: f.fixtureId.toString(),
      kickoffRevealed: f.kickoffRevealed,
      kickoffMs: f.kickoffMs,
      settled: f.settled,
      matchdayIndex: f.matchdayIndex,
    }));
    return { prices, fixtures };
  }

  private sendSnapshot(socket: WebSocket): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    const { prices, fixtures } = this.snapshot();
    socket.send(JSON.stringify({ type: "prices", prices }));
    socket.send(JSON.stringify({ type: "fixtures", fixtures }));
  }

  private broadcast(): void {
    if (!this.wss) return;
    const { prices, fixtures } = this.snapshot();
    const fixtureHash = JSON.stringify(fixtures);
    const fixturesChanged = fixtureHash !== this.lastFixtureHash;
    if (fixturesChanged) this.lastFixtureHash = fixtureHash;

    for (const client of this.wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(JSON.stringify({ type: "prices", prices }));
      if (fixturesChanged) client.send(JSON.stringify({ type: "fixtures", fixtures }));
    }
  }
}

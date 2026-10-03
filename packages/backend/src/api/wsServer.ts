/**
 * WebSocket server for the frontend (spec P2.7 — live channels).
 *
 * Optimization pass: the 5-second PRICE broadcast is GONE. Live prices now
 * stream directly from Binance on each frontend client (see the frontend's
 * usePriceFeed) — pushing the same 20-team snapshot to every connected
 * client every 5s was server egress that scaled with the user count for no
 * reason. This socket now carries only FIXTURE state changes (kickoff
 * revealed / settled), checked every 30s and pushed only when changed.
 *
 * Messages:
 *   { type: "fixtures", fixtures: [...] }   (snapshot on connect + on change)
 */

import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "../lib/logger.js";
import type { MatchLifecycle } from "../services/matchLifecycle.js";

const FIXTURE_CHECK_MS = 30_000;

export class LiveWsServer {
  private wss: WebSocketServer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastFixtureHash = "";

  constructor(private readonly lifecycle: MatchLifecycle) {}

  attach(httpServer: Server, path = "/ws"): void {
    this.wss = new WebSocketServer({ server: httpServer, path });
    this.wss.on("connection", (socket: WebSocket) => {
      logger.debug("[LiveWs] client connected");
      this.sendSnapshot(socket);
      socket.on("error", (err) => logger.debug("[LiveWs] socket error", { error: String(err) }));
    });

    this.timer = setInterval(() => this.broadcastIfChanged(), FIXTURE_CHECK_MS);
    this.timer.unref?.();
    logger.info("[LiveWs] listening (fixtures-only)", { path, everyMs: FIXTURE_CHECK_MS });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.wss?.close();
    this.wss = null;
  }

  private snapshot() {
    return this.lifecycle.getFixtures().map((f) => ({
      fixtureId: f.fixtureId.toString(),
      kickoffRevealed: f.kickoffRevealed,
      kickoffMs: f.kickoffMs,
      settled: f.settled,
      matchdayIndex: f.matchdayIndex,
    }));
  }

  private sendSnapshot(socket: WebSocket): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "fixtures", fixtures: this.snapshot() }));
  }

  private broadcastIfChanged(): void {
    if (!this.wss) return;
    const fixtures = this.snapshot();
    const fixtureHash = JSON.stringify(fixtures);
    if (fixtureHash === this.lastFixtureHash) return;
    this.lastFixtureHash = fixtureHash;

    for (const client of this.wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(JSON.stringify({ type: "fixtures", fixtures }));
    }
  }
}

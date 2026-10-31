import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { PriceFeed } from "./priceFeed.js";
import type { CupLifecycle, CupMatchView } from "./cupLifecycle.js";
import { CUP_TEAM_SYMBOLS } from "./cupTeams.js";
import { cupLiveScore, cupTieWinner } from "./cupCommentaryMath.js";

type Voice = "professional" | "witty";
type Kind = "kickoff" | "goal" | "chalked-off" | "pressure" | "stalemate" | "near-miss" | "ht" | "ft";
export interface CommentaryLine {
  id: string;
  matchId: number;
  minute: number;
  voice: Voice;
  text: string;
  eventType: Kind;
  tokensUsed: number;
  createdAt: string;
}
type State = { scoreA: number; scoreB: number; lastMinute: number; half: boolean; lastMood: number; lastWitty: number; near: string; lastLine: number };
type Snapshot = { startA: bigint; startB: bigint; endA: bigint; endB: bigint; startSubmitted: boolean; endSubmitted: boolean };
const snapshotAbi = [{ type: "function", name: "getSnapshot", stateMutability: "view", inputs: [{ name: "matchId", type: "uint16" }], outputs: [{ type: "tuple", components: [
  { name: "startA", type: "uint256" }, { name: "startB", type: "uint256" }, { name: "endA", type: "uint256" }, { name: "endB", type: "uint256" }, { name: "startSubmitted", type: "bool" }, { name: "endSubmitted", type: "bool" },
] }] }] as const;
const banned = /\b(manipulat(?:ion|ed|e)|rigged|insider|buy|sell|long|short|guaranteed|kalshi|polymarket)\b/i;

export class CupCommentary {
  private readonly states = new Map<number, State>();
  private readonly lines = new Map<number, CommentaryLine[]>();
  private readonly lineCacheAt = new Map<number, number>();
  private readonly llmBackoffUntil = new Map<Voice, number>();
  private readonly llmAttemptedEvents = new Set<string>();
  private readonly client = createPublicClient({ chain: config.chainEnv === "mainnet" ? base : baseSepolia, transport: http(config.chainEnv === "mainnet" ? config.baseMainnetRpcUrl : config.baseSepoliaRpcUrl) });
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private dailyTokens = 0;
  private day = "";

  constructor(private readonly lifecycle: CupLifecycle, private readonly feed: PriceFeed, private readonly db: SupabaseClient | null) {}

  async start() {
    if (!this.db) { logger.warn("[CupCommentary] Supabase required; commentary disabled"); return; }
    const { error } = await this.db.from("cup_commentary_lines").select("id").limit(1);
    if (error) { logger.error("[CupCommentary] table unavailable; run backend/sql/cup-commentary.sql", { error: error.message }); return; }
    await this.refreshDailyTokens();
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref?.();
    await this.tick();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private async refreshDailyTokens() {
    this.day = new Date().toISOString().slice(0, 10);
    const { data, error } = await this.db!.from("cup_commentary_lines").select("tokens_used").gte("created_at", `${this.day}T00:00:00.000Z`);
    if (error) throw error;
    this.dailyTokens = (data ?? []).reduce((total, row) => total + (row.tokens_used ?? 0), 0);
  }

  async getLines(matchId: number): Promise<CommentaryLine[]> {
    if (!this.db) return [];
    const cached = this.lines.get(matchId);
    if (cached && (cached.some((line) => line.eventType === "ft") || Date.now() - (this.lineCacheAt.get(matchId) ?? 0) < 5_000)) return cached;
    const { data, error } = await this.db.from("cup_commentary_lines").select("event_id,match_id,minute,voice,text,event_type,tokens_used,created_at").eq("match_id", String(matchId)).order("created_at", { ascending: true });
    if (error) throw error;
    const lines = (data ?? []).map((row) => ({ id: row.event_id, matchId: Number(row.match_id), minute: row.minute, voice: row.voice, text: row.text, eventType: row.event_type, tokensUsed: row.tokens_used, createdAt: row.created_at })) as CommentaryLine[];
    this.lines.set(matchId, lines);
    this.lineCacheAt.set(matchId, Date.now());
    return lines;
  }

  private async tick() {
    if (this.busy || !this.db) return;
    this.busy = true;
    try {
      const currentDay = new Date().toISOString().slice(0, 10);
      if (currentDay !== this.day) await this.refreshDailyTokens();
      for (const match of this.lifecycle.getMatches()) {
        if (match.teamA === 65535 || match.teamB === 65535 || !match.kickoffMs || Date.now() < match.kickoffMs || match.state === 0) continue;
        try { await this.observe(match); } catch (error) { logger.warn("[CupCommentary] match observation failed", { matchId: match.matchId, error: String(error) }); }
      }
    } finally { this.busy = false; }
  }

  private async observe(match: CupMatchView) {
    const existing = this.lines.get(match.matchId) ?? await this.getLines(match.matchId);
    this.lines.set(match.matchId, existing);
    if (existing.some((line) => line.eventType === "ft")) return;
    const snapshot = await this.client.readContract({ address: config.cup.engine, abi: snapshotAbi, functionName: "getSnapshot", args: [match.matchId] }) as Snapshot;
    if (!snapshot.startSubmitted) return;
    const now = Date.now();
    const minute = Math.max(0, Math.min(60, Math.floor((now - match.kickoffMs) / 60_000)));
    let priceA: bigint;
    let priceB: bigint;
    if (snapshot.endSubmitted) { priceA = snapshot.endA; priceB = snapshot.endB; }
    else {
      if (minute >= 60) return;
      const quoteA = this.feed.getValidatedPrice(match.teamA);
      const quoteB = this.feed.getValidatedPrice(match.teamB);
      if (now - quoteA.receivedAtMs > 180_000 || now - quoteB.receivedAtMs > 180_000) return;
      priceA = quoteA.scaled;
      priceB = quoteB.scaled;
    }
    const score = cupLiveScore(snapshot.startA, snapshot.startB, priceA, priceB);
    const prior = [...existing].reverse().find((line) => line.eventType === "goal" || line.eventType === "chalked-off" || line.eventType === "kickoff");
    const state = this.states.get(match.matchId) ?? { scoreA: prior ? Number(prior.text.match(/\b(\d+)-(\d+)\b/)?.[1] ?? 0) : 0, scoreB: prior ? Number(prior.text.match(/\b(\d+)-(\d+)\b/)?.[2] ?? 0) : 0, lastMinute: -1, half: existing.some((line) => line.eventType === "ht"), lastMood: -10, lastWitty: -10, near: "", lastLine: 0 };
    this.states.set(match.matchId, state);
    const names = [CUP_TEAM_SYMBOLS[match.teamA], CUP_TEAM_SYMBOLS[match.teamB]];
    const facts = { matchId: match.matchId, minute, teamA: names[0], teamB: names[1], scoreA: score.scoreA, scoreB: score.scoreB, moveA: score.moveA, moveB: score.moveB };
    if (!existing.length) await this.publish(match, "kickoff", "professional", facts, `${minute === 0 ? "Kickoff" : "Joining the match"}. ${names[0]} ${score.scoreA}-${score.scoreB} ${names[1]} in minute ${minute}.`, 0);
    if (!state.half && minute >= 30 && !snapshot.endSubmitted) {
      state.half = await this.publish(match, "ht", "professional", facts, `Half-time. ${names[0]} ${score.scoreA}-${score.scoreB} ${names[1]}. The score remains live.`, 0);
    }
    if (snapshot.endSubmitted) {
      if (match.state === 2) {
        const winner = CUP_TEAM_SYMBOLS[match.winner];
        const tie = score.scoreA === score.scoreB;
        const expected = tie ? cupTieWinner(match.teamA, match.teamB, snapshot.startA, snapshot.startB, priceA, priceB) : score.scoreA > score.scoreB ? match.teamA : match.teamB;
        if (expected !== match.winner) throw new Error("Settled winner differs from snapshot score");
        await this.publish(match, "ft", "professional", { ...facts, minute: 60 }, `Full-time. ${names[0]} ${score.scoreA}-${score.scoreB} ${names[1]}. ${winner} advances${tie ? " on the price-performance tie-break" : ""}.`, 0);
      }
      return;
    }
    if (state.scoreA !== score.scoreA || state.scoreB !== score.scoreB) {
      const kind: Kind = score.scoreA < state.scoreA || score.scoreB < state.scoreB ? "chalked-off" : "goal";
      const published = await this.publish(match, kind, "professional", facts, `${kind === "goal" ? "GOAL" : "Score revised after a price retrace"}. ${names[0]} ${score.scoreA}-${score.scoreB} ${names[1]} in minute ${minute}.`, 0);
      if (published) { state.scoreA = score.scoreA; state.scoreB = score.scoreB; state.near = ""; }
      if (published && Math.random() < 0.5) await this.publish(match, kind, "witty", facts, kind === "goal" ? `The chart has spoken. ${names[0]} ${score.scoreA}-${score.scoreB} ${names[1]} in minute ${minute}.` : `The market took that goal back. ${names[0]} ${score.scoreA}-${score.scoreB} ${names[1]} in minute ${minute}.`, 1);
    } else if (minute > state.lastMinute && minute < 60 && minute - state.lastMood >= 5) {
      const close = Math.max(Math.abs(score.moveA * 2 - Math.round(score.moveA * 2)), Math.abs(score.moveB * 2 - Math.round(score.moveB * 2)));
      const kind: Kind = close > 0.35 ? "near-miss" : Math.abs(score.moveA - score.moveB) >= 0.3 ? "pressure" : "stalemate";
      const chance = minute >= 20 && score.scoreA === 0 && score.scoreB === 0 ? 0.38 : 0.18;
      if (Math.random() < chance) {
        const template = kind === "stalemate" ? `${names[0]} ${score.scoreA}-${score.scoreB} ${names[1]} in minute ${minute}. Both charts are making the booth work for it.` : `${names[0]} ${score.scoreA}-${score.scoreB} ${names[1]} in minute ${minute}. Price action is keeping this tie alive.`;
        if (await this.publish(match, kind, "witty", facts, template, 2)) state.lastMood = minute;
      }
    }
    state.lastMinute = minute;
  }

  private async publish(match: CupMatchView, kind: Kind, voice: Voice, facts: Record<string, string | number>, template: string, priority: number): Promise<boolean> {
    const lines = this.lines.get(match.matchId)!;
    const cap = Number(process.env.COMMENTARY_MAX_LINES_PER_MATCH || 24);
    if (lines.length >= cap && priority > 0) return false;
    const minute = Number(facts.minute);
    const eventId = `${match.matchId}:${kind}:${voice}:${kind === "ft" || kind === "ht" || kind === "kickoff" ? kind : `${minute}:${facts.scoreA}:${facts.scoreB}`}`;
    if (lines.some((line) => line.id === eventId)) return true;
    let text = template;
    let tokensUsed = 0;
    const key = voice === "professional"
      ? process.env.COMMENTARY_LLM_PRO_API_KEY
      : process.env.COMMENTARY_LLM_WITTY_API_KEY;
    const matchTokens = lines.reduce((total, line) => total + line.tokensUsed, 0);
    const sampleAi = priority === 0 || Math.random() < 0.5;
    if (process.env.COMMENTARY_ENABLED === "true" && key && sampleAi && !this.llmAttemptedEvents.has(eventId) && Date.now() >= (this.llmBackoffUntil.get(voice) ?? 0) && this.dailyTokens + 500 <= Number(process.env.COMMENTARY_DAILY_TOKEN_BUDGET || 30_000) && matchTokens + 500 <= Number(process.env.COMMENTARY_MATCH_TOKEN_BUDGET || 5_000)) {
      this.llmAttemptedEvents.add(eventId);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        try {
          const model = voice === "professional" ? process.env.COMMENTARY_LLM_PRO_MODEL : process.env.COMMENTARY_LLM_WITTY_MODEL;
          const response = await fetch(`${process.env.COMMENTARY_LLM_BASE_URL || "https://api.groq.com/openai/v1"}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ model, max_tokens: 60, temperature: voice === "witty" ? 0.8 : 0.3, messages: [
            { role: "system", content: `You are the ${voice === "professional" ? "precise lead" : "witty, dry colour"} commentator for TICKR's Crypto Price World Cup. Write one short sentence. Use only supplied facts. Include exact score and minute. Scores before full-time are live. Never give financial advice or invent news, prices, events, or winners. Never mention AI.` },
            { role: "user", content: JSON.stringify({ event: kind, facts, previousLines: lines.slice(-2).map((line) => line.text), fallback: template }) },
          ] }) });
          if (!response.ok) {
            this.llmBackoffUntil.set(voice, Date.now() + (response.status === 429 ? 120_000 : response.status >= 500 ? 30_000 : 15 * 60_000));
          }
          if (response.ok) {
            const body = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
            const candidate = body.choices?.[0]?.message?.content?.trim().replace(/[“”]/g, "").replace(/[—–]/g, ",");
            tokensUsed = body.usage?.total_tokens ?? 300;
            const allowedNumbers = new Set(Object.values(facts).filter((value) => typeof value === "number").flatMap((value) => String(value).match(/\d+(?:\.\d+)?/g) ?? []));
            const candidateNumbers = candidate?.match(/\d+(?:\.\d+)?/g) ?? [];
            if (candidate && candidate.length <= 280 && !banned.test(candidate) && candidate.includes(`${facts.scoreA}-${facts.scoreB}`) && new RegExp(`\\b${minute}\\b`).test(candidate) && candidateNumbers.every((number) => allowedNumbers.has(number))) text = candidate;
          }
        } finally { clearTimeout(timeout); }
      } catch (error) {
        this.llmBackoffUntil.set(voice, Date.now() + 60_000);
        logger.warn("[CupCommentary] LLM fallback", { matchId: match.matchId, error: String(error) });
      }
    }
    this.dailyTokens += tokensUsed;
    const { data, error } = await this.db!.from("cup_commentary_lines").insert({ match_id: String(match.matchId), minute, voice, text, event_type: kind, event_id: eventId, tokens_used: tokensUsed }).select("id,created_at").single();
    if (error) {
      if (error.code === "23505") {
        this.lineCacheAt.delete(match.matchId);
        await this.getLines(match.matchId);
        return true;
      }
      logger.error("[CupCommentary] insert failed", { matchId: match.matchId, error: error.message });
      return false;
    }
    lines.push({ id: eventId, matchId: match.matchId, minute, voice, text, eventType: kind, tokensUsed, createdAt: data.created_at });
    this.lineCacheAt.set(match.matchId, Date.now());
    return true;
  }
}

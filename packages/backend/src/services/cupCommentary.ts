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
export type CupMomentumSample = { minute: number; at: string; a: number; b: number; score: [number, number] };
type State = { scoreA: number; scoreB: number; lastMinute: number; half: boolean; lastMood: number; lastWitty: number; near: string; lastLine: number };
type Snapshot = { startA: bigint; startB: bigint; endA: bigint; endB: bigint; startSubmitted: boolean; endSubmitted: boolean };
const snapshotAbi = [{ type: "function", name: "getSnapshot", stateMutability: "view", inputs: [{ name: "matchId", type: "uint16" }], outputs: [{ type: "tuple", components: [
  { name: "startA", type: "uint256" }, { name: "startB", type: "uint256" }, { name: "endA", type: "uint256" }, { name: "endB", type: "uint256" }, { name: "startSubmitted", type: "bool" }, { name: "endSubmitted", type: "bool" },
] }] }] as const;
const banned = /\b(manipulat(?:ion|ed|e)|rigged|insider|guaranteed|kalshi|polymarket)\b/i;
// buy, sell, long, and short are deliberately not banned: they are ordinary
// football words ("long ball", "short on luck"). Financial-advice protection
// lives in the LLM system prompt and in the number grounding below.

type TemplateFacts = { teamA: string; teamB: string; scoreA: number; scoreB: number; minute: number; winner?: string; tie?: boolean; reply?: boolean };
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
// Every variant carries the exact score and minute, so the score parsed back
// from a line in observe() stays correct and the Producer grounding holds.
// near-miss, pressure, and stalemate lines are always witty (mood lane), so
// those variants are written in that voice.
function templateFor(kind: Kind, voice: Voice, f: TemplateFacts): string {
  const score = `${f.teamA} ${f.scoreA}-${f.scoreB} ${f.teamB}`;
  const at = `in minute ${f.minute}`;
  switch (kind) {
    case "kickoff":
      if (voice === "witty") {
        return pick([
          `Dee, I'm watching the charts and keeping my predictions to myself. ${score} ${at}.`,
          `You set the scene, Dee; I'll keep an eye on the scoreboard. ${score} ${at}.`,
          `Glad to be in the booth, Dee. ${score} ${at}; let's see which chart blinks first.`,
          `Dee, the teams are ready and so is my running commentary. ${score} ${at}.`,
        ]);
      }
      if (f.minute > 0) {
        return pick([
          `We're joining ${f.teamA} and ${f.teamB} ${at}, with ${score}. Rekt, what catches your eye?`,
          `Welcome to the booth. ${score} ${at}. Rekt, you're just in time to weigh in.`,
        ]);
      }
      return pick([
        `Welcome to ${f.teamA} against ${f.teamB}. ${score} ${at}. Rekt, what are you watching?`,
        `We're under way: ${score} ${at}. Rekt, take us into the action.`,
        `The booth is open for ${f.teamA} versus ${f.teamB}. ${score} ${at}. Rekt, your first impression?`,
        `Here we go: ${score} ${at}. Rekt, what could make this one interesting?`,
      ]);
    case "ht":
      return pick([
        `Half-time. ${score}. The score remains live.`,
        `Half-time. ${score}. Everything still to play for.`,
        `Half-time. ${score}. The second half is all to play for.`,
      ]);
    case "ft": {
      const through = f.tie ? " on the price-performance tie-break" : "";
      return pick([
        `Full-time. ${score}. ${f.winner} advances${through}.`,
        `Full-time. ${score}. ${f.winner} goes through${through}.`,
      ]);
    }
    case "goal":
      if (voice === "witty") {
        if (f.reply) return pick([`Dee, that chart found the net before I found a comeback. ${score} ${at}.`, `You called it, Dee; the scoreboard moved. ${score} ${at}.`]);
        return pick([
          `The chart has spoken. ${score} ${at}.`,
          `Somebody check on the other chart. ${score} ${at}.`,
          `That one counted, for now. ${score} ${at}.`,
          `The price moved and the scoreboard noticed. ${score} ${at}.`,
        ]);
      }
      if (f.reply) return pick([`Rekt, the score confirms it. ${score} ${at}.`, `And there it is, Rekt. ${score} ${at}.`]);
      return pick([
        `GOAL. ${score} ${at}.`,
        `GOAL. ${score} ${at}. The move pays off.`,
        `GOAL. ${score} ${at}. That is a goal on the board.`,
      ]);
    case "chalked-off":
      if (voice === "witty") {
        if (f.reply) return pick([`Dee, that celebration had a short shelf life. ${score} ${at}.`, `That's a quick reversal, Dee. ${score} ${at}.`]);
        return pick([
          `The market took that goal back. ${score} ${at}.`,
          `Never mind. The price changed its mind. ${score} ${at}.`,
          `That goal has left the building. ${score} ${at}.`,
          `Blink and the scoreboard changes. ${score} ${at}.`,
        ]);
      }
      if (f.reply) return pick([`Rekt, the score has been revised. ${score} ${at}.`, `You're right to pause, Rekt. ${score} ${at}; that goal is gone.`]);
      return pick([
        `Score revised after a price retrace. ${score} ${at}.`,
        `That goal is chalked off. ${score} ${at}.`,
        `The price retraced and the goal is gone. ${score} ${at}.`,
      ]);
    case "near-miss":
      return pick([
        `${score} ${at}. Price action is keeping this tie alive.`,
        `${score} ${at}. So close the chart nearly scored.`,
        `${score} ${at}. The next goal is hiding somewhere in the order book.`,
      ]);
    case "pressure":
      return pick([
        `${score} ${at}. One side is doing all the pushing.`,
        `${score} ${at}. The pressure is building and the chart knows it.`,
        `${score} ${at}. Somebody is camped in the other half.`,
      ]);
    case "stalemate":
      return pick([
        `${score} ${at}. Both charts are making the booth work for it.`,
        `${score} ${at}. A staring contest with a scoreboard.`,
        `${score} ${at}. Neither chart is blinking.`,
      ]);
  }
}

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
  private momentumReady = false;

  constructor(private readonly lifecycle: CupLifecycle, private readonly feed: PriceFeed, private readonly db: SupabaseClient | null) {}

  async start() {
    if (!this.db) { logger.warn("[CupCommentary] Supabase required; commentary disabled"); return; }
    const { error } = await this.db.from("cup_commentary_lines").select("id").limit(1);
    if (error) { logger.error("[CupCommentary] table unavailable; run backend/sql/cup-commentary.sql", { error: error.message }); return; }
    const momentum = await this.db.from("cup_momentum_samples").select("match_id").limit(1);
    this.momentumReady = !momentum.error;
    if (momentum.error) logger.warn("[CupCommentary] momentum archive unavailable; run backend/sql/cup-commentary.sql", { error: momentum.error.message });
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

  async getMomentum(matchId: number): Promise<CupMomentumSample[]> {
    if (!this.db || !this.momentumReady) return [];
    const { data, error } = await this.db.from("cup_momentum_samples").select("minute,recorded_at,move_a,move_b,score_a,score_b").eq("match_id", String(matchId)).order("minute", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => ({ minute: row.minute, at: row.recorded_at, a: row.move_a, b: row.move_b, score: [row.score_a, row.score_b] }));
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
    if (this.momentumReady) {
      const { error } = await this.db!.from("cup_momentum_samples").insert({ match_id: String(match.matchId), minute, recorded_at: new Date(snapshot.endSubmitted ? match.kickoffMs + 60 * 60_000 : now).toISOString(), move_a: score.moveA, move_b: score.moveB, score_a: score.scoreA, score_b: score.scoreB });
      if (error && error.code !== "23505") logger.warn("[CupCommentary] momentum archive write failed", { matchId: match.matchId, minute, error: error.message });
    }
    const prior = [...existing].reverse().find((line) => line.eventType === "goal" || line.eventType === "chalked-off" || line.eventType === "kickoff");
    const state = this.states.get(match.matchId) ?? { scoreA: prior ? Number(prior.text.match(/\b(\d+)-(\d+)\b/)?.[1] ?? 0) : 0, scoreB: prior ? Number(prior.text.match(/\b(\d+)-(\d+)\b/)?.[2] ?? 0) : 0, lastMinute: -1, half: existing.some((line) => line.eventType === "ht"), lastMood: -10, lastWitty: -10, near: "", lastLine: 0 };
    this.states.set(match.matchId, state);
    const names = [CUP_TEAM_SYMBOLS[match.teamA], CUP_TEAM_SYMBOLS[match.teamB]];
    const facts = { matchId: match.matchId, minute, teamA: names[0], teamB: names[1], scoreA: score.scoreA, scoreB: score.scoreB, moveA: score.moveA, moveB: score.moveB };
    const kickoffFacts = { teamA: names[0], teamB: names[1], scoreA: score.scoreA, scoreB: score.scoreB, minute };
    if (!existing.some((line) => line.eventType === "kickoff" && line.voice === "professional")) {
      await this.publish(match, "kickoff", "professional", facts, templateFor("kickoff", "professional", kickoffFacts), 0);
    }
    if (existing.some((line) => line.eventType === "kickoff" && line.voice === "professional") && !existing.some((line) => line.eventType === "kickoff" && line.voice === "witty")) {
      await this.publish(match, "kickoff", "witty", facts, templateFor("kickoff", "witty", kickoffFacts), 0);
    }
    if (!state.half && minute >= 30 && !snapshot.endSubmitted) {
      state.half = await this.publish(match, "ht", "professional", facts, templateFor("ht", "professional", { teamA: names[0], teamB: names[1], scoreA: score.scoreA, scoreB: score.scoreB, minute }), 0);
    }
    if (snapshot.endSubmitted) {
      if (match.state === 2) {
        const winner = CUP_TEAM_SYMBOLS[match.winner];
        const tie = score.scoreA === score.scoreB;
        const expected = tie ? cupTieWinner(match.teamA, match.teamB, snapshot.startA, snapshot.startB, priceA, priceB) : score.scoreA > score.scoreB ? match.teamA : match.teamB;
        if (expected !== match.winner) throw new Error("Settled winner differs from snapshot score");
        await this.publish(match, "ft", "professional", { ...facts, minute: 60, winner, tieBreak: tie ? "price-performance tie-break" : "none" }, templateFor("ft", "professional", { teamA: names[0], teamB: names[1], scoreA: score.scoreA, scoreB: score.scoreB, minute: 60, winner, tie }), 0);
      }
      return;
    }
    if (state.scoreA !== score.scoreA || state.scoreB !== score.scoreB) {
      const kind: Kind = score.scoreA < state.scoreA || score.scoreB < state.scoreB ? "chalked-off" : "goal";
      // The lead voice alternates, so the witty commentator sometimes calls the
      // goal instead of only reacting to the professional one.
      const lead: Voice = Math.random() < 0.5 ? "witty" : "professional";
      const other: Voice = lead === "witty" ? "professional" : "witty";
      const tf = { teamA: names[0], teamB: names[1], scoreA: score.scoreA, scoreB: score.scoreB, minute };
      const published = await this.publish(match, kind, lead, facts, templateFor(kind, lead, tf), 0);
      if (published) { state.scoreA = score.scoreA; state.scoreB = score.scoreB; state.near = ""; }
      if (published && Math.random() < 0.5) await this.publish(match, kind, other, facts, templateFor(kind, other, { ...tf, reply: true }), 1);
    } else if (minute > state.lastMinute && minute < 60 && minute - state.lastMood >= 5) {
      const close = Math.max(Math.abs(score.moveA * 2 - Math.round(score.moveA * 2)), Math.abs(score.moveB * 2 - Math.round(score.moveB * 2)));
      const kind: Kind = close > 0.35 ? "near-miss" : Math.abs(score.moveA - score.moveB) >= 0.3 ? "pressure" : "stalemate";
      const chance = minute >= 20 && score.scoreA === 0 && score.scoreB === 0 ? 0.38 : 0.18;
      if (Math.random() < chance) {
        const template = templateFor(kind, "witty", { teamA: names[0], teamB: names[1], scoreA: score.scoreA, scoreB: score.scoreB, minute });
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
    if (process.env.COMMENTARY_ENABLED === "true" && key && !this.llmAttemptedEvents.has(eventId) && Date.now() >= (this.llmBackoffUntil.get(voice) ?? 0) && this.dailyTokens + 500 <= Number(process.env.COMMENTARY_DAILY_TOKEN_BUDGET || 30_000) && matchTokens + 500 <= Number(process.env.COMMENTARY_MATCH_TOKEN_BUDGET || 5_000)) {
      this.llmAttemptedEvents.add(eventId);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        try {
          const model = voice === "professional" ? process.env.COMMENTARY_LLM_PRO_MODEL : process.env.COMMENTARY_LLM_WITTY_MODEL;
          const previous = lines.at(-1);
          const replyTo = previous && previous.voice !== voice && previous.eventType === kind && (kind === "kickoff" || previous.minute === minute)
            ? { speaker: previous.voice === "professional" ? "Dee" : "Rekt", text: previous.text }
            : null;
          const system = voice === "professional"
            ? "You are Dee, the lively but precise lead commentator for TICKR's Crypto Price World Cup. Keep the booth conversational. State the exact score and minute, and use only supplied match facts. Vary your openings. Scores before full-time are live. Never give financial advice or invent news, prices, events, personal holdings, or winners beyond the supplied facts. Never mention AI."
            : "You are Rekt, the witty, dry colour commentator for TICKR's Crypto Price World Cup. Keep the booth conversational, sharp and varied. State the exact score and minute, and use only supplied match facts. A joke may be an opinion about the match, never a claim about real news or your finances. Scores before full-time are live. Never give financial advice or invent news, prices, events, personal holdings, or winners beyond the supplied facts. Never mention AI.";
          const direction = kind === "kickoff" && voice === "professional"
            ? "Open the broadcast by introducing both teams, then hand over to Rekt with a natural question. Use a different approach from previous openings."
            : replyTo
              ? `Respond to ${replyTo.speaker}'s actual remark, addressing them naturally. Add a fresh observation rather than repeating their words.`
              : "Call the match naturally. You may address the other commentator when it fits, but do not force a handoff on every line.";
          const recentOpenings = kind === "kickoff" && voice === "professional"
            ? [...this.lines.entries()].filter(([id]) => id !== match.matchId).flatMap(([, matchLines]) => matchLines.filter((line) => line.eventType === "kickoff" && line.voice === "professional").map((line) => line.text)).slice(-3)
            : [];
          const response = await fetch(`${process.env.COMMENTARY_LLM_BASE_URL || "https://api.groq.com/openai/v1"}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ model, max_tokens: kind === "kickoff" ? 100 : 70, temperature: voice === "witty" ? 0.8 : 0.5, messages: [
            { role: "system", content: system },
            // No fallback template is sent here. The model must write fresh, or
            // the template ships. Sending the fallback is what made the model
            // parrot the template verbatim.
            { role: "user", content: JSON.stringify({ event: kind, facts, direction, replyTo, previousLines: lines.slice(-2).map((line) => ({ speaker: line.voice === "professional" ? "Dee" : "Rekt", text: line.text })), recentOpeningsToAvoid: recentOpenings }) },
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
            const requiredAddress = kind === "kickoff" ? (voice === "professional" ? "Rekt" : "Dee") : replyTo?.speaker;
            // The minute may appear as "16", "16th", or "16'". Kickoff, half-time,
            // and full-time lines do not need a minute: the score and the event
            // carry the meaning, and forcing one dropped good lines.
            const minuteOk = kind === "kickoff" || kind === "ht" || kind === "ft" || new RegExp(`\\b${minute}(?:th|st|nd|rd|'|′)?\\b`).test(candidate ?? "");
            const rejectReason = !candidate ? "empty"
              : candidate.length > 280 ? "too-long"
              : banned.test(candidate) ? "banned-word"
              : !candidate.includes(`${facts.scoreA}-${facts.scoreB}`) ? "missing-score"
              : !minuteOk ? "missing-minute"
              : requiredAddress && !new RegExp(`\\b${requiredAddress}\\b`, "i").test(candidate) ? "missing-reply"
              : candidateNumbers.some((number) => !allowedNumbers.has(number)) ? "ungrounded-number"
              : null;
            if (candidate && !rejectReason) {
              text = candidate;
            } else {
              logger.warn("[CupCommentary] LLM line rejected", { matchId: match.matchId, eventId, reason: rejectReason ?? "empty", candidate: candidate?.slice(0, 120) });
            }
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

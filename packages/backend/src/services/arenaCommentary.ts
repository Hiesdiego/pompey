/**
 * Arena commentary: code-detected events, LLM-written lines,
 * append-only storage, mirroring services/cupCommentary.ts.
 *
 * Intended destination: packages/backend/src/services/arenaCommentary.ts.
 *
 * SCOPE IS STRICT (locked design): commentary exists ONLY on
 *   - Weekly Meme Cup semi-final and final ties, and
 *   - clashes listed in arena_featured_clashes.
 * Every other clash gets silence. The scope check runs before any
 * state is touched and before any LLM budget is spent, on every tick.
 *
 * ARCHITECTURE (mirrors cupCommentary.ts): events are detected by
 * CODE, never by the LLM. The keeper calls tick(clashes) on its
 * passes with the clashes it read; this service derives the live
 * scoreline from the reader's live move fields (which come from the
 * keeper's recorded start snapshots and current prices), compares it
 * with the last published state per clash, and publishes lines for:
 *   - window_start: the window opened (the Arena kickoff line);
 *   - lead_change: the strictly-greater side flipped;
 *   - goal: the display scoreline changed (either side);
 *   - window_end: the clash settled (full time, winner named from
 *     the factory result, never from the scoreline).
 * Lines are append-only in arena_commentary_lines (clash_id, voice,
 * kind, line, tokens_used, created_at), with a deterministic
 * event_id per (clash, kind, voice, score) so a restart never
 * double-publishes an event.
 *
 * VOICES AND MODELS reuse the cup booth: Dee (professional), Rekt
 * (witty) and Ora (analytics), with the same env model config pattern
 * (COMMENTARY_LLM_*), overridable per voice with ARENA_COMMENTARY_
 * prefixes (ARENA_COMMENTARY_LLM_PRO_API_KEY and friends). The same
 * token budget discipline applies: a per-clash budget and a daily
 * budget (ARENA_COMMENTARY_MATCH_TOKEN_BUDGET /
 * ARENA_COMMENTARY_DAILY_TOKEN_BUDGET, falling back to the cup
 * COMMENTARY_ values), a reserve check before every paid call, a
 * per-voice backoff on HTTP failure, and template lines that ship
 * whenever the LLM is off, over budget, or rejected. LLM output is
 * validated like the cup's: banned words, ungrounded numbers (any
 * number not present in the supplied facts), wrong-speaker labels,
 * and repeated lines are all rejected in favour of the template.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger.js";
import { commentaryCompletion, prepareCommentary } from "./cupCommentaryGeneration.js";
import type { ArenaClashSummary } from "./arenaClashReader.js";
import type { ArenaCupService } from "./arenaCupService.js";

type Voice = "professional" | "witty" | "analytics";
type Kind = "window_start" | "lead_change" | "goal" | "window_end";

export interface ArenaCommentaryLine {
  id: string;
  clashId: number;
  voice: Voice;
  kind: Kind;
  line: string;
  tokensUsed: number;
  createdAt: string;
}

interface ClashState {
  memeGoals: number;
  oppGoals: number;
  leader: "meme" | "opponent" | "tied";
  started: boolean;
  ended: boolean;
}

const banned = /\b(manipulat(?:ion|ed|e)|rigged|insider|guaranteed|kalshi|polymarket)\b/i;

function env(name: string, fallback?: string): string | undefined {
  const arena = process.env[`ARENA_${name}`];
  if (arena && arena.trim() !== "") return arena.trim();
  const shared = process.env[name];
  if (shared && shared.trim() !== "") return shared.trim();
  return fallback;
}

function leaderOf(clash: ArenaClashSummary): "meme" | "opponent" | "tied" {
  const meme = clash.liveMemeMovePct;
  const opp = clash.liveOppMovePct;
  if (meme === null || opp === null) return "tied";
  if (meme > opp) return "meme";
  if (opp > meme) return "opponent";
  return "tied";
}

function templateFor(kind: Kind, voice: Voice, clash: ArenaClashSummary, state: ClashState): string {
  const score = `${clash.memeSymbol} ${state.memeGoals}-${state.oppGoals} ${clash.opponentSymbol}`;
  switch (kind) {
    case "window_start":
      if (voice === "witty") return `Dee, a fresh window and a fresh chart. ${score} at the start.`;
      if (voice === "analytics") return `Window open. ${score}. The moves from here decide it, nothing else.`;
      return `We are under way: ${clash.memeSymbol} against ${clash.opponentSymbol}. ${score}. Rekt, what are you watching?`;
    case "lead_change":
      if (voice === "witty") return `Dee, the lead just changed hands. ${score}.`;
      if (voice === "analytics") return `Lead change. ${score}. The strictly greater move now sits with ${state.leader === "meme" ? clash.memeSymbol : clash.opponentSymbol}.`;
      return `The lead changes: ${score}.`;
    case "goal":
      if (voice === "witty") return `The price moved and the scoreboard noticed. ${score}.`;
      if (voice === "analytics") return `Goal on the board. ${score}.`;
      return `GOAL. ${score}.`;
    case "window_end": {
      const winnerName = clash.winner === 0 ? clash.memeSymbol : clash.winner === 1 ? clash.opponentSymbol : null;
      if (voice === "witty") return winnerName ? `Dee, full-time. ${score}. ${winnerName} takes it.` : `Full-time. ${score}.`;
      if (voice === "analytics") return `Full-time. ${score}.${winnerName ? ` ${winnerName} wins on the raw move.` : ""}`;
      return `Full-time. ${score}.${winnerName ? ` ${winnerName} wins.` : ""}`;
    }
  }
}

export class ArenaCommentary {
  private readonly states = new Map<number, ClashState>();
  private readonly linesCache = new Map<number, { at: number; lines: ArenaCommentaryLine[] }>();
  private readonly llmBackoffUntil = new Map<Voice, number>();
  private readonly llmAttemptedEvents = new Set<string>();
  private dailyTokens = 0;
  private day = "";

  constructor(
    private readonly db: SupabaseClient | null,
    private readonly cupService: ArenaCupService | null
  ) {}

  async start(): Promise<void> {
    if (!this.db) {
      logger.warn("[ArenaCommentary] Supabase required; commentary disabled");
      return;
    }
    const { error } = await this.db.from("arena_commentary_lines").select("id").limit(1);
    if (error) {
      logger.error("[ArenaCommentary] table unavailable; run the arena Supabase schema", { error: error.message });
      return;
    }
    await this.refreshDailyTokens();
    logger.info("[ArenaCommentary] starting (scope: cup SF/F and featured clashes only)");
  }

  stop(): void {
    // No timer of its own: the keeper drives tick() on its passes,
    // exactly like the cup commentary is driven by its lifecycle.
  }

  /** True only for cup semi-final and final ties and featured
   *  clashes. Everything else is out of scope, always. */
  async inScope(clash: ArenaClashSummary): Promise<boolean> {
    if (clash.cup && (clash.cup.round === "SF" || clash.cup.round === "F")) return true;
    if (clash.featured) return true;
    if (this.cupService) {
      const featured = await this.cupService.getFeaturedClashIds().catch(() => new Set<number>());
      if (featured.has(clash.id)) return true;
    }
    return false;
  }

  /** Keeper-driven observation pass for the clashes it just read. */
  async tick(clashes: ArenaClashSummary[]): Promise<void> {
    if (!this.db) return;
    const currentDay = new Date().toISOString().slice(0, 10);
    if (currentDay !== this.day) await this.refreshDailyTokens();
    for (const clash of clashes) {
      try {
        if (!(await this.inScope(clash))) continue;
        await this.observe(clash);
      } catch (err) {
        logger.warn("[ArenaCommentary] clash observation failed", { clashId: clash.id, error: String(err) });
      }
    }
  }

  /** Lines for one clash, for the reader to attach to featured and
   *  cup-late clash details. Cached 5s, mirroring the cup reader. */
  async getLines(clashId: number): Promise<ArenaCommentaryLine[]> {
    if (!this.db) return [];
    const cached = this.linesCache.get(clashId);
    if (cached && Date.now() - cached.at < 5_000) return cached.lines;
    const { data, error } = await this.db
      .from("arena_commentary_lines")
      .select("event_id,clash_id,voice,kind,line,tokens_used,created_at")
      .eq("clash_id", clashId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const lines = (data ?? []).map((row) => ({
      id: String(row.event_id),
      clashId: Number(row.clash_id),
      voice: row.voice as Voice,
      kind: row.kind as Kind,
      line: String(row.line),
      tokensUsed: Number(row.tokens_used ?? 0),
      createdAt: String(row.created_at),
    }));
    this.linesCache.set(clashId, { at: Date.now(), lines });
    return lines;
  }

  private async refreshDailyTokens(): Promise<void> {
    if (!this.db) return;
    this.day = new Date().toISOString().slice(0, 10);
    const { data, error } = await this.db
      .from("arena_commentary_lines")
      .select("tokens_used")
      .gte("created_at", `${this.day}T00:00:00.000Z`);
    if (error) throw error;
    this.dailyTokens = (data ?? []).reduce((total, row) => total + (Number(row.tokens_used) || 0), 0);
  }

  private async observe(clash: ArenaClashSummary): Promise<void> {
    const existing = await this.getLines(clash.id);
    const nowSec = Math.floor(Date.now() / 1000);
    const state: ClashState = this.states.get(clash.id) ?? {
      memeGoals: 0,
      oppGoals: 0,
      leader: "tied",
      started: existing.some((l) => l.kind === "window_start"),
      ended: existing.some((l) => l.kind === "window_end"),
    };
    this.states.set(clash.id, state);

    // Window start.
    if (!state.started && clash.state === 0 && nowSec >= clash.windowStart) {
      const facts = this.facts(clash, state);
      const lead = await this.publish(clash, "window_start", "professional", facts, templateFor("window_start", "professional", clash, state));
      if (lead) {
        state.started = true;
        await this.publish(clash, "window_start", "witty", facts, templateFor("window_start", "witty", clash, state));
      }
      return;
    }

    // Full time: the clash settled or voided. A void gets no winner
    // line (there is no winner); the state closes either way.
    if (!state.ended && clash.state !== 0) {
      state.ended = true;
      if (clash.state === 1) {
        const finalState: ClashState = {
          ...state,
          memeGoals: clash.liveMemeGoals ?? state.memeGoals,
          oppGoals: clash.liveOppGoals ?? state.oppGoals,
        };
        const facts = this.facts(clash, finalState);
        const lead = await this.publish(clash, "window_end", "professional", facts, templateFor("window_end", "professional", clash, finalState));
        if (lead) {
          await this.publish(clash, "window_end", "analytics", facts, templateFor("window_end", "analytics", clash, finalState));
        }
      }
      return;
    }
    if (clash.state !== 0 || nowSec < clash.windowStart || nowSec >= clash.windowEnd) return;
    if (clash.liveMemeGoals === null || clash.liveOppGoals === null) return;

    const leader = leaderOf(clash);
    const scoreChanged = clash.liveMemeGoals !== state.memeGoals || clash.liveOppGoals !== state.oppGoals;
    const leadChanged = state.started && leader !== state.leader && leader !== "tied" && state.leader !== "tied";
    const nextState: ClashState = {
      ...state,
      memeGoals: clash.liveMemeGoals,
      oppGoals: clash.liveOppGoals,
      leader,
    };
    if (scoreChanged) {
      const facts = this.facts(clash, nextState);
      const kind: Kind = leadChanged ? "lead_change" : "goal";
      const voice: Voice = Math.random() < 0.5 ? "witty" : "professional";
      const published = await this.publish(clash, kind, voice, facts, templateFor(kind, voice, clash, nextState));
      if (published) {
        this.states.set(clash.id, nextState);
        const other: Voice = voice === "witty" ? "professional" : "witty";
        if (Math.random() < 0.5) {
          await this.publish(clash, kind, other, facts, templateFor(kind, other, clash, nextState));
        }
      }
    } else if (leadChanged) {
      const facts = this.facts(clash, nextState);
      const published = await this.publish(clash, "lead_change", "analytics", facts, templateFor("lead_change", "analytics", clash, nextState));
      if (published) this.states.set(clash.id, nextState);
    }
  }

  private facts(clash: ArenaClashSummary, state: ClashState): Record<string, string | number> {
    return {
      clashId: clash.id,
      memeSymbol: clash.memeSymbol,
      opponentSymbol: clash.opponentSymbol,
      opponentKind: clash.opponentKind,
      scoreA: state.memeGoals,
      scoreB: state.oppGoals,
      memeMovePct: clash.liveMemeMovePct ?? clash.memeMovePct ?? 0,
      oppMovePct: clash.liveOppMovePct ?? clash.oppMovePct ?? 0,
      round: clash.cup?.round ?? "featured",
      winner: clash.winner === 0 ? clash.memeSymbol : clash.winner === 1 ? clash.opponentSymbol : "none yet",
    };
  }

  private async publish(
    clash: ArenaClashSummary,
    kind: Kind,
    voice: Voice,
    facts: Record<string, string | number>,
    template: string
  ): Promise<boolean> {
    if (!this.db) return false;
    const lines = await this.getLines(clash.id);
    const cap = Number(env("COMMENTARY_MAX_LINES_PER_MATCH", "24"));
    if (lines.length >= cap) return false;
    const eventId = `${clash.id}:${kind}:${voice}:${["window_start", "window_end"].includes(kind) ? kind : `${facts.scoreA}:${facts.scoreB}`}`;
    if (lines.some((line) => line.id === eventId)) return true;

    let text = template;
    let tokensUsed = 0;
    const key = env(
      voice === "professional" ? "COMMENTARY_LLM_PRO_API_KEY" : voice === "witty" ? "COMMENTARY_LLM_WITTY_API_KEY" : "COMMENTARY_LLM_ORACLE_API_KEY"
    );
    const model =
      env(voice === "professional" ? "COMMENTARY_LLM_PRO_MODEL" : voice === "witty" ? "COMMENTARY_LLM_WITTY_MODEL" : "COMMENTARY_LLM_ORACLE_MODEL") ||
      (voice === "professional" ? "openai/gpt-oss-120b" : voice === "witty" ? "openai/gpt-oss-20b" : "openai/gpt-oss-120b");
    const completion = commentaryCompletion(
      model,
      env(voice === "professional" ? "COMMENTARY_LLM_PRO_MAX_COMPLETION_TOKENS" : voice === "witty" ? "COMMENTARY_LLM_WITTY_MAX_COMPLETION_TOKENS" : "COMMENTARY_LLM_ORACLE_MAX_COMPLETION_TOKENS")
    );
    const tokenReserve = Number(env("COMMENTARY_TOKEN_RESERVE", "1000"));
    const clashTokens = lines.reduce((total, line) => total + line.tokensUsed, 0);
    const dailyBudget = Number(env("COMMENTARY_DAILY_TOKEN_BUDGET", "30000"));
    const clashBudget = Number(env("COMMENTARY_MATCH_TOKEN_BUDGET", "5000"));

    if (
      env("COMMENTARY_ENABLED") === "true" &&
      key &&
      !this.llmAttemptedEvents.has(eventId) &&
      Date.now() >= (this.llmBackoffUntil.get(voice) ?? 0) &&
      this.dailyTokens + tokenReserve <= dailyBudget &&
      clashTokens + tokenReserve <= clashBudget
    ) {
      this.llmAttemptedEvents.add(eventId);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);
        try {
          const system =
            voice === "professional"
              ? "You are Dee, the lively but precise lead commentator for TICKR's Stock Meme Arena. Write one or two short sentences, at most 160 characters. Use only supplied facts. Never give financial advice or invent news, prices, events, or winners beyond the supplied facts. Never mention AI."
              : voice === "witty"
                ? "You are Rekt, the witty, dry colour commentator for TICKR's Stock Meme Arena. Be a quick, mischievous football pundit with crypto-native humour about THIS clash. Write one or two short sentences, at most 160 characters. Use only supplied facts. Never give financial advice or invent news, prices, events, or winners beyond the supplied facts. Never mention AI."
                : "You are Ora, the Oracle, the analytics voice in TICKR's Stock Meme Arena booth. Speak in figures, never adjectives. Write one or two short sentences, at most 160 characters. Use only supplied facts, and use the supplied figures exactly, never compute a new number. Never give financial advice or invent news, prices, events, or winners beyond the supplied facts. Never mention AI.";
          const baseUrl = env("COMMENTARY_LLM_BASE_URL", "https://api.groq.com/openai/v1");
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              ...completion,
              temperature: voice === "witty" ? 1 : voice === "analytics" ? 0.3 : 0.7,
              messages: [
                { role: "system", content: system },
                { role: "user", content: JSON.stringify({ event: kind, facts, previousLines: lines.slice(-4).map((line) => ({ speaker: line.voice, text: line.line })) }) },
              ],
            }),
          });
          if (!response.ok) {
            logger.warn("[ArenaCommentary] LLM HTTP fallback", { clashId: clash.id, voice, model, status: response.status });
            this.llmBackoffUntil.set(voice, Date.now() + (response.status === 429 ? 120_000 : response.status >= 500 ? 30_000 : 15 * 60_000));
          }
          if (response.ok) {
            const body = (await response.json()) as { choices?: { finish_reason?: string; message?: { content?: string } }[]; usage?: { total_tokens?: number } };
            const output = body.choices?.[0]?.message?.content?.trim();
            const candidate = output
              ? prepareCommentary(output, { ...facts, minute: 0, teamA: String(facts.memeSymbol), teamB: String(facts.opponentSymbol) }, "live")
              : null;
            tokensUsed = body.usage?.total_tokens ?? tokenReserve;
            const allowedNumbers = new Set(Object.values(facts).flatMap((value) => String(value).match(/\d+(?:\.\d+)?/g) ?? []));
            const candidateNumbers = candidate?.match(/\d+(?:\.\d+)?/g) ?? [];
            const rejectReason =
              body.choices?.[0]?.finish_reason === "length" ? "truncated"
              : !output ? "empty"
              : !candidate ? "invalid-length"
              : banned.test(candidate) ? "banned-word"
              : voice === "professional" && /rekt:|ora:/i.test(candidate) ? "wrong-speaker"
              : voice === "witty" && /dee:|ora:/i.test(candidate) ? "wrong-speaker"
              : voice === "analytics" && /dee:|rekt:/i.test(candidate) ? "wrong-speaker"
              : candidateNumbers.some((number) => !allowedNumbers.has(number)) ? "ungrounded-number"
              : kind === "window_end" && !/full-time/i.test(candidate) ? "missing-full-time"
              : lines.slice(-6).some((line) => line.line === candidate) ? "repeated-line"
              : null;
            if (candidate && !rejectReason) {
              text = candidate;
            } else {
              logger.warn("[ArenaCommentary] LLM line rejected", { clashId: clash.id, eventId, voice, model, tokensUsed, reason: rejectReason ?? "empty" });
            }
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        this.llmBackoffUntil.set(voice, Date.now() + 60_000);
        logger.warn("[ArenaCommentary] LLM call failed, template ships", { clashId: clash.id, voice, error: String(err) });
      }
    }

    const { data, error } = await this.db
      .from("arena_commentary_lines")
      .insert({ clash_id: clash.id, voice, kind, line: text, event_id: eventId, tokens_used: tokensUsed })
      .select("id,created_at")
      .single();
    if (error) {
      if (error.code === "23505") return true; // duplicate event: already published
      logger.warn("[ArenaCommentary] line insert failed", { clashId: clash.id, eventId, error: error.message });
      return false;
    }
    void data;
    this.dailyTokens += tokensUsed;
    const cached = this.linesCache.get(clash.id);
    if (cached) {
      cached.lines.push({
        id: eventId,
        clashId: clash.id,
        voice,
        kind,
        line: text,
        tokensUsed,
        createdAt: new Date().toISOString(),
      });
    }
    return true;
  }
}

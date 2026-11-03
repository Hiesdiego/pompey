// Reasoning and spoken output share the provider's completion allowance.
export function commentaryCompletion(model: string, configured?: string) {
  const reasoning = /gpt-oss/i.test(model);
  const parsed = Number(configured);
  const limit = Number.isFinite(parsed) && parsed >= 128 ? Math.min(2048, Math.floor(parsed)) : reasoning ? 768 : 160;
  return { max_completion_tokens: limit, ...(reasoning ? { reasoning_effort: "low" } : {}) };
}

export function prepareCommentary(candidate: string, facts: Record<string, string | number>, kind = "live"): string | null {
  if (kind === "preview" || kind === "review") {
    const text = candidate.trim();
    if (text.length > 700) return null;
    if (kind === "preview" && /\b\d+\s*-\s*\d+\b/.test(text)) return null;
    if (kind === "review" && (text.match(/\b\d+\s*-\s*\d+\b/g) ?? []).some((score) => score.replace(/\s/g, "") !== `${facts.scoreA}-${facts.scoreB}`)) return null;
    return text;
  }
  const score = `${facts.scoreA}-${facts.scoreB}`;
  let text = candidate.trim().replace(/[“”]/g, '"').replace(/[–—]/g, "-");
  // Reject conflicting scores rather than quietly correcting a hallucination.
  const scores = text.match(/\b\d+\s*-\s*\d+\b/g) ?? [];
  if (scores.some((value) => value.replace(/\s/g, "") !== score)) return null;
  text = text.replace(/\b(\d+)\s*-\s*(\d+)\b/g, "$1-$2");
  const hasScore = scores.length > 0;
  const hasMinute = new RegExp(`\\b${facts.minute}(?:th|st|nd|rd)?\\b`).test(text.replace(/\b\d+-\d+\b/g, ""));
  if (!hasScore || !hasMinute) {
    text += ` (${!hasScore ? `${facts.teamA} ${score} ${facts.teamB}, ` : ""}${facts.minute}').`;
  }
  return text.length <= 280 ? text : null;
}

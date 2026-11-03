export type CommentaryLine = { id: string; minute: number; voice: "professional" | "witty"; text: string; eventType: string; createdAt: string };

export function commentaryPaths(matchId: number | string, lineId: string) {
  const suffix = `${matchId}/${encodeURIComponent(lineId)}`;
  return { page: `/cup/commentary/${suffix}`, image: `/api/social/og/commentary/${suffix}` };
}

// The producer validates and includes the score in every published line.
// Read that historical score, never today's live score, for an archived quote.
export function commentaryScore(text: string): string {
  const score = text.match(/\b(\d+)\s*[-–]\s*(\d+)\b/);
  return score ? `${score[1]} – ${score[2]}` : "VS";
}

export function commentator(voice: CommentaryLine["voice"]) {
  return voice === "professional" ? "DEE" : "REKT";
}

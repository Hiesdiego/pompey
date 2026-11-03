import "server-only";
import { cache } from "react";
import { cupMatch } from "@/app/api/social/og/_cup";
import { backendUrl } from "@/app/api/social/og/_shared";
import { CUP_TBD, cupTeamName } from "./cup";
import { commentaryScore, commentator, type CommentaryLine } from "./commentaryShare";

export const getCommentaryShare = cache(async (matchId: string, lineId: string) => {
  if (!/^(0|[1-9]\d?)$/.test(matchId) || Number(matchId) > 62 || lineId.length > 160 || !lineId.startsWith(`${matchId}:`) || !/^[\w:-]+$/.test(lineId)) return null;
  const [match, response] = await Promise.all([
    cupMatch(matchId),
    fetch(`${backendUrl()}/api/cup/matches/${matchId}/commentary`, { cache: "no-store", signal: AbortSignal.timeout(10000) }),
  ]);
  if (!response.ok) throw new Error("Commentary is temporarily unavailable");
  if (!match) throw new Error("Match is temporarily unavailable");
  if (match.teamA === CUP_TBD || match.teamB === CUP_TBD) return null;
  const body = await response.json() as { lines: CommentaryLine[] };
  const line = body.lines.find((entry) => entry.id === lineId);
  if (!line) return null;
  const speaker = commentator(line.voice);
  const score = commentaryScore(line.text);
  const title = `${cupTeamName(match.teamA)} ${score} ${cupTeamName(match.teamB)}`;
  return { match, line, speaker, score, title };
});

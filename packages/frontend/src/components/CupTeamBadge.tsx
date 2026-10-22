"use client";

import { useState } from "react";
import { useTeams } from "../hooks/useTeams";
import { CUP_TEAM_SYMBOLS, CUP_TBD, cupTeamName } from "../lib/cup";

// Cup-only assets have no matching league team metadata. Use verified CMC IDs.
const CUP_CMC_IDS: Record<number, number> = { 32: 36341, 33: 33251, 38: 32782, 49: 27750, 60: 34466 };

export function CupTeamBadge({ teamId, size = 34, showName = true }: { teamId: number; size?: number; showName?: boolean }) {
  const { teams } = useTeams();
  const [stage, setStage] = useState(0);
  const symbol = CUP_TEAM_SYMBOLS[teamId];
  const leagueTeam = teams.find((team) => team.symbol === symbol || (symbol === "TRON" && team.symbol === "TRX") || (symbol === "GRAM" && team.symbol === "TON"));
  const cmcId = CUP_CMC_IDS[teamId] ?? leagueTeam?.cmcId;
  const sources = [leagueTeam?.imageUrl, cmcId ? `https://s2.coinmarketcap.com/static/img/coins/64x64/${cmcId}.png` : null, symbol ? `https://assets.coincap.io/assets/icons/${symbol.toLowerCase()}@2x.png` : null].filter((src): src is string => !!src);
  if (teamId === CUP_TBD || !symbol) return <span className="text-sm font-semibold text-zinc-400">TBA</span>;
  return <span className="inline-flex min-w-0 items-center gap-2">
    {stage < sources.length ? /* eslint-disable-next-line @next/next/no-img-element */ <img key={sources[stage]} src={sources[stage]} alt="" width={size} height={size} onError={() => setStage((current) => current + 1)} className="shrink-0 rounded-full bg-white ring-1 ring-black/10 dark:ring-white/10" style={{ width: size, height: size }} /> : <span className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 font-display font-bold text-black" style={{ width: size, height: size, fontSize: size * .38 }}>{symbol[0]}</span>}
    {showName && <span className="min-w-0 truncate font-semibold text-zinc-800 dark:text-zinc-100">{cupTeamName(teamId)}</span>}
  </span>;
}

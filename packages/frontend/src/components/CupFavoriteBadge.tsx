"use client";

import { Flame } from "lucide-react";
import { CUP_TEAM_SYMBOLS, cupTeamName } from "../lib/cup";
import { CupTeamBadge } from "./CupTeamBadge";

export function CupFavoriteBadge({ teamId }: { teamId: number }) {
  return <span className="inline-flex items-center gap-2 rounded-full border border-orange-400/40 bg-orange-500/10 px-3 py-1.5 text-sm font-bold text-orange-700 dark:text-orange-300" title={`World Cup Fav: ${cupTeamName(teamId)}`}>
    <Flame aria-hidden="true" className="cup-favorite-flame h-4 w-4 text-orange-500 drop-shadow-[0_0_8px_rgba(249,115,22,.85)]" />
    <span>World Cup Fav</span><CupTeamBadge teamId={teamId} size={20} />
    <span>{CUP_TEAM_SYMBOLS[teamId]}</span>
  </span>;
}

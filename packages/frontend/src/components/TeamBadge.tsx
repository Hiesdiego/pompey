/**
 * TeamBadge — token logo (CoinGecko, via backend /api/teams) + name/symbol.
 */

"use client";

import { useState } from "react";
import { cn } from "../lib/cn";
import { useTeams, teamById, type TeamInfo } from "../hooks/useTeams";

function Logo({ team, size }: { team: TeamInfo; size: number }) {
  const [broken, setBroken] = useState(false);
  if (team.imageUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={team.imageUrl}
        alt={team.symbol}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="rounded-full"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex items-center justify-center rounded-full bg-gradient-to-br from-[#7F77DD] to-[#1D9E75] font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {team.symbol.slice(0, 1)}
    </span>
  );
}

export function TeamBadge({
  teamId,
  size = 32,
  showName = true,
  showSymbol = false,
  className = "",
}: {
  teamId: number;
  size?: number;
  showName?: boolean;
  showSymbol?: boolean;
  className?: string;
}) {
  const { teams } = useTeams();
  const team = teamById(teams, teamId);
  if (!team) return <span className="text-sm text-zinc-500">Team #{teamId}</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Logo team={team} size={size} />
      {showName && <span className="font-semibold text-zinc-100">{team.name}</span>}
      {showSymbol && <span className="text-xs text-zinc-500">{team.symbol}</span>}
    </span>
  );
}

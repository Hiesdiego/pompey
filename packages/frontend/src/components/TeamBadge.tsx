"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "../lib/cn";
import { useTeams, teamById, type TeamInfo } from "../hooks/useTeams";
import { CUP_TARGET_ORACLE_OFFSET, targetCoinById } from "../lib/targetCoins";

const CMC_LOGO = (cmcId: number) =>
  `https://s2.coinmarketcap.com/static/img/coins/64x64/${cmcId}.png`;

function Logo({ team, size }: { team: TeamInfo; size: number }) {
  const [stage, setStage] = useState(0);
  const sources = [
    team.imageUrl,
    typeof team.cmcId === "number" && team.cmcId > 0 ? CMC_LOGO(team.cmcId) : null,
    team.symbol ? `https://assets.coincap.io/assets/icons/${team.symbol.toLowerCase()}@2x.png` : null,
  ].filter((s): s is string => !!s);

  if (stage < sources.length) {
    return (
      <Image
        key={sources[stage]}
        src={sources[stage]}
        alt={team.symbol}
        width={size}
        height={size}
        unoptimized
        onError={() => setStage((s) => s + 1)}
        className="rounded-full bg-white ring-1 ring-black/10 dark:ring-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex items-center justify-center rounded-full bg-gradient-to-br from-[#2E7CF6] to-[#1D4ED8] font-display font-bold text-white shadow-[0_0_12px_rgba(46,124,246,.35)]"
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
  const { teams, targetTeams } = useTeams();
  const target = targetCoinById(teamId);
  const directoryTeam = teamById(teamId >= CUP_TARGET_ORACLE_OFFSET ? targetTeams : teams, teamId);
  const team = target
    ? { ...directoryTeam, ...target, cmcId: directoryTeam?.cmcId ?? 0, imageUrl: directoryTeam?.imageUrl ?? null }
    : directoryTeam;
  if (!team) return <span className="text-sm text-zinc-500">Team #{teamId}</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Logo key={`${team.teamId}:${team.imageUrl ?? ""}:${team.cmcId}`} team={team} size={size} />
      {showName && (
        <span className="font-semibold text-zinc-800 dark:text-zinc-100">{team.name}</span>
      )}
      {showSymbol && <span className="text-xs text-zinc-500">{team.symbol}</span>}
    </span>
  );
}

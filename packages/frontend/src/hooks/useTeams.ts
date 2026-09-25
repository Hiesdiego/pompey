/**
 * Team roster with CoinGecko logos.
 * Primary source: backend GET /api/teams (logos). Falls back to the
 * shared 20-team roster (no logos) if the backend is unreachable.
 */

"use client";

import { useEffect, useState } from "react";
import { TICKR_TEAMS } from "@tickr/shared/teams";
import { api, type ApiTeam } from "../lib/api";

export interface TeamInfo {
  teamId: number;
  name: string;
  symbol: string;
  imageUrl: string | null;
}

let cache: TeamInfo[] | null = null;

export function useTeams(): { teams: TeamInfo[]; loading: boolean } {
  const [teams, setTeams] = useState<TeamInfo[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (cache) return;
    let alive = true;
    api
      .teams()
      .then((list: ApiTeam[]) => {
        if (!alive) return;
        cache = list.map((t) => ({
          teamId: t.teamId,
          name: t.name,
          symbol: t.symbol,
          imageUrl: t.imageUrl,
        }));
        setTeams(cache);
      })
      .catch(() => {
        if (!alive) return;
        // Backend down — fall back to the static roster without logos.
        cache = TICKR_TEAMS.map((t) => ({
          teamId: t.teamId,
          name: t.name,
          symbol: t.symbol,
          imageUrl: null,
        }));
        setTeams(cache);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { teams, loading };
}

export function teamById(teams: TeamInfo[], teamId: number): TeamInfo | undefined {
  return teams.find((t) => t.teamId === teamId);
}

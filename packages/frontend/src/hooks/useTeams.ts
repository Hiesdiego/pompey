"use client";

import { useEffect, useState } from "react";
import { TICKR_TEAMS } from "@tickr/shared/teams";
import { api, type ApiTeam } from "../lib/api";

export interface TeamInfo {
  teamId: number;
  name: string;
  symbol: string;
  cmcId: number;
  imageUrl: string | null;
}

let cache: TeamInfo[] | null = null;
let targetCache: TeamInfo[] | null = null;
let teamRequest: Promise<TeamInfo[]> | null = null;
let targetRequest: Promise<TeamInfo[]> | null = null;

function toTeamInfo(team: ApiTeam): TeamInfo {
  return {
    teamId: team.teamId,
    name: team.name,
    symbol: team.symbol,
    cmcId: team.cmcId,
    imageUrl: team.imageUrl,
  };
}

function loadTeams(): Promise<TeamInfo[]> {
  if (cache) return Promise.resolve(cache);
  if (!teamRequest) {
    teamRequest = api.teams()
      .then((list) => list.map(toTeamInfo))
      .catch(() => TICKR_TEAMS.map((team) => ({ ...team, imageUrl: null })))
      .then((list) => {
        cache = list;
        return list;
      })
      .finally(() => { teamRequest = null; });
  }
  return teamRequest;
}

function loadTargetTeams(): Promise<TeamInfo[]> {
  if (targetCache) return Promise.resolve(targetCache);
  if (!targetRequest) {
    targetRequest = api.targetTeams()
      .then((list) => list.map(toTeamInfo))
      .then((list) => {
        targetCache = list;
        return list;
      })
      .catch(() => [])
      .finally(() => { targetRequest = null; });
  }
  return targetRequest;
}

export function useTeams(): { teams: TeamInfo[]; targetTeams: TeamInfo[]; loading: boolean } {
  const [teams, setTeams] = useState<TeamInfo[]>(cache ?? []);
  const [targetTeams, setTargetTeams] = useState<TeamInfo[]>(targetCache ?? []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let alive = true;
    void loadTeams().then((list) => {
      if (alive) setTeams(list);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    void loadTargetTeams().then((list) => {
      if (alive) setTargetTeams(list);
    });
    return () => { alive = false; };
  }, []);

  return { teams, targetTeams, loading };
}

export function teamById(teams: TeamInfo[], teamId: number): TeamInfo | undefined {
  return teams.find((team) => team.teamId === teamId);
}

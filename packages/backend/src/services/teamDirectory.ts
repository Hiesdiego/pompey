import { TICKR_TEAMS } from "@tickr/shared";
import { CUP_TEAM_PRICE_MAP, CUP_TEAM_SYMBOLS, CUP_TARGET_ORACLE_OFFSET } from "./cupTeams.js";

export interface DirectoryTeam {
  teamId: number;
  name: string;
  symbol: string;
  cmcId: number;
  imageUrl: string | null;
}

export function buildTargetTeamDirectory(metadata: ReadonlyMap<string, { name: string; imageUrl: string }>): DirectoryTeam[] {
  const leagueSymbols = new Set(TICKR_TEAMS.map((team) => team.symbol));
  return CUP_TEAM_PRICE_MAP.flatMap((team) => {
    const cupSymbol = CUP_TEAM_SYMBOLS[team.teamId];
    const symbol = cupSymbol === "TRON" ? "TRX" : cupSymbol === "PENGUIN" ? "PENGU" : cupSymbol;
    if (leagueSymbols.has(symbol)) return [];
    const coin = metadata.get(team.coingeckoId);
    return [{
      teamId: CUP_TARGET_ORACLE_OFFSET + team.teamId,
      name: coin?.name ?? symbol,
      symbol,
      cmcId: 0,
      imageUrl: coin?.imageUrl || null,
    }];
  });
}

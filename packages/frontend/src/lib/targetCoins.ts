import { TICKR_TEAMS } from "@tickr/shared/teams";
import { CUP_TEAMS, cupTeamName } from "./cup";

export const CUP_TARGET_ORACLE_OFFSET = 1000;

export interface TargetCoin {
  teamId: number;
  symbol: string;
  name: string;
  cupTeamId?: number;
}

const leagueCoins: TargetCoin[] = TICKR_TEAMS.map(({ teamId, symbol, name }) => ({ teamId, symbol, name }));
export const LEAGUE_TARGET_COINS = leagueCoins;
const leagueSymbols = new Set(leagueCoins.map((coin) => coin.symbol));

export const TARGET_COINS: TargetCoin[] = [
  ...leagueCoins,
  ...CUP_TEAMS.map(({ teamId, symbol }) => ({
    teamId: CUP_TARGET_ORACLE_OFFSET + teamId,
    symbol: symbol === "TRON" ? "TRX" : symbol === "PENGUIN" ? "PENGU" : symbol,
    name: cupTeamName(teamId),
    cupTeamId: teamId,
  })).filter((coin) => !leagueSymbols.has(coin.symbol)),
];

export function targetCoinById(teamId: number): TargetCoin | undefined {
  return TARGET_COINS.find((coin) => coin.teamId === teamId);
}

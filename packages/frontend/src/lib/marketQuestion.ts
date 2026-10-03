/**
 * Human-readable market questions + pick labels for the social layer.
 *
 * Same wording and params decoding as the markets board
 * (packages/frontend/src/app/markets/page.tsx: describeCardMarket / outcomeLabel)
 * so profile prediction rows read exactly like market cards.
 */

import { decodeAbiParameters, parseAbiParameters } from "viem";
import { TEMPLATES, TEMPLATE_NAMES } from "./marketFactory";
import type { ApiFixture, ApiFixtureTeam } from "./api";

export interface TeamRef {
  teamId: number;
  symbol: string;
  name: string;
}

function teamSymbol(teams: TeamRef[], teamId: number | bigint): string {
  const id = Number(teamId);
  return teams.find((t) => t.teamId === id)?.symbol ?? `#${id}`;
}

interface SpreadInfo {
  fixtureId: string;
  spread: number;
  home: ApiFixtureTeam | null;
  away: ApiFixtureTeam | null;
}

function spreadInfo(
  paramsHex: string,
  fixtures: Map<string, ApiFixture>
): SpreadInfo | null {
  try {
    const [, fixtureId, spread] = decodeAbiParameters(
      parseAbiParameters("uint256, uint256, int16"),
      paramsHex as `0x${string}`
    );
    const f = fixtures.get(fixtureId.toString());
    return {
      fixtureId: fixtureId.toString(),
      spread: Number(spread),
      home: f?.home ?? null,
      away: f?.away ?? null,
    };
  } catch {
    return null;
  }
}

/** Plain-language question for a market, e.g. "Will BTC beat POL by more than 2 goals?" */
export function marketQuestion(
  templateId: number,
  paramsHex: string,
  teams: TeamRef[],
  fixtures: Map<string, ApiFixture> = new Map()
): string {
  try {
    if (templateId === TEMPLATES.TOP_GAINER) {
      const [, matchday] = decodeAbiParameters(
        parseAbiParameters("uint256, uint8"),
        paramsHex as `0x${string}`
      );
      return `Which coin gains the most on matchday ${Number(matchday) + 1}?`;
    }
    if (templateId === TEMPLATES.CHAMPION) return "Who will win the season championship?";
    if (templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(
        parseAbiParameters("uint16, uint16, uint64, uint64"),
        paramsHex as `0x${string}`
      );
      return `Will ${teamSymbol(teams, a)} outperform ${teamSymbol(teams, b)}?`;
    }
    if (templateId === TEMPLATES.TARGET) {
      const [team, price, , above] = decodeAbiParameters(
        parseAbiParameters("uint16, uint256, uint64, bool"),
        paramsHex as `0x${string}`
      );
      return `Will ${teamSymbol(teams, team)} finish ${above ? "above" : "below"} $${(
        Number(price) / 1e8
      ).toLocaleString()}?`;
    }
    // SPREAD — name the teams in home/away order and state the number.
    const si = spreadInfo(paramsHex, fixtures);
    if (si?.home && si?.away) {
      const abs = Math.abs(si.spread);
      const goalWord = abs === 1 ? "goal" : "goals";
      if (si.spread >= 0) {
        return `Will ${si.home.symbol} beat ${si.away.symbol} by more than ${abs} ${goalWord}?`;
      }
      return `Will ${si.home.symbol} avoid losing to ${si.away.symbol} by ${abs}+ ${goalWord}?`;
    }
    return "Will the home team cover the fixture spread?";
  } catch {
    return TEMPLATE_NAMES[templateId] ?? "Prediction market";
  }
}

/**
 * Short label for the outcome a user picked, e.g. "BTC", "YES", "BTC wins".
 * For TOP_GAINER/CHAMPION the outcome index IS the teamId.
 */
export function pickLabel(
  templateId: number,
  outcome: number,
  paramsHex: string,
  teams: TeamRef[],
  fixtures: Map<string, ApiFixture> = new Map()
): string {
  try {
    if (templateId === TEMPLATES.TOP_GAINER || templateId === TEMPLATES.CHAMPION) {
      return teamSymbol(teams, outcome);
    }
    if (templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(
        parseAbiParameters("uint16, uint16, uint64, uint64"),
        paramsHex as `0x${string}`
      );
      return `${teamSymbol(teams, outcome === 0 ? a : b)} wins`;
    }
    // TARGET and SPREAD are YES/NO markets ("Yes" = the favoured side hits).
    if (templateId === TEMPLATES.TARGET || templateId === TEMPLATES.SPREAD) {
      return outcome === 0 ? "YES" : "NO";
    }
  } catch {
    /* fall through */
  }
  return `Outcome ${outcome + 1}`;
}

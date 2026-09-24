// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Outcome of a match from the home team's perspective.
enum Outcome {
    WinHome,
    Draw,
    WinAway
}

struct Fixture {
    uint16 homeTeamId;
    uint16 awayTeamId;
    uint8 matchdayIndex; // 0..37
    uint64 windowStart; // matchday window opens — kickoff can be revealed from here
    uint64 windowEnd; // matchday window closes — reveal must land well before this
    uint64 kickoffTimestamp; // 0 until backend-revealed
    bool kickoffRevealed;
    bool settled;
}

/// @notice A season's TeamRegistry + MatchRegistry pair. TICK, PlayerStats,
/// PredictionPool, PriceOracle, and ResultEngine are all persistent across
/// seasons; TeamRegistry and MatchRegistry are redeployed fresh each season
/// (rosters can change) and registered here so the persistent contracts
/// know which pair to talk to for a given seasonId.
interface ISeasonRegistry {
    function currentSeasonId() external view returns (uint256);
    function getMatchRegistry(uint256 seasonId) external view returns (address);
    function getTeamRegistry(uint256 seasonId) external view returns (address);
}

interface IMatchRegistry {
    function getFixture(uint256 fixtureId) external view returns (Fixture memory);
    function fixtureCount() external view returns (uint256);
    function isBettingOpen(uint256 fixtureId) external view returns (bool);
    function markSettled(uint256 fixtureId) external;
}

interface IPredictionPool {
    function settleFixture(uint256 seasonId, uint256 fixtureId, Outcome outcome) external;
}

interface IPlayerStats {
    function recordOutcome(
        address player,
        uint256 seasonId,
        uint256 fixtureId,
        bool won,
        bool isDraw,
        uint256 amountStaked,
        uint256 amountWon
    ) external;
}

interface IResultEngine {
    function recordResult(
        uint256 seasonId,
        uint256 fixtureId,
        Outcome outcome,
        int16 homeRoundedPct,
        int16 awayRoundedPct
    ) external;
}

/// @notice Persistent contracts (PredictionPool, PriceOracle, ResultEngine)
/// need a single storage key per (season, fixture) pair, since fixtureId
/// alone resets to 0 every time a new season's MatchRegistry is deployed.
/// 1,000,000 fixtures per season is comfortably above any realistic roster
/// size, so this composite key can never collide across seasons.
library SeasonMath {
    uint256 internal constant FIXTURE_ID_SPACE = 1_000_000;

    function globalFixtureId(uint256 seasonId, uint256 fixtureId) internal pure returns (uint256) {
        return (seasonId * FIXTURE_ID_SPACE) + fixtureId;
    }
}

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
    uint64 matchEndTimestamp; // pinned at reveal = kickoffTimestamp + matchDurationSeconds
    /// @notice True when the fixture was voided via the owner escape hatch
    /// (MatchRegistry.voidFixture) — the match can never be played, no
    /// result was recorded, and pool stakes are refundable 1:1 via
    /// PredictionPool.claimVoid. A voided fixture counts as settled for
    /// season-completion purposes but awards no league points.
    bool voided;
}

/// @notice A season's TeamRegistry + MatchRegistry pair. TICK, PlayerStats,
/// PredictionPool, and PriceOracle are all persistent across seasons;
/// TeamRegistry and MatchRegistry are redeployed fresh each season
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
    /// @notice Owner-only escape hatch: permanently voids a fixture whose
    /// matchday window has fully elapsed without the fixture settling
    /// (backend outage through the whole window, revealed match with no
    /// end price, ...). No legal reveal or settlement is possible anymore,
    /// so the fixture is marked settled-void: no league points, pool stakes
    /// refundable via claimVoid, protocol seed returned to the treasury.
    function voidFixture(uint256 fixtureId) external;
    function scheduleGenerated() external view returns (bool);
    function matchdaysGenerated() external view returns (uint8);
    function seasonStartTimestamp() external view returns (uint64);
    function matchdayIntervalSeconds() external view returns (uint64);
}

interface ITeamRegistry {
    function teamCount() external view returns (uint16);
}

interface IPredictionPool {
    function settleFixture(uint256 seasonId, uint256 fixtureId, Outcome outcome) external;
    /// @notice Escape-hatch settlement for a voided fixture (see
    /// IMatchRegistry.voidFixture). Marks the pool settled-void and returns
    /// the protocol seed to the treasury; stakers reclaim 1:1 via claimVoid.
    function voidFixture(uint256 seasonId, uint256 fixtureId) external;
    /// @notice Refunds a staker's full stake (1:1, no fee, no PlayerStats
    /// entry — the match never happened) from a voided fixture's pool.
    function claimVoid(uint256 seasonId, uint256 fixtureId) external;
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
    /// @notice Records a voided fixture: counts it toward season completion
    /// WITHOUT applying any result to the league table. Callable only by
    /// the season's registered MatchRegistry as part of the owner void flow.
    function recordVoid(uint256 seasonId, uint256 fixtureId) external;
    /// @notice (points, goalDifferenceSum) for a team — tiebreak order for
    /// outright markets is points first, then goalDifferenceSum.
    function getTeamScore(uint256 seasonId, uint16 teamId)
        external
        view
        returns (uint32 points, int32 goalDifferenceSum);
    /// @notice True once every fixture of the season has settled.
    function isSeasonComplete(uint256 seasonId) external view returns (bool);
}

/// @notice Read surface of PriceOracle used by the MarketFactory for
/// trustless outright-market resolution.
interface IPriceOracle {
    /// @notice Price of `teamId` at time `timestamp`: the latest hourly
    /// checkpoint at or before `timestamp`. `found` is false when no
    /// checkpoint exists within the lookback window.
    function getPriceAt(uint16 teamId, uint64 timestamp)
        external
        view
        returns (bool found, uint256 price);
    /// @notice Raw start/end prices of a fixture plus whether the end price
    /// was submitted (i.e. the fixture's result is knowable on-chain).
    function getFixtureEndPrices(uint256 seasonId, uint256 fixtureId)
        external
        view
        returns (
            bool endSubmitted,
            uint256 homeStart,
            uint256 awayStart,
            uint256 homeEnd,
            uint256 awayEnd
        );
    function PRICE_DECIMALS() external view returns (uint8);
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

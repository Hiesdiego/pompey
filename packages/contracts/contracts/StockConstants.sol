// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title StockConstants - shared constants for the TICKR Stock League
///
/// @notice Single source of truth for every number the stock stack shares.
/// Solidity does not allow accessing a contract's constants via
/// `ContractName.CONSTANT` (verified against solc 0.8.28), only types
/// (structs, enums) work that way. Library constants ARE accessible via
/// `LibraryName.CONSTANT`, so shared numbers live here, following the
/// tournament/CupConstants.sol pattern in the crypto repo.
///
/// @dev STOCK DIFFERENCES FROM CRYPTO (locked, do not change):
///   - 22 teams, single round-robin, 21 matchdays, 231 fixtures.
///   - 1 goal = 0.05% (5 bps), not 0.5% (50 bps). Stocks move far less
///     than crypto in a 1-hour window, so the crypto threshold would draw
///     almost every match.
///   - Max 10 goals per team per match, and a raw 3% volatile cap.
///   - 1-hour matches, matchday lasts 1 day (86400s interval).
///   - Season: Nov 26 to Dec 16 2026. Matchday 0 opens Nov 26 00:00 UTC.
///
/// @dev DEPENDENCY NOTE: this stack is UUPS upgradeable and needs
/// the OpenZeppelin contracts-upgradeable package, which is NOT yet in
/// packages/contracts/package.json (only the plain contracts package is).
/// Do NOT install it yourself. The user runs, in the repo root:
/// (package name is the contracts workspace, @tickr/contracts):
//    pnpm --filter @tickr/contracts add @openzeppelin/contracts-upgradeable@5.4.0
/// (5.4.0 verified: ReentrancyGuardUpgradeable lives at
/// utils/ReentrancyGuardUpgradeable.sol there; in 5.6.x that file moved
/// and the path used by StockPredictionPool breaks.)
/// and then copies these files into packages/contracts/contracts/stock/
/// (or an equivalent folder) before running `pnpm build`.
library StockConstants {
    // --- League shape (locked) ---
    uint16 constant TEAM_COUNT = 22;
    uint8 constant MATCHDAY_COUNT = 21;
    uint16 constant FIXTURE_COUNT = 231;
    uint16 constant FIXTURES_PER_MATCHDAY = 11;

    // --- Season (locked) ---
    /// @notice Stock league season id in this stack's own namespace.
    /// The stock stack is parallel to crypto, NOT Season 3 of the crypto
    /// league, so its season id must never be mixed with crypto season ids.
    uint256 constant SEASON_ID = 1;
    /// @notice Nov 26 2026 00:00:00 UTC. Matchday 20 opens Dec 16 2026.
    uint64 constant SEASON_START_TIMESTAMP = 1795651200;
    /// @notice One matchday per day.
    uint64 constant MATCHDAY_INTERVAL_SECONDS = 86400;
    /// @notice 1-hour matches, same as the crypto league.
    uint64 constant MATCH_DURATION_SECONDS = 3600;

    // --- Scoring (locked) ---
    /// @notice 1 goal = 0.05% price move (5 basis points), half-up rounding.
    uint256 constant BPS_PER_GOAL = 5;
    /// @notice No team can score more than 10 goals in one match, however
    /// large the raw move. This is the scoring cap.
    int16 constant MAX_GOALS_PER_TEAM = 10;
    /// @notice Raw move above 3% (300 bps) in the 1-hour window is treated
    /// as volatile: goals are still capped at 10, and the circuit breaker
    /// flag trips (see StockPriceOracle) so the move is flagged for review
    /// instead of silently swamping goal difference.
    int256 constant VOLATILE_CAP_BPS = 300;

    // --- Points and tiebreak (identical to crypto) ---
    uint16 constant POINTS_WIN = 3;
    uint16 constant POINTS_DRAW = 1;
    uint16 constant POINTS_LOSS = 0;
    /// @notice Forfeit scoreline, recorded explicitly with a forfeit flag,
    /// never silently as a normal 3-0.
    int16 constant FORFEIT_GOALS_WINNER = 3;
    int16 constant FORFEIT_GOALS_LOSER = 0;

    // --- Pool economics (identical to crypto) ---
    uint256 constant PLATFORM_FEE_BPS = 700; // 7%
    uint256 constant MAX_FEE_BPS = 1000; // 10% hard ceiling
    uint256 constant MIN_STAKE = 10 * 10 ** 18; // 10 TICK minimum
    uint256 constant FIXTURE_SEED = 250 * 10 ** 18; // 250 TICK per fixture

    // --- Price feed ---
    /// @notice Coinbase B20 tokenized stocks use 8 decimals.
    uint8 constant PRICE_DECIMALS = 8;
    uint64 constant CHECKPOINT_INTERVAL = 1 hours;
    uint64 constant CHECKPOINT_RETENTION_HOURS = 720; // 30 days
    uint64 constant CHECKPOINT_MAX_LOOKBACK = 48; // ~2 days of outage

    // --- Kickoff reveal (identical to crypto) ---
    uint256 constant KICKOFF_LEAD_MIN_SECONDS = 30 minutes;
    uint256 constant KICKOFF_LEAD_MAX_SECONDS = 120 minutes;
    uint256 constant INPLAY_CLOSE_BUFFER_SECONDS = 5 minutes;

    // --- Reused token (never redeployed) ---
    /// @notice TICK on Base Sepolia, reused by the stock stack exactly as
    /// the crypto league and the cup reuse it.
    address constant TICK_TOKEN = 0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b;
}

/// @notice Outcome of a match from the home team's perspective.
/// Duplicated from the crypto ITickr.Outcome on purpose: the stock stack
/// must not import crypto league interfaces, it is a parallel stack.
enum StockOutcome {
    WinHome,
    Draw,
    WinAway
}

/// @notice Stock fixture outcome state. A fixture is either unsettled,
/// settled normally (or by forfeit), or voided (both teams no performance).
enum StockFixtureStatus {
    Unsettled,
    Settled,
    Voided
}

/// @notice Same composite-key scheme as crypto SeasonMath: 1,000,000
/// fixtures per season, so a (seasonId, fixtureId) pair can never collide.
library StockSeasonMath {
    uint256 internal constant FIXTURE_ID_SPACE = 1_000_000;

    function globalFixtureId(uint256 seasonId, uint256 fixtureId) internal pure returns (uint256) {
        return (seasonId * FIXTURE_ID_SPACE) + fixtureId;
    }
}

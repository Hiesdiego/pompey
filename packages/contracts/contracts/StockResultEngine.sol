// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { StockConstants, StockOutcome, StockSeasonMath } from "./StockConstants.sol";
import { StockFixture } from "./StockMatchRegistry.sol";

/// @notice Minimal interface of StockMatchRegistry used by this contract.
interface IStockMatchRegistryForEngine {
    function getFixture(uint256 fixtureId) external view returns (StockFixture memory);
    function fixtureCount() external view returns (uint256);
    function markSettled(uint256 fixtureId) external;
    function markVoided(uint256 fixtureId) external;
}

/// @notice Minimal interface of StockPredictionPool used by this contract.
interface IStockPredictionPoolForEngine {
    function settleFixture(uint256 seasonId, uint256 fixtureId, StockOutcome outcome) external;
    function voidFixture(uint256 seasonId, uint256 fixtureId) external;
}

/// @title StockResultEngine - TICKR Stock League table
///
/// @notice Sits between StockPriceOracle (which computes the raw result)
/// and StockMatchRegistry / StockPredictionPool (which need to know about
/// it). Owns the league table: played/won/drawn/lost/points plus goals
/// for, goals against and goal difference per team, using standard
/// football scoring (3/1/0).
///
/// Call graph:
///   StockPriceOracle.submitEndPrice()
///     -> StockResultEngine.recordResult()
///     -> updates league table, StockMatchRegistry.markSettled(),
///        StockPredictionPool.settleFixture().
/// Forfeit graph (backend, when one team has no performance):
///   StockResultEngine.recordForfeit()
///     -> 3-0 to the opponent, forfeit flag set, same downstream calls.
/// Void graph (backend, when BOTH teams have no performance for the
/// match period):
///   StockResultEngine.recordVoid()
///     -> no table change, StockMatchRegistry.markVoided(),
///        StockPredictionPool.voidFixture() (stakes refunded 1:1).
///
/// @dev STOCK DIFFERENCES FROM CRYPTO ResultEngine:
///   - The table stores goalsFor and goalsAgainst per team, not just a
///     goal-difference sum. The locked tiebreak is points, then GD, then
///     GF, then wins, then fewest losses, and the backend sorts by that
///     order off-chain using getTeamRecord(); GD alone cannot express it.
///   - recordForfeit(): 3-0 win, 3 points, GD +3/-3, with an explicit
///     on-chain forfeit flag (resultForfeit) and a ForfeitRecorded event.
///     A forfeit is NEVER recorded as a silent normal 3-0.
///   - recordVoid(): both teams missing performance voids the fixture.
///     No points, no played count, stakes refunded 1:1 by the pool.
///   - No SeasonRegistry indirection: this stack has exactly one season
///     (StockConstants.SEASON_ID = 1) and one MatchRegistry, wired once
///     via setMatchRegistry(). The crypto SeasonRegistry is untouched.
///   - UUPS upgradeable, owner-only upgrades. initialize() replaces the
///     constructor; setPredictionPool / setPriceOracle / setMatchRegistry
///     are one-time setters, as in crypto.
///   - isSeasonComplete counts settled PLUS voided fixtures against the
///     132-fixture total, since a voided fixture is final too.
contract StockResultEngine is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    IStockMatchRegistryForEngine public matchRegistry;
    bool public matchRegistrySet;

    IStockPredictionPoolForEngine public predictionPool;
    bool public predictionPoolSet;

    address public priceOracle;
    bool public priceOracleSet;

    struct TeamRecord {
        uint16 played;
        uint16 won;
        uint16 drawn;
        uint16 lost;
        uint32 points;
        uint32 goalsFor;
        uint32 goalsAgainst;
        int32 goalDifference; // goalsFor - goalsAgainst, kept for cheap reads
    }

    // seasonId => teamId => record (seasonId is always SEASON_ID = 1 here)
    mapping(uint256 => mapping(uint16 => TeamRecord)) public table;
    mapping(uint256 => bool) public resultRecorded; // globalFixtureId => recorded?
    /// @notice True when the fixture's recorded result was a forfeit.
    /// Frontend must render these as "FORFEIT 3-0", not as a normal 3-0.
    mapping(uint256 => bool) public resultForfeit;
    /// @notice True when the fixture was voided (both teams no performance).
    mapping(uint256 => bool) public resultVoided;
    /// @notice seasonId => number of fixtures finalized (settled or voided).
    mapping(uint256 => uint256) public seasonSettledCount;

    /// @notice Reserved storage for future upgrades. Never remove or reorder.
    uint256[48] private __gap;

    event ResultRecorded(
        uint256 indexed seasonId,
        uint256 indexed fixtureId,
        uint16 homeTeamId,
        uint16 awayTeamId,
        StockOutcome outcome,
        int16 homeGoals,
        int16 awayGoals
    );
    event ForfeitRecorded(
        uint256 indexed seasonId,
        uint256 indexed fixtureId,
        uint16 homeTeamId,
        uint16 awayTeamId,
        uint16 forfeitingTeamId,
        StockOutcome outcome
    );
    event FixtureVoided(uint256 indexed seasonId, uint256 indexed fixtureId, uint16 homeTeamId, uint16 awayTeamId);

    error OnlyPriceOracle();
    error OnlyBackend();
    error PredictionPoolAlreadySet();
    error PriceOracleAlreadySet();
    error MatchRegistryAlreadySet();
    error ResultAlreadyRecorded(uint256 seasonId, uint256 fixtureId);
    error InvalidSeasonId(uint256 seasonId);
    error InvalidForfeitTeam(uint16 teamId);

    address public backendSigner;

    modifier onlyPriceOracle() {
        if (msg.sender != priceOracle) revert OnlyPriceOracle();
        _;
    }

    modifier onlyBackend() {
        if (msg.sender != backendSigner) revert OnlyBackend();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer, called through the proxy by the deploy
    /// script. backendSigner is the hot signer allowed to record forfeits
    /// and voids; it should be the same signer the oracle uses.
    function initialize(address initialOwner, address _backendSigner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        backendSigner = _backendSigner;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function setMatchRegistry(address _matchRegistry) external onlyOwner {
        if (matchRegistrySet) revert MatchRegistryAlreadySet();
        matchRegistry = IStockMatchRegistryForEngine(_matchRegistry);
        matchRegistrySet = true;
    }

    function setPredictionPool(address _predictionPool) external onlyOwner {
        if (predictionPoolSet) revert PredictionPoolAlreadySet();
        predictionPool = IStockPredictionPoolForEngine(_predictionPool);
        predictionPoolSet = true;
    }

    function setPriceOracle(address _priceOracle) external onlyOwner {
        if (priceOracleSet) revert PriceOracleAlreadySet();
        priceOracle = _priceOracle;
        priceOracleSet = true;
    }

    function setBackendSigner(address newSigner) external onlyOwner {
        backendSigner = newSigner;
    }

    /// @notice Normal result path, called only by StockPriceOracle.
    function recordResult(
        uint256 seasonId,
        uint256 fixtureId,
        StockOutcome outcome,
        int16 homeGoals,
        int16 awayGoals
    ) external onlyPriceOracle {
        if (seasonId != StockConstants.SEASON_ID) revert InvalidSeasonId(seasonId);
        uint256 gid = StockSeasonMath.globalFixtureId(seasonId, fixtureId);
        if (resultRecorded[gid]) revert ResultAlreadyRecorded(seasonId, fixtureId);
        resultRecorded[gid] = true;
        seasonSettledCount[seasonId] += 1;

        StockFixture memory f = matchRegistry.getFixture(fixtureId);

        _applyResult(seasonId, f.homeTeamId, f.awayTeamId, outcome, homeGoals, awayGoals);

        matchRegistry.markSettled(fixtureId);
        predictionPool.settleFixture(seasonId, fixtureId, outcome);

        emit ResultRecorded(seasonId, fixtureId, f.homeTeamId, f.awayTeamId, outcome, homeGoals, awayGoals);
    }

    /// @notice Forfeit path, called by the BACKEND (not the oracle) when
    /// exactly one team has no performance for the match period: no fresh
    /// NAV price and no fallback for that team. The opponent wins 3-0,
    /// takes 3 points and GD +3/-3, and the fixture is flagged as a
    /// forfeit on-chain (resultForfeit) so it is never presented as a
    /// normal 3-0. The pool settles on the winner's outcome, exactly like
    /// a normal result. `forfeitingTeamId` must be one of the two teams
    /// in the fixture.
    function recordForfeit(uint256 seasonId, uint256 fixtureId, uint16 forfeitingTeamId)
        external
        onlyBackend
    {
        if (seasonId != StockConstants.SEASON_ID) revert InvalidSeasonId(seasonId);
        uint256 gid = StockSeasonMath.globalFixtureId(seasonId, fixtureId);
        if (resultRecorded[gid]) revert ResultAlreadyRecorded(seasonId, fixtureId);

        StockFixture memory f = matchRegistry.getFixture(fixtureId);
        if (forfeitingTeamId != f.homeTeamId && forfeitingTeamId != f.awayTeamId) {
            revert InvalidForfeitTeam(forfeitingTeamId);
        }

        resultRecorded[gid] = true;
        resultForfeit[gid] = true;
        seasonSettledCount[seasonId] += 1;

        StockOutcome outcome;
        int16 homeGoals;
        int16 awayGoals;
        if (forfeitingTeamId == f.homeTeamId) {
            outcome = StockOutcome.WinAway;
            homeGoals = StockConstants.FORFEIT_GOALS_LOSER;
            awayGoals = StockConstants.FORFEIT_GOALS_WINNER;
        } else {
            outcome = StockOutcome.WinHome;
            homeGoals = StockConstants.FORFEIT_GOALS_WINNER;
            awayGoals = StockConstants.FORFEIT_GOALS_LOSER;
        }

        _applyResult(seasonId, f.homeTeamId, f.awayTeamId, outcome, homeGoals, awayGoals);

        matchRegistry.markSettled(fixtureId);
        predictionPool.settleFixture(seasonId, fixtureId, outcome);

        emit ForfeitRecorded(seasonId, fixtureId, f.homeTeamId, f.awayTeamId, forfeitingTeamId, outcome);
        emit ResultRecorded(seasonId, fixtureId, f.homeTeamId, f.awayTeamId, outcome, homeGoals, awayGoals);
    }

    /// @notice Void path, called by the BACKEND when NEITHER team has any
    /// performance for the match period (no fresh NAV price and no fallback
    /// for either side). No table change at all: no played count, no
    /// points, no goals. The fixture is marked voided in the MatchRegistry
    /// and the pool refunds every stake 1:1 via voidFixture().
    function recordVoid(uint256 seasonId, uint256 fixtureId) external onlyBackend {
        if (seasonId != StockConstants.SEASON_ID) revert InvalidSeasonId(seasonId);
        uint256 gid = StockSeasonMath.globalFixtureId(seasonId, fixtureId);
        if (resultRecorded[gid]) revert ResultAlreadyRecorded(seasonId, fixtureId);

        StockFixture memory f = matchRegistry.getFixture(fixtureId);

        resultRecorded[gid] = true;
        resultVoided[gid] = true;
        seasonSettledCount[seasonId] += 1;

        matchRegistry.markVoided(fixtureId);
        predictionPool.voidFixture(seasonId, fixtureId);

        emit FixtureVoided(seasonId, fixtureId, f.homeTeamId, f.awayTeamId);
    }

    /// @notice True once every fixture of the season is finalized, settled
    /// or voided, i.e. the league table is final. Returns false (rather
    /// than reverting) for unknown seasons.
    function isSeasonComplete(uint256 seasonId) external view returns (bool) {
        if (address(matchRegistry) == address(0)) return false;
        uint256 total = matchRegistry.fixtureCount();
        return total > 0 && seasonSettledCount[seasonId] >= total;
    }

    /// @notice (points, goalDifference, goalsFor) for a team. The full
    /// locked tiebreak is points, then GD, then GF, then wins, then
    /// fewest losses: read getTeamRecord() for wins/losses.
    function getTeamScore(uint256 seasonId, uint16 teamId)
        external
        view
        returns (uint32 points, int32 goalDifference, uint32 goalsFor)
    {
        TeamRecord storage r = table[seasonId][teamId];
        return (r.points, r.goalDifference, r.goalsFor);
    }

    function getTeamRecord(uint256 seasonId, uint16 teamId) external view returns (TeamRecord memory) {
        return table[seasonId][teamId];
    }

    function _applyResult(
        uint256 seasonId,
        uint16 homeTeamId,
        uint16 awayTeamId,
        StockOutcome outcome,
        int16 homeGoals,
        int16 awayGoals
    ) private {
        TeamRecord storage home = table[seasonId][homeTeamId];
        TeamRecord storage away = table[seasonId][awayTeamId];

        home.played += 1;
        away.played += 1;

        home.goalsFor += uint32(int32(homeGoals));
        home.goalsAgainst += uint32(int32(awayGoals));
        away.goalsFor += uint32(int32(awayGoals));
        away.goalsAgainst += uint32(int32(homeGoals));

        int32 diff = int32(homeGoals) - int32(awayGoals);
        home.goalDifference += diff;
        away.goalDifference -= diff;

        if (outcome == StockOutcome.WinHome) {
            home.won += 1;
            home.points += StockConstants.POINTS_WIN;
            away.lost += 1;
            away.points += StockConstants.POINTS_LOSS;
        } else if (outcome == StockOutcome.WinAway) {
            away.won += 1;
            away.points += StockConstants.POINTS_WIN;
            home.lost += 1;
            home.points += StockConstants.POINTS_LOSS;
        } else {
            home.drawn += 1;
            home.points += StockConstants.POINTS_DRAW;
            away.drawn += 1;
            away.points += StockConstants.POINTS_DRAW;
        }
    }
}

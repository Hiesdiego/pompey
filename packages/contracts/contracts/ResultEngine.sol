// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ISeasonRegistry, IMatchRegistry, IPredictionPool, Fixture, Outcome, SeasonMath } from "./interfaces/ITickr.sol";

/// @title ResultEngine — TICKR league table
///
/// @notice Persists across every season. Sits between PriceOracle (which
/// computes the raw result) and MatchRegistry / PredictionPool (which need
/// to know about it). Owns the league table: played/won/drawn/lost/points
/// per team, using standard football scoring (3/1/0).
///
/// IMPORTANT: the league table is keyed by (seasonId, teamId), not just
/// teamId. Since TeamRegistry is redeployed fresh each season, team IDs can
/// be reassigned between seasons (e.g. a roster change shifts who's ID 5) —
/// keeping cumulative stats under a bare teamId key would silently mix
/// different coins' records together across seasons. Standings reset every
/// season by construction, which also matches how real leagues work.
///
/// Call graph: PriceOracle.submitEndPrice() -> ResultEngine.recordResult()
/// -> updates league table, MatchRegistry.markSettled(), PredictionPool.settleFixture().
///
/// Void call graph (owner escape hatch): MatchRegistry.voidFixture() ->
/// ResultEngine.recordVoid() -> PredictionPool.voidFixture(). No league
/// table update — an unplayed match awards nothing — but the fixture still
/// counts toward season completion so outright markets stay resolvable.
contract ResultEngine is Ownable {
    uint16 public constant POINTS_WIN = 3;
    uint16 public constant POINTS_DRAW = 1;
    uint16 public constant POINTS_LOSS = 0;

    ISeasonRegistry public immutable seasonRegistry;
    IPredictionPool public predictionPool;
    bool public predictionPoolSet;

    address public priceOracle;
    bool public priceOracleSet;

    struct TeamRecord {
        uint16 played;
        uint16 won;
        uint16 drawn;
        uint16 lost;
        uint32 points;
        int32 goalDifferenceSum; // sum of rounded % score differentials, for tiebreaking
    }

    // seasonId => teamId => record
    mapping(uint256 => mapping(uint16 => TeamRecord)) public table;
    mapping(uint256 => bool) public resultRecorded; // globalFixtureId => recorded?
    /// @notice seasonId => number of fixtures settled so far. Powers
    /// isSeasonComplete, which outright markets (e.g. Season Champion) use
    /// to prove the table is final before resolving. Voided fixtures count
    /// here too — a void is a final outcome for completion purposes, it
    /// just awards no points.
    mapping(uint256 => uint256) public seasonSettledCount;

    event ResultRecorded(
        uint256 indexed seasonId,
        uint256 indexed fixtureId,
        uint16 homeTeamId,
        uint16 awayTeamId,
        Outcome outcome,
        int16 homeRoundedPct,
        int16 awayRoundedPct
    );
    event FixtureVoidRecorded(uint256 indexed seasonId, uint256 indexed fixtureId);

    error OnlyPriceOracle();
    error PredictionPoolAlreadySet();
    error PriceOracleAlreadySet();
    error ResultAlreadyRecorded(uint256 seasonId, uint256 fixtureId);
    error CallerNotMatchRegistry(uint256 seasonId, address caller);

    modifier onlyPriceOracle() {
        if (msg.sender != priceOracle) revert OnlyPriceOracle();
        _;
    }

    constructor(address initialOwner, address seasonRegistryAddress) Ownable(initialOwner) {
        seasonRegistry = ISeasonRegistry(seasonRegistryAddress);
    }

    function setPredictionPool(address _predictionPool) external onlyOwner {
        if (predictionPoolSet) revert PredictionPoolAlreadySet();
        predictionPool = IPredictionPool(_predictionPool);
        predictionPoolSet = true;
    }

    function setPriceOracle(address _priceOracle) external onlyOwner {
        if (priceOracleSet) revert PriceOracleAlreadySet();
        priceOracle = _priceOracle;
        priceOracleSet = true;
    }

    function recordResult(
        uint256 seasonId,
        uint256 fixtureId,
        Outcome outcome,
        int16 homeRoundedPct,
        int16 awayRoundedPct
    ) external onlyPriceOracle {
        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        if (resultRecorded[gid]) revert ResultAlreadyRecorded(seasonId, fixtureId);
        resultRecorded[gid] = true;
        seasonSettledCount[seasonId] += 1;

        address matchRegistryAddr = seasonRegistry.getMatchRegistry(seasonId);
        Fixture memory f = IMatchRegistry(matchRegistryAddr).getFixture(fixtureId);

        _applyResult(seasonId, f.homeTeamId, f.awayTeamId, outcome, homeRoundedPct, awayRoundedPct);

        IMatchRegistry(matchRegistryAddr).markSettled(fixtureId);
        predictionPool.settleFixture(seasonId, fixtureId, outcome);

        emit ResultRecorded(seasonId, fixtureId, f.homeTeamId, f.awayTeamId, outcome, homeRoundedPct, awayRoundedPct);
    }

    /// @notice Records a voided fixture as part of the owner-initiated void
    /// flow (MatchRegistry.voidFixture). The fixture counts toward
    /// seasonSettledCount so isSeasonComplete can still turn true, but —
    /// critically — nothing is applied to the league table: an unplayed
    /// match awards no points, no wins/losses/draws, no goal difference.
    /// Fans out to PredictionPool.voidFixture so stakers can reclaim
    /// refunds. Callable ONLY by the season's registered MatchRegistry;
    /// the double-record guard also blocks a later recordResult for the
    /// same fixture (e.g. a stale end-price submission).
    function recordVoid(uint256 seasonId, uint256 fixtureId) external {
        address matchRegistryAddr = seasonRegistry.getMatchRegistry(seasonId);
        if (msg.sender != matchRegistryAddr) revert CallerNotMatchRegistry(seasonId, msg.sender);

        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        if (resultRecorded[gid]) revert ResultAlreadyRecorded(seasonId, fixtureId);
        resultRecorded[gid] = true;
        seasonSettledCount[seasonId] += 1;

        predictionPool.voidFixture(seasonId, fixtureId);

        emit FixtureVoidRecorded(seasonId, fixtureId);
    }

    /// @notice True once every fixture of the season has settled — i.e. the
    /// league table is final and safe for outright resolution. Returns false
    /// (rather than reverting) for unknown seasons so callers can treat it
    /// as "not resolvable yet".
    function isSeasonComplete(uint256 seasonId) external view returns (bool) {
        address matchRegistryAddr = seasonRegistry.getMatchRegistry(seasonId);
        if (matchRegistryAddr == address(0)) return false;
        uint256 total = IMatchRegistry(matchRegistryAddr).fixtureCount();
        return total > 0 && seasonSettledCount[seasonId] >= total;
    }

    /// @notice (points, goalDifferenceSum) for a team. Outright markets
    /// break ties by points first, then goalDifferenceSum, then split.
    function getTeamScore(uint256 seasonId, uint16 teamId)
        external
        view
        returns (uint32 points, int32 goalDifferenceSum)
    {
        TeamRecord storage r = table[seasonId][teamId];
        return (r.points, r.goalDifferenceSum);
    }

    function _applyResult(
        uint256 seasonId,
        uint16 homeTeamId,
        uint16 awayTeamId,
        Outcome outcome,
        int16 homeRoundedPct,
        int16 awayRoundedPct
    ) private {
        TeamRecord storage home = table[seasonId][homeTeamId];
        TeamRecord storage away = table[seasonId][awayTeamId];

        home.played += 1;
        away.played += 1;

        int32 diff = int32(homeRoundedPct) - int32(awayRoundedPct);
        home.goalDifferenceSum += diff;
        away.goalDifferenceSum -= diff;

        if (outcome == Outcome.WinHome) {
            home.won += 1;
            home.points += POINTS_WIN;
            away.lost += 1;
            away.points += POINTS_LOSS;
        } else if (outcome == Outcome.WinAway) {
            away.won += 1;
            away.points += POINTS_WIN;
            home.lost += 1;
            home.points += POINTS_LOSS;
        } else {
            home.drawn += 1;
            home.points += POINTS_DRAW;
            away.drawn += 1;
            away.points += POINTS_DRAW;
        }
    }

    function getTeamRecord(uint256 seasonId, uint16 teamId) external view returns (TeamRecord memory) {
        return table[seasonId][teamId];
    }
}

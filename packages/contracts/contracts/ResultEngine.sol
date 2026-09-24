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

    event ResultRecorded(
        uint256 indexed seasonId,
        uint256 indexed fixtureId,
        uint16 homeTeamId,
        uint16 awayTeamId,
        Outcome outcome,
        int16 homeRoundedPct,
        int16 awayRoundedPct
    );

    error OnlyPriceOracle();
    error PredictionPoolAlreadySet();
    error PriceOracleAlreadySet();
    error ResultAlreadyRecorded(uint256 seasonId, uint256 fixtureId);

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

        address matchRegistryAddr = seasonRegistry.getMatchRegistry(seasonId);
        Fixture memory f = IMatchRegistry(matchRegistryAddr).getFixture(fixtureId);

        _applyResult(seasonId, f.homeTeamId, f.awayTeamId, outcome, homeRoundedPct, awayRoundedPct);

        IMatchRegistry(matchRegistryAddr).markSettled(fixtureId);
        predictionPool.settleFixture(seasonId, fixtureId, outcome);

        emit ResultRecorded(seasonId, fixtureId, f.homeTeamId, f.awayTeamId, outcome, homeRoundedPct, awayRoundedPct);
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

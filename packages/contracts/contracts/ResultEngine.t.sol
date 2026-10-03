// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ResultEngine } from "./ResultEngine.sol";
import { Outcome } from "./interfaces/ITickr.sol";

/// @dev Minimal mock SeasonRegistry: resolves every seasonId to one fixed
/// MatchRegistry address.
contract MockSeasonRegistry {
    address public registry;

    constructor(address _registry) {
        registry = _registry;
    }

    function getMatchRegistry(uint256) external view returns (address) {
        return registry;
    }
}

/// @dev Minimal mock PredictionPool: records voidFixture calls and stubs
/// the rest of IPredictionPool so it stays concrete.
contract MockPredictionPool {
    uint256 public lastVoidSeasonId;
    uint256 public lastVoidFixtureId;
    uint256 public voidCallCount;

    function settleFixture(uint256, uint256, Outcome) external pure {}

    function voidFixture(uint256 seasonId, uint256 fixtureId) external {
        lastVoidSeasonId = seasonId;
        lastVoidFixtureId = fixtureId;
        voidCallCount += 1;
    }

    function claimVoid(uint256, uint256) external pure {}
}

/// @notice Unit tests for ResultEngine.recordVoid — the middle link of the
/// void escape-hatch chain (MatchRegistry.voidFixture -> recordVoid ->
/// PredictionPool.voidFixture). A void must count toward season completion
/// WITHOUT touching the league table: an unplayed match awards no points.
contract ResultEngineVoidTest is Test {
    ResultEngine engine;
    MockSeasonRegistry seasonRegistry;
    MockPredictionPool mockPool;

    address owner = address(0xA11CE);
    address matchRegistry = address(0x8E6157);

    uint256 constant SEASON_ID = 2;
    uint256 constant FIXTURE_ID = 5;
    // globalFixtureId(2, 5) = 2 * 1_000_000 + 5
    uint256 constant GID = 2_000_005;

    function setUp() public {
        seasonRegistry = new MockSeasonRegistry(matchRegistry);
        mockPool = new MockPredictionPool();

        vm.startPrank(owner);
        engine = new ResultEngine(owner, address(seasonRegistry));
        engine.setPredictionPool(address(mockPool));
        vm.stopPrank();
    }

    function test_RecordVoidCountsTowardCompletionWithoutTouchingTable() public {
        vm.prank(matchRegistry);
        engine.recordVoid(SEASON_ID, FIXTURE_ID);

        require(engine.seasonSettledCount(SEASON_ID) == 1, "void should count toward season completion");
        require(engine.resultRecorded(GID), "void should mark the result recorded");

        // League table untouched — no points, no played, no goal difference.
        (uint32 points, int32 gd) = engine.getTeamScore(SEASON_ID, 0);
        require(points == 0 && gd == 0, "void must not award league points");
        (points, gd) = engine.getTeamScore(SEASON_ID, 1);
        require(points == 0 && gd == 0, "void must not award league points");

        // Fanned out to the pool.
        require(mockPool.voidCallCount() == 1, "pool.voidFixture should be called once");
        require(mockPool.lastVoidSeasonId() == SEASON_ID, "pool should get the season id");
        require(mockPool.lastVoidFixtureId() == FIXTURE_ID, "pool should get the fixture id");
    }

    function test_RecordVoidRejectsNonRegistryCaller() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        engine.recordVoid(SEASON_ID, FIXTURE_ID);
    }

    function test_RecordVoidRejectsDoubleRecord() public {
        vm.startPrank(matchRegistry);
        engine.recordVoid(SEASON_ID, FIXTURE_ID);

        vm.expectRevert();
        engine.recordVoid(SEASON_ID, FIXTURE_ID);
        vm.stopPrank();
    }

    function test_RecordVoidRejectsUnknownSeason() public {
        // Season 99 has no registered registry (mock returns matchRegistry
        // for every id, so use a registry address of zero instead).
        MockSeasonRegistry emptyRegistry = new MockSeasonRegistry(address(0));
        vm.prank(owner);
        ResultEngine engine2 = new ResultEngine(owner, address(emptyRegistry));

        vm.prank(matchRegistry);
        vm.expectRevert();
        engine2.recordVoid(99, FIXTURE_ID);
    }
}

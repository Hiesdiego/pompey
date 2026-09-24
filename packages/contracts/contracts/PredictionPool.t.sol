// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { TickToken } from "./TickToken.sol";
import { PredictionPool } from "./PredictionPool.sol";
import { MockMatchRegistry, MockSeasonRegistry, MockPlayerStats } from "./mocks/PredictionPoolMocks.sol";
import { Outcome } from "./interfaces/ITickr.sol";

contract PredictionPoolTest is Test {
    TickToken tick;
    PredictionPool pool;
    MockMatchRegistry matchRegistry;
    MockSeasonRegistry seasonRegistry;
    MockPlayerStats playerStats;

    address owner = address(0xA11CE);
    address resultEngine = address(0xE12E);
    address alice = address(0xA1);
    address bob = address(0xB0B);
    address carol = address(0xCA5);

    uint256 constant SEASON_ID = 1;
    uint256 constant FIXTURE_ID = 0;
    uint256 constant STAKE_100 = 100 * 10 ** 18;
    uint256 constant STAKE_50 = 50 * 10 ** 18;

    function setUp() public {
        vm.startPrank(owner);
        tick = new TickToken(owner, 0);
        matchRegistry = new MockMatchRegistry();
        seasonRegistry = new MockSeasonRegistry(address(matchRegistry), address(0x7EA5));
        playerStats = new MockPlayerStats();
        pool = new PredictionPool(owner, address(tick), address(seasonRegistry), address(playerStats));
        pool.setResultEngine(resultEngine);
        vm.stopPrank();

        matchRegistry.setBettingOpen(FIXTURE_ID, true);

        vm.startPrank(owner);
        tick.mint(alice, 1_000 * 10 ** 18);
        tick.mint(bob, 1_000 * 10 ** 18);
        tick.mint(carol, 1_000 * 10 ** 18);
        vm.stopPrank();

        vm.prank(alice);
        tick.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        tick.approve(address(pool), type(uint256).max);
        vm.prank(carol);
        tick.approve(address(pool), type(uint256).max);
    }

    function test_StakeBelowMinimumReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinHome, 1 * 10 ** 18);
    }

    function test_StakeWhenBettingClosedReverts() public {
        matchRegistry.setBettingOpen(FIXTURE_ID, false);

        vm.prank(alice);
        vm.expectRevert();
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinHome, STAKE_100);
    }

    function test_StakeAccumulatesInCorrectOutcomePool() public {
        vm.prank(alice);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinHome, STAKE_100);

        vm.prank(bob);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinAway, STAKE_50);

        PredictionPool.MatchPool memory p = pool.getPool(SEASON_ID, FIXTURE_ID);
        require(p.totalHome == STAKE_100, "home pool mismatch");
        require(p.totalAway == STAKE_50, "away pool mismatch");
        require(p.totalDraw == 0, "draw pool should be zero");
    }

    /// @notice Core parimutuel math check: Alice stakes 100 on Home, Bob
    /// stakes 100 on Away. Home wins. Total pool = 200, fee = 7% (700bps),
    /// distributable = 186. Alice is the only Home staker, so she should
    /// receive the entire distributable amount (186 TICK).
    function test_WinnerReceivesFullDistributablePoolWhenSoleWinningStaker() public {
        vm.prank(alice);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinHome, STAKE_100);

        vm.prank(bob);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinAway, STAKE_100);

        vm.prank(resultEngine);
        pool.settleFixture(SEASON_ID, FIXTURE_ID, Outcome.WinHome);

        uint256 balBefore = tick.balanceOf(alice);

        vm.prank(alice);
        pool.claim(SEASON_ID, FIXTURE_ID);

        uint256 balAfter = tick.balanceOf(alice);
        uint256 expectedPayout = (200 * 10 ** 18 * 9_300) / 10_000; // 200 total * 93% (7% fee)

        require(balAfter - balBefore == expectedPayout, "payout does not match expected parimutuel amount");
    }

    /// @notice Two winners split proportionally to their stake within the
    /// winning pool.
    function test_MultipleWinnersSplitProportionally() public {
        vm.prank(alice);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinHome, STAKE_100); // 100 of 150 winning pool

        vm.prank(bob);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinHome, STAKE_50); // 50 of 150 winning pool

        vm.prank(carol);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinAway, STAKE_100); // losing pool

        vm.prank(resultEngine);
        pool.settleFixture(SEASON_ID, FIXTURE_ID, Outcome.WinHome);

        uint256 totalPool = STAKE_100 + STAKE_50 + STAKE_100; // 250
        uint256 distributable = (totalPool * 9_300) / 10_000;
        uint256 winningPool = STAKE_100 + STAKE_50; // 150

        uint256 aliceExpected = (STAKE_100 * distributable) / winningPool;
        uint256 bobExpected = (STAKE_50 * distributable) / winningPool;

        vm.prank(alice);
        pool.claim(SEASON_ID, FIXTURE_ID);
        vm.prank(bob);
        pool.claim(SEASON_ID, FIXTURE_ID);

        require(tick.balanceOf(alice) == 1_000 * 10 ** 18 - STAKE_100 + aliceExpected, "alice payout mismatch");
        require(tick.balanceOf(bob) == 1_000 * 10 ** 18 - STAKE_50 + bobExpected, "bob payout mismatch");
    }

    /// @notice If nobody staked the winning outcome, everyone who staked
    /// anything gets a full refund (no fee taken) rather than funds being
    /// stuck in the contract.
    function test_RefundWhenNoOneStakedWinningOutcome() public {
        vm.prank(alice);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinAway, STAKE_100);

        vm.prank(bob);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinAway, STAKE_50);

        // Home wins, but nobody staked Home.
        vm.prank(resultEngine);
        pool.settleFixture(SEASON_ID, FIXTURE_ID, Outcome.WinHome);

        uint256 aliceBalBefore = tick.balanceOf(alice);

        vm.prank(alice);
        pool.claim(SEASON_ID, FIXTURE_ID);

        require(tick.balanceOf(alice) - aliceBalBefore == STAKE_100, "alice should be refunded in full");
    }

    function test_CannotClaimTwice() public {
        vm.prank(alice);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinHome, STAKE_100);

        vm.prank(resultEngine);
        pool.settleFixture(SEASON_ID, FIXTURE_ID, Outcome.WinHome);

        vm.prank(alice);
        pool.claim(SEASON_ID, FIXTURE_ID);

        vm.prank(alice);
        vm.expectRevert();
        pool.claim(SEASON_ID, FIXTURE_ID);
    }

    function test_LoserClaimGetsNothingButDoesNotRevertUnexpectedly() public {
        vm.prank(alice);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinHome, STAKE_100);
        vm.prank(bob);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinAway, STAKE_100);

        vm.prank(resultEngine);
        pool.settleFixture(SEASON_ID, FIXTURE_ID, Outcome.WinHome);

        uint256 bobBalBefore = tick.balanceOf(bob);

        vm.prank(bob);
        pool.claim(SEASON_ID, FIXTURE_ID); // records the loss, transfers nothing

        require(tick.balanceOf(bob) == bobBalBefore, "loser balance should be unchanged");
    }

    function test_OnlyResultEngineCanSettle() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.settleFixture(SEASON_ID, FIXTURE_ID, Outcome.WinHome);
    }

    function test_FeeCannotExceedHardCap() public {
        vm.prank(owner);
        vm.expectRevert();
        pool.setPlatformFeeBps(1_001);
    }

    /// @notice The whole point of the seasonId refactor: fixtureId 0 in
    /// season 1 and fixtureId 0 in season 2 must be completely independent
    /// pools. A stake in one must never be visible in, or payable from,
    /// the other.
    function test_SameFixtureIdInDifferentSeasonsAreIsolatedPools() public {
        uint256 seasonTwo = 2;

        vm.prank(alice);
        pool.stake(SEASON_ID, FIXTURE_ID, Outcome.WinHome, STAKE_100);

        vm.prank(bob);
        pool.stake(seasonTwo, FIXTURE_ID, Outcome.WinAway, STAKE_50);

        PredictionPool.MatchPool memory seasonOnePool = pool.getPool(SEASON_ID, FIXTURE_ID);
        PredictionPool.MatchPool memory seasonTwoPool = pool.getPool(seasonTwo, FIXTURE_ID);

        require(seasonOnePool.totalHome == STAKE_100, "season 1 pool should have alice's stake");
        require(seasonOnePool.totalAway == 0, "season 1 pool should not see season 2 stake");
        require(seasonTwoPool.totalAway == STAKE_50, "season 2 pool should have bob's stake");
        require(seasonTwoPool.totalHome == 0, "season 2 pool should not see season 1 stake");
    }
}

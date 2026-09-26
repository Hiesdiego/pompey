// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { TickToken } from "./TickToken.sol";
import { SeasonRegistry } from "./SeasonRegistry.sol";
import { TeamRegistry } from "./TeamRegistry.sol";
import { MatchRegistry } from "./MatchRegistry.sol";
import { PriceOracle } from "./PriceOracle.sol";
import { ResultEngine } from "./ResultEngine.sol";
import { MarketFactory } from "./MarketFactory.sol";
import { Outcome } from "./interfaces/ITickr.sol";

/// @notice v0.2 MarketFactory tests: template validation, staking windows,
/// seed-liquidity economics, fee splits, permissionless resolution, and the
/// void path. Uses real PriceOracle/ResultEngine/MatchRegistry wiring where
/// the resolution math needs it, and prunes setup to the minimum otherwise.
contract MarketFactoryTest is Test {
    TickToken tick;
    SeasonRegistry seasonRegistry;
    TeamRegistry teamRegistry;
    MatchRegistry matchRegistry;
    PriceOracle oracle;
    ResultEngine resultEngine;
    MarketFactory factory;

    address owner = address(0xA11CE);
    address backend = address(0xBACC);
    address treasury = address(0x7EA5);
    address creator = address(0xC4EA70);
    address alice = address(0xA11CE + 1);
    address bob = address(0xB0B);

    uint256 constant SEASON_ID = 1;
    uint8 constant TEAM_COUNT = 4;
    uint256 constant ONE = 10 ** 8; // PRICE_DECIMALS

    uint64 seasonStart;

    function setUp() public {
        vm.startPrank(owner);
        tick = new TickToken(owner, 10_000_000 * 10 ** 18);
        seasonRegistry = new SeasonRegistry(owner);

        string[] memory names = new string[](TEAM_COUNT);
        string[] memory symbols = new string[](TEAM_COUNT);
        for (uint16 i = 0; i < TEAM_COUNT; i++) {
            names[i] = string(abi.encodePacked("Team", vm.toString(i)));
            symbols[i] = string(abi.encodePacked("T", vm.toString(i)));
        }
        teamRegistry = new TeamRegistry(owner, names, symbols);
        matchRegistry = new MatchRegistry(owner, address(teamRegistry), backend, 3600);

        oracle = new PriceOracle(owner, backend);
        resultEngine = new ResultEngine(owner, address(seasonRegistry));
        factory = new MarketFactory(
            owner, address(tick), address(seasonRegistry), address(oracle), address(resultEngine), treasury
        );

        oracle.setResultEngine(address(resultEngine));
        resultEngine.setPriceOracle(address(oracle));
        matchRegistry.setResultEngine(address(resultEngine));
        seasonRegistry.startNewSeason(address(teamRegistry), address(matchRegistry));
        vm.stopPrank();

        seasonStart = uint64(block.timestamp) + 1 hours;
        vm.prank(owner);
        matchRegistry.generateScheduleBatch(seasonStart, 2 days, 0, 6);

        // Fund creator/alice/bob with TICK.
        vm.startPrank(owner);
        tick.mint(creator, 100_000 * 10 ** 18);
        tick.mint(alice, 100_000 * 10 ** 18);
        tick.mint(bob, 100_000 * 10 ** 18);
        vm.stopPrank();
    }

    // --- helpers ---

    function _approveAll(address user) internal {
        vm.startPrank(user);
        tick.approve(address(factory), type(uint256).max);
        vm.stopPrank();
    }

    function _submitHourlyCheckpoints(uint16[] memory teams, uint256[] memory prices) internal {
        vm.prank(backend);
        oracle.submitCheckpoints(teams, prices);
    }

    function _twoTeams() internal pure returns (uint16[] memory teams) {
        teams = new uint16[](2);
        teams[0] = 0;
        teams[1] = 1;
    }

    // --- createMarket validation ---

    function test_CreateTopGainerMarket() public {
        _approveAll(creator);
        vm.prank(creator);
        uint256 id = factory.createMarket(
            factory.T_TOP_GAINER(), abi.encode(SEASON_ID, uint8(0)), "diego"
        );
        (
            uint8 templateId,
            address mcreator,
            string memory name,
            uint64 createdAt,
            uint64 bettingCloseTime,
            uint64 endTime,
            uint64 voidAfter,
            bytes memory params,
            uint8 outcomes,
            uint256 seedAmount,
            uint256 totalStaked,
            MarketFactory.MarketState state,
            uint256 winnerBitmap,
            uint256 payoutPerShare
        ) =
            _market(id);
        require(templateId == factory.T_TOP_GAINER(), "wrong template");
        require(mcreator == creator, "wrong creator");
        require(keccak256(bytes(name)) == keccak256(bytes("diego")), "wrong name");
        require(outcomes == TEAM_COUNT, "wrong outcome count");
        require(tick.balanceOf(address(factory)) == factory.CREATION_SEED(), "seed not pulled");
    }

    function _market(uint256 id)
        internal
        view
        returns (
            uint8 templateId,
            address mcreator,
            string memory name,
            uint64 createdAt,
            uint64 bettingCloseTime,
            uint64 endTime,
            uint64 voidAfter,
            bytes memory params,
            uint8 outcomes,
            uint256 seedAmount,
            uint256 totalStaked,
            MarketFactory.MarketState state,
            uint256 winnerBitmap,
            uint256 payoutPerShare
        )
    {
        (
            templateId,
            mcreator,
            name,
            createdAt,
            bettingCloseTime,
            endTime,
            voidAfter,
            params,
            outcomes
        ) = factory.marketInfo(id);
        (seedAmount, totalStaked, state, winnerBitmap, payoutPerShare) =
            factory.marketSettlement(id);
    }

    function test_CreateRejectsUnknownTemplate() public {
        _approveAll(creator);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MarketFactory.UnknownTemplate.selector, 9));
        factory.createMarket(9, "", "x");
    }

    function test_CreateRejectsLongCreatorName() public {
        _approveAll(creator);
        vm.prank(creator);
        vm.expectRevert();
        factory.createMarket(
            factory.T_TOP_GAINER(),
            abi.encode(SEASON_ID, uint8(0)),
            "this name is definitely way too long for the limit"
        );
    }

    function test_CreateRejectsPastMatchday() public {
        _approveAll(creator);
        // Fast-forward past matchday 0's window end.
        uint64 windowEnd = seasonStart + 2 days;
        vm.warp(windowEnd + 1);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MarketFactory.InvalidParams.selector));
        factory.createMarket(factory.T_TOP_GAINER(), abi.encode(SEASON_ID, uint8(0)), "x");
    }

    function test_CreateH2HRejectsSameTeam() public {
        _approveAll(creator);
        uint64 now_ = uint64(block.timestamp);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MarketFactory.InvalidParams.selector));
        factory.createMarket(
            factory.T_H2H(), abi.encode(uint16(1), uint16(1), now_ + 1 hours, now_ + 2 hours), "x"
        );
    }

    // --- staking ---

    function test_StakeAndBettingWindow() public {
        _approveAll(creator);
        _approveAll(alice);
        vm.prank(creator);
        uint256 id = factory.createMarket(
            factory.T_TOP_GAINER(), abi.encode(SEASON_ID, uint8(0)), "diego"
        );

        vm.prank(alice);
        factory.stake(id, 0, 100 * 10 ** 18);
        require(factory.outcomeTotals(id, 0) == 100 * 10 ** 18, "stake not recorded");

        // Below MIN_STAKE reverts.
        vm.prank(alice);
        vm.expectRevert();
        factory.stake(id, 0, 1 * 10 ** 18);

        // After the betting-close buffer, staking reverts.
        (,,,, uint64 bettingCloseTime,,,,,,,,,) = _market(id);
        vm.warp(bettingCloseTime);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MarketFactory.BettingClosed.selector, id));
        factory.stake(id, 0, 100 * 10 ** 18);
    }

    // --- TOP_GAINER resolution + economics ---

    function test_TopGainerResolvesWithSeedSubsidyAndFees() public {
        _approveAll(creator);
        _approveAll(alice);
        _approveAll(bob);

        vm.prank(creator);
        uint256 id = factory.createMarket(
            factory.T_TOP_GAINER(), abi.encode(SEASON_ID, uint8(0)), "diego"
        );
        (,,,,, uint64 endTime,,,,,,,,) = _market(id);

        // Stakes: alice 100 on team 0, bob 300 on team 1.
        vm.prank(alice);
        factory.stake(id, 0, 100 * 10 ** 18);
        vm.prank(bob);
        factory.stake(id, 1, 300 * 10 ** 18);

        // Checkpoint prices at the window edges: team 0 +10%, team 1 +5%.
        uint64 windowStart = seasonStart;
        uint64 windowEnd = seasonStart + 2 days;
        uint16[] memory teams = new uint16[](2);
        teams[0] = 0;
        teams[1] = 1;
        uint256[] memory prices = new uint256[](2);

        vm.warp(windowStart);
        prices[0] = 100 * ONE;
        prices[1] = 100 * ONE;
        _submitHourlyCheckpoints(teams, prices);

        vm.warp(windowEnd);
        prices[0] = 110 * ONE;
        prices[1] = 105 * ONE;
        _submitHourlyCheckpoints(teams, prices);

        // Resolve (permissionless — anyone may call; alice takes the bounty).
        vm.warp(endTime + 1);
        uint256 aliceBefore = tick.balanceOf(alice);
        vm.prank(alice);
        factory.resolve(id);

        (,,,,,,,,,,, MarketFactory.MarketState state, uint256 bitmap, uint256 pps) = _market(id);
        require(state == MarketFactory.MarketState.Resolved, "not resolved");
        require(bitmap == 1, "team 0 should win"); // bit 0

        // Economics: totalStaked=400, fees 3/2/1% => 12/8/4, distributable =
        // 400-24+250(seed) = 626. Alice (sole winner) gets 626.
        vm.prank(alice);
        factory.claim(id);
        uint256 payout = tick.balanceOf(alice) - aliceBefore;
        // aliceBefore already excludes her 100 stake; payout includes it back.
        require(payout == 626 * 10 ** 18 + 4 * 10 ** 18, "wrong payout"); // 626 + resolver bounty 4

        // Fee recipients got paid.
        require(tick.balanceOf(treasury) == 12 * 10 ** 18, "treasury fee wrong");
        require(
            tick.balanceOf(creator) == 100_000 * 10 ** 18 - 250 * 10 ** 18 + 8 * 10 ** 18,
            "creator fee wrong"
        );
        require(pps == 626 * 10 ** 18, "wrong payoutPerShare");
    }

    function test_ResolveWithNoStakesSendsSeedToTreasury() public {
        _approveAll(creator);
        vm.prank(creator);
        uint256 id = factory.createMarket(
            factory.T_TOP_GAINER(), abi.encode(SEASON_ID, uint8(0)), "diego"
        );
        (,,,,, uint64 endTime,,,,,,,,) = _market(id);

        uint64 windowStart = seasonStart;
        uint64 windowEnd = seasonStart + 2 days;
        uint16[] memory teams = _twoTeams();
        uint256[] memory prices = new uint256[](2);
        vm.warp(windowStart);
        prices[0] = 100 * ONE;
        prices[1] = 100 * ONE;
        _submitHourlyCheckpoints(teams, prices);
        vm.warp(windowEnd);
        prices[0] = 110 * ONE;
        prices[1] = 105 * ONE;
        _submitHourlyCheckpoints(teams, prices);

        vm.warp(endTime + 1);
        vm.prank(alice);
        factory.resolve(id);
        require(tick.balanceOf(treasury) == 250 * 10 ** 18, "seed should go to treasury");
    }

    // --- TARGET template ---

    function test_TargetResolvesYes() public {
        _approveAll(creator);
        _approveAll(alice);
        uint64 atTime = uint64(block.timestamp) + 3 hours;
        vm.prank(creator);
        uint256 id = factory.createMarket(
            factory.T_TARGET(), abi.encode(uint16(0), 105 * ONE, atTime, true), "diego"
        );

        vm.prank(alice);
        factory.stake(id, 0, 50 * 10 ** 18); // Yes

        vm.warp(atTime);
        uint16[] memory teams = new uint16[](1);
        teams[0] = 0;
        uint256[] memory prices = new uint256[](1);
        prices[0] = 106 * ONE;
        _submitHourlyCheckpoints(teams, prices);

        vm.prank(bob);
        factory.resolve(id);
        (,,,,,,,,,,, MarketFactory.MarketState state, uint256 bitmap,) = _market(id);
        require(state == MarketFactory.MarketState.Resolved, "not resolved");
        require(bitmap == 1, "Yes (outcome 0) should win");
    }

    // --- H2H template ---

    function test_H2HTieSplits() public {
        _approveAll(creator);
        _approveAll(alice);
        _approveAll(bob);
        uint64 now_ = uint64(block.timestamp);
        uint64 startTime = now_ - 30 minutes; // checkpoints already exist? no — submit them
        uint64 endTime_ = now_ + 3 hours;

        vm.prank(creator);
        uint256 id = factory.createMarket(
            factory.T_H2H(), abi.encode(uint16(0), uint16(1), startTime, endTime_), "diego"
        );

        vm.prank(alice);
        factory.stake(id, 0, 100 * 10 ** 18); // A
        vm.prank(bob);
        factory.stake(id, 1, 100 * 10 ** 18); // B

        // Identical gains => tie => bitmap 0b11.
        uint16[] memory teams = _twoTeams();
        uint256[] memory prices = new uint256[](2);
        prices[0] = 100 * ONE;
        prices[1] = 100 * ONE;
        _submitHourlyCheckpoints(teams, prices);
        vm.warp(endTime_);
        prices[0] = 110 * ONE;
        prices[1] = 110 * ONE;
        _submitHourlyCheckpoints(teams, prices);

        vm.prank(alice);
        factory.resolve(id);
        (,,,,,,,,,,, MarketFactory.MarketState state, uint256 bitmap,) = _market(id);
        require(state == MarketFactory.MarketState.Resolved, "not resolved");
        require(bitmap == 3, "tie should set both bits");

        // Both claim: each gets (200-12+250)/2 = 219.
        uint256 aBefore = tick.balanceOf(alice);
        vm.prank(alice);
        factory.claim(id);
        require(tick.balanceOf(alice) - aBefore == 219 * 10 ** 18, "alice payout wrong");
        uint256 bBefore = tick.balanceOf(bob);
        vm.prank(bob);
        factory.claim(id);
        require(tick.balanceOf(bob) - bBefore == 219 * 10 ** 18, "bob payout wrong");
    }

    // --- void path ---

    function test_VoidRefundsStakesAndSeed() public {
        _approveAll(creator);
        _approveAll(alice);
        uint64 atTime = uint64(block.timestamp) + 3 hours;
        vm.prank(creator);
        uint256 id = factory.createMarket(
            factory.T_TARGET(), abi.encode(uint16(0), 105 * ONE, atTime, true), "diego"
        );
        (,,,,,, uint64 voidAfter,,,,,,,) = _market(id);

        vm.prank(alice);
        factory.stake(id, 0, 50 * 10 ** 18);

        // Never submit the checkpoint: unresolvable. resolve() reverts...
        vm.warp(atTime + 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MarketFactory.NotResolvableYet.selector, id));
        factory.resolve(id);

        // ...but voidMarket() before the deadline also reverts.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MarketFactory.NotVoidable.selector, id));
        factory.voidMarket(id);

        // After the void deadline: void succeeds, stakes refunded, seed back.
        vm.warp(voidAfter + 1);
        uint256 creatorBefore = tick.balanceOf(creator);
        uint256 aliceBefore = tick.balanceOf(alice);
        vm.prank(bob);
        factory.voidMarket(id);
        vm.prank(alice);
        factory.claim(id);
        require(tick.balanceOf(alice) - aliceBefore == 50 * 10 ** 18, "stake not refunded");
        require(tick.balanceOf(creator) - creatorBefore == 250 * 10 ** 18, "seed not refunded");
    }

    // --- admin ---

    function test_SetFeesRejectsOverCeiling() public {
        vm.prank(owner);
        vm.expectRevert();
        factory.setFees(500, 300, 300); // 11% > 10% ceiling
    }

    function test_SetFeesOk() public {
        vm.prank(owner);
        factory.setFees(200, 100, 50);
        require(factory.treasuryFeeBps() == 200, "treasury fee not set");
        require(factory.creatorFeeBps() == 100, "creator fee not set");
        require(factory.resolverFeeBps() == 50, "resolver fee not set");
    }
}

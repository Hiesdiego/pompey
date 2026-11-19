// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { TickToken } from "./TickToken.sol";
import { StockERC1967Proxy } from "./StockERC1967Proxy.sol";
import { StockMarketFactory } from "./StockMarketFactory.sol";
import { StockMarketConstants, StockDirection } from "./StockMarketConstants.sol";

/// @notice V2 mock used only to prove the UUPS proxy is upgradeable by the
/// owner. Adds one function, changes no storage layout.
contract StockMarketFactoryV2Mock is StockMarketFactory {
    function version() external pure returns (uint256) {
        return 2;
    }
}

/// @notice StockMarketFactory tests: creation with seed, staking windows,
/// resolver-submitted NAV resolution, the exact tie rule for both
/// directions, fee splits, seed handling on resolve and on void, void
/// refunds, the treasury sweep, and the MAX_TARGET_TIME deadline cap.
/// Mirrors the style of MarketFactory.t.sol. The factory is deployed
/// behind StockERC1967Proxy exactly as StockMarketFactoryDeploy.ts does.
contract StockMarketFactoryTest is Test {
    TickToken tick;
    StockMarketFactory factory;

    address owner = address(0xA11CE);
    address resolver = address(0xBACC);
    address treasury = address(0x7EA5);
    address creator = address(0xC4EA70);
    address alice = address(0xA11CE + 1);
    address bob = address(0xB0B);
    address carol = address(0xCA401);

    // NVDAc, the real Base B20 token for NVIDIA (lowercase form of the
    // address recorded in StockDeploy.ts). The factory treats the token
    // as an opaque identity, so no calls are made to it.
    address constant STOCK_TOKEN = address(0xb20000000000000000000078ee7ce2fE4908108C);

    uint256 constant SCALE = 100_000_000; // StockMarketConstants.PRICE_SCALE
    uint256 constant TARGET = 100 * SCALE; // $100.00 target

    function setUp() public {
        // A realistic base time: Nov 2023, far before every deadline used
        // here and far before MAX_TARGET_TIME (Dec 31, 2026).
        vm.warp(1_700_000_000);

        tick = new TickToken(owner, 10_000_000 * 10 ** 18);

        StockMarketFactory impl = new StockMarketFactory();
        bytes memory initData = abi.encodeCall(
            StockMarketFactory.initialize, (owner, address(tick), treasury, resolver)
        );
        StockERC1967Proxy proxy = new StockERC1967Proxy(address(impl), initData);
        factory = StockMarketFactory(address(proxy));

        // Fund creator/alice/bob/carol with TICK and approve the factory.
        vm.startPrank(owner);
        tick.mint(creator, 100_000 * 10 ** 18);
        tick.mint(alice, 100_000 * 10 ** 18);
        tick.mint(bob, 100_000 * 10 ** 18);
        tick.mint(carol, 100_000 * 10 ** 18);
        vm.stopPrank();

        _approveAll(creator);
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);
    }

    // --- helpers ---

    function _approveAll(address user) internal {
        vm.prank(user);
        tick.approve(address(factory), type(uint256).max);
    }

    function _deadline(uint64 lead) internal view returns (uint64) {
        return uint64(block.timestamp) + lead;
    }

    function _create(StockDirection dir, uint256 target, uint64 deadline) internal returns (uint256) {
        vm.prank(creator);
        return factory.createMarket(STOCK_TOKEN, "NVDAc", dir, target, deadline, "diego");
    }

    function _stake(address user, uint256 id, uint256 outcome, uint256 amount) internal {
        vm.prank(user);
        factory.stake(id, outcome, amount);
    }

    function _resolve(uint256 id, uint256 finalPrice) internal {
        vm.prank(resolver);
        factory.resolve(id, finalPrice);
    }

    function _settlement(uint256 id)
        internal
        view
        returns (
            uint256 seedAmount,
            uint256 totalStaked,
            StockMarketFactory.MarketState state,
            uint256 winnerBitmap,
            uint256 payoutPerShare,
            uint256 finalPrice
        )
    {
        return factory.marketSettlement(id);
    }

    // --- initialization and upgrades ---

    function test_InitializeSetsWiringAndDefaultFees() public view {
        require(address(factory.tick()) == address(tick), "tick not wired");
        require(factory.treasury() == treasury, "treasury not wired");
        require(factory.resolver() == resolver, "resolver not wired");
        require(factory.owner() == owner, "owner not wired");
        require(factory.treasuryFeeBps() == 300, "treasury fee not 3 percent");
        require(factory.creatorFeeBps() == 200, "creator fee not 2 percent");
        require(factory.resolverFeeBps() == 100, "resolver fee not 1 percent");
        require(factory.marketCount() == 0, "market count not zero");
    }

    function test_CannotInitializeTwice() public {
        vm.expectRevert();
        factory.initialize(owner, address(tick), treasury, resolver);
    }

    function test_OwnerCanUpgrade() public {
        StockMarketFactoryV2Mock v2 = new StockMarketFactoryV2Mock();
        vm.prank(owner);
        factory.upgradeToAndCall(address(v2), bytes(""));
        require(StockMarketFactoryV2Mock(address(factory)).version() == 2, "upgrade did not take");
    }

    function test_NonOwnerCannotUpgrade() public {
        StockMarketFactoryV2Mock v2 = new StockMarketFactoryV2Mock();
        vm.prank(alice);
        vm.expectRevert();
        factory.upgradeToAndCall(address(v2), bytes(""));
    }

    // --- create ---

    function test_CreatePullsSeedAndStoresTerms() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        require(id == 0, "first market id should be 0");
        require(factory.marketCount() == 1, "market count wrong");
        require(
            tick.balanceOf(address(factory)) == StockMarketConstants.CREATION_SEED,
            "seed not pulled into the factory"
        );
        require(
            tick.balanceOf(creator) == 100_000 * 10 ** 18 - 250 * 10 ** 18,
            "seed not pulled from the creator"
        );

        (
            address stockToken,
            string memory symbol,
            StockDirection direction,
            uint256 targetPrice,
            address mCreator,
            string memory creatorName,
            uint64 createdAt,
            uint64 bettingCloseTime,
            uint64 endTime,
            uint64 voidAfter,
            uint8 outcomeCount
        ) = factory.marketInfo(id);
        require(stockToken == STOCK_TOKEN, "wrong stock token");
        require(keccak256(bytes(symbol)) == keccak256(bytes("NVDAc")), "wrong symbol");
        require(direction == StockDirection.Above, "wrong direction");
        require(targetPrice == TARGET, "wrong target price");
        require(mCreator == creator, "wrong creator");
        require(keccak256(bytes(creatorName)) == keccak256(bytes("diego")), "wrong creator name");
        require(createdAt == uint64(block.timestamp), "wrong createdAt");
        require(endTime == deadline, "wrong deadline");
        require(bettingCloseTime == deadline - 5 minutes, "wrong betting close");
        require(voidAfter == deadline + 7 days, "wrong voidAfter");
        require(outcomeCount == 2, "wrong outcome count");

        (uint256 seedAmount, uint256 totalStaked, StockMarketFactory.MarketState state,,,) =
            _settlement(id);
        require(seedAmount == 250 * 10 ** 18, "seed not stored on the market");
        require(totalStaked == 0, "total staked should start at zero");
        require(state == StockMarketFactory.MarketState.Open, "market should be open");
    }

    function test_CreateRegistersActiveAndCreatedIndex() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        (bool exists, uint256 activeId) =
            factory.activeMarket(STOCK_TOKEN, StockDirection.Above, TARGET, deadline);
        require(exists && activeId == id, "active market index missing");
        (bool wasCreated, uint256 createdId) =
            factory.createdMarket(STOCK_TOKEN, StockDirection.Above, TARGET, deadline);
        require(wasCreated && createdId == id, "created market index missing");
        (bool missing,) = factory.activeMarket(STOCK_TOKEN, StockDirection.Below, TARGET, deadline);
        require(!missing, "uncreated terms should not be active");
    }

    function test_CreateDuplicateTermsReverts() public {
        uint64 deadline = _deadline(3 days);
        uint256 first = _create(StockDirection.Above, TARGET, deadline);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                StockMarketFactory.DuplicateOpenMarket.selector,
                keccak256(abi.encode(STOCK_TOKEN, StockDirection.Above, TARGET, deadline)),
                first
            )
        );
        factory.createMarket(STOCK_TOKEN, "NVDAc", StockDirection.Above, TARGET, deadline, "clone");
    }

    function test_CreateSameTermsOppositeDirectionIsDistinct() public {
        uint64 deadline = _deadline(3 days);
        _create(StockDirection.Above, TARGET, deadline);
        uint256 second = _create(StockDirection.Below, TARGET, deadline);
        require(second == 1, "opposite direction should be a distinct market");
    }

    function test_CreateRejectsZeroTarget() public {
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.InvalidParams.selector));
        factory.createMarket(STOCK_TOKEN, "NVDAc", StockDirection.Above, 0, _deadline(3 days), "x");
    }

    function test_CreateRejectsZeroToken() public {
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.InvalidParams.selector));
        factory.createMarket(address(0), "NVDAc", StockDirection.Above, TARGET, _deadline(3 days), "x");
    }

    function test_CreateRejectsEmptySymbol() public {
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.InvalidParams.selector));
        factory.createMarket(STOCK_TOKEN, "", StockDirection.Above, TARGET, _deadline(3 days), "x");
    }

    function test_CreateRejectsLongSymbol() public {
        vm.prank(creator);
        vm.expectRevert();
        factory.createMarket(
            STOCK_TOKEN, "THIS SYMBOL IS TOO LONG", StockDirection.Above, TARGET, _deadline(3 days), "x"
        );
    }

    function test_CreateRejectsLongCreatorName() public {
        vm.prank(creator);
        vm.expectRevert();
        factory.createMarket(
            STOCK_TOKEN,
            "NVDAc",
            StockDirection.Above,
            TARGET,
            _deadline(3 days),
            "this name is definitely way too long for the limit"
        );
    }

    function test_CreateRejectsTooSoonDeadline() public {
        // 30 minutes of lead is below MIN_MARKET_LEAD (1 hour).
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.InvalidParams.selector));
        factory.createMarket(STOCK_TOKEN, "NVDAc", StockDirection.Above, TARGET, _deadline(30 minutes), "x");
    }

    function test_CreateRejectsDeadlineAfterMaxTargetTime() public {
        vm.warp(1793232000); // late Oct 2026, like MarketFactory.t.sol
        uint64 maxTime = StockMarketConstants.MAX_TARGET_TIME;
        // Exactly at the cap succeeds.
        vm.prank(creator);
        factory.createMarket(STOCK_TOKEN, "NVDAc", StockDirection.Above, TARGET, maxTime, "year end");
        // One second past the cap reverts.
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.InvalidParams.selector));
        factory.createMarket(STOCK_TOKEN, "NVDAc", StockDirection.Above, TARGET + 1, maxTime + 1, "2027");
    }

    // --- staking ---

    function test_StakeOnBothSides() public {
        uint256 id = _create(StockDirection.Above, TARGET, _deadline(3 days));
        _stake(alice, id, 0, 100 * 10 ** 18); // Yes
        _stake(bob, id, 1, 300 * 10 ** 18); // No

        require(factory.outcomeTotals(id, 0) == 100 * 10 ** 18, "Yes total wrong");
        require(factory.outcomeTotals(id, 1) == 300 * 10 ** 18, "No total wrong");
        require(factory.stakes(id, alice, 0) == 100 * 10 ** 18, "alice stake wrong");
        require(factory.stakes(id, bob, 1) == 300 * 10 ** 18, "bob stake wrong");
        (, uint256 totalStaked,,,,) = _settlement(id);
        require(totalStaked == 400 * 10 ** 18, "total staked wrong");
        require(
            tick.balanceOf(address(factory)) == 250 * 10 ** 18 + 400 * 10 ** 18,
            "factory balance should be seed plus stakes"
        );
    }

    function test_StakeBelowMinimumReverts() public {
        uint256 id = _create(StockDirection.Above, TARGET, _deadline(3 days));
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                StockMarketFactory.StakeTooLow.selector, 1 * 10 ** 18, StockMarketConstants.MIN_STAKE
            )
        );
        factory.stake(id, 0, 1 * 10 ** 18);
    }

    function test_StakeInvalidOutcomeReverts() public {
        uint256 id = _create(StockDirection.Above, TARGET, _deadline(3 days));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.InvalidOutcome.selector, id, 2));
        factory.stake(id, 2, 100 * 10 ** 18);
    }

    function test_StakeRevertsAtBettingCloseAndAfterDeadline() public {
        uint64 deadline = _deadline(2 hours);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        _stake(alice, id, 0, 50 * 10 ** 18); // still open

        // At bettingCloseTime (deadline minus 5 minutes) staking is closed.
        vm.warp(deadline - 5 minutes);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.BettingClosed.selector, id));
        factory.stake(id, 0, 50 * 10 ** 18);

        // After the deadline itself it stays closed.
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.BettingClosed.selector, id));
        factory.stake(id, 0, 50 * 10 ** 18);
    }

    // --- resolution: direction outcomes ---

    function test_ResolveAbovePriceAboveTargetYesWins() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        _stake(alice, id, 0, 100 * 10 ** 18);

        vm.warp(deadline);
        _resolve(id, 110 * SCALE); // $110.00 > $100.00

        (,, StockMarketFactory.MarketState state, uint256 bitmap,, uint256 finalPrice) = _settlement(id);
        require(state == StockMarketFactory.MarketState.Resolved, "not resolved");
        require(bitmap == 1, "Yes (outcome 0) should win");
        require(finalPrice == 110 * SCALE, "final price not stored");
    }

    function test_ResolveAbovePriceBelowTargetNoWins() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        _stake(bob, id, 1, 100 * 10 ** 18);

        vm.warp(deadline);
        _resolve(id, TARGET - 1); // one scale unit below the target

        (,, StockMarketFactory.MarketState state, uint256 bitmap,,) = _settlement(id);
        require(state == StockMarketFactory.MarketState.Resolved, "not resolved");
        require(bitmap == 2, "No (outcome 1) should win");
    }

    function test_ResolveBelowPriceBelowTargetYesWins() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Below, TARGET, deadline);
        _stake(alice, id, 0, 100 * 10 ** 18);

        vm.warp(deadline);
        _resolve(id, 90 * SCALE); // $90.00 < $100.00

        (,, StockMarketFactory.MarketState state, uint256 bitmap,,) = _settlement(id);
        require(state == StockMarketFactory.MarketState.Resolved, "not resolved");
        require(bitmap == 1, "Yes (outcome 0) should win");
    }

    function test_ResolveBelowPriceAboveTargetNoWins() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Below, TARGET, deadline);
        _stake(bob, id, 1, 100 * 10 ** 18);

        vm.warp(deadline);
        _resolve(id, TARGET + 1); // one scale unit above the target

        (,, StockMarketFactory.MarketState state, uint256 bitmap,,) = _settlement(id);
        require(state == StockMarketFactory.MarketState.Resolved, "not resolved");
        require(bitmap == 2, "No (outcome 1) should win");
    }

    // --- resolution: the exact tie rule ---

    function test_TieAboveMarketNoWins() public {
        // At exactly the target, Above resolves No: Yes needs strictly >.
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        _stake(alice, id, 0, 100 * 10 ** 18); // Yes
        _stake(bob, id, 1, 50 * 10 ** 18); // No

        vm.warp(deadline);
        _resolve(id, TARGET); // exactly $100.00

        (,, StockMarketFactory.MarketState state, uint256 bitmap,,) = _settlement(id);
        require(state == StockMarketFactory.MarketState.Resolved, "not resolved");
        require(bitmap == 2, "tie on Above must resolve No");

        // Bob (sole No staker) claims the whole distributable:
        // total 150, fees 4.5 + 3 + 1.5 = 9, distributable 150 - 9 + 250 = 391.
        uint256 bobBefore = tick.balanceOf(bob);
        vm.prank(bob);
        factory.claim(id);
        require(tick.balanceOf(bob) - bobBefore == 391 * 10 ** 18, "No winner payout wrong");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.NothingToClaim.selector, id, alice));
        factory.claim(id);
    }

    function test_TieBelowMarketYesWins() public {
        // At exactly the target, Below resolves Yes: Yes needs <=.
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Below, TARGET, deadline);
        _stake(alice, id, 0, 100 * 10 ** 18); // Yes
        _stake(bob, id, 1, 50 * 10 ** 18); // No

        vm.warp(deadline);
        _resolve(id, TARGET); // exactly $100.00

        (,, StockMarketFactory.MarketState state, uint256 bitmap,,) = _settlement(id);
        require(state == StockMarketFactory.MarketState.Resolved, "not resolved");
        require(bitmap == 1, "tie on Below must resolve Yes");

        // Alice (sole Yes staker) claims the whole distributable: 391.
        uint256 aliceBefore = tick.balanceOf(alice);
        vm.prank(alice);
        factory.claim(id);
        require(tick.balanceOf(alice) - aliceBefore == 391 * 10 ** 18, "Yes winner payout wrong");
    }

    // --- resolution: guards ---

    function test_ResolveBeforeDeadlineReverts() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        vm.warp(deadline - 1);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.NotResolvableYet.selector, id));
        factory.resolve(id, 110 * SCALE);
    }

    function test_ResolveByNonResolverReverts() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.OnlyResolver.selector));
        factory.resolve(id, 110 * SCALE);
    }

    function test_ResolveZeroPriceReverts() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        vm.warp(deadline);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.InvalidPrice.selector));
        factory.resolve(id, 0);
    }

    function test_ResolveTwiceReverts() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        vm.warp(deadline);
        _resolve(id, 110 * SCALE);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.AlreadySettled.selector, id));
        factory.resolve(id, 110 * SCALE);
    }

    // --- resolution: economics ---

    function test_FeeSplitExactlyThreeTwoOneAndSeedSubsidy() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        _stake(alice, id, 0, 100 * 10 ** 18); // Yes
        _stake(bob, id, 1, 300 * 10 ** 18); // No

        vm.warp(deadline);
        _resolve(id, 110 * SCALE); // Yes wins

        // Fees on staked volume only (400): treasury 12 (3 percent),
        // creator 8 (2 percent), resolver 4 (1 percent). Seed pays no fee.
        require(tick.balanceOf(treasury) == 12 * 10 ** 18, "treasury fee wrong");
        require(
            tick.balanceOf(creator) == 100_000 * 10 ** 18 - 250 * 10 ** 18 + 8 * 10 ** 18,
            "creator fee wrong"
        );
        require(tick.balanceOf(resolver) == 4 * 10 ** 18, "resolver fee wrong");

        // Distributable = 400 - 24 + 250 (seed) = 626. Alice is the sole
        // winner, so she claims all 626: her 100 stake back, bob's 300,
        // the 250 seed, minus the 24 total fees.
        (,,,, uint256 pps,) = _settlement(id);
        require(pps == 626 * 10 ** 18 / 100, "wrong payoutPerShare");
        uint256 aliceBefore = tick.balanceOf(alice);
        vm.prank(alice);
        factory.claim(id);
        require(tick.balanceOf(alice) - aliceBefore == 626 * 10 ** 18, "winner payout wrong");

        // Double claim reverts, and the loser has nothing to claim.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.AlreadyClaimed.selector, id, alice));
        factory.claim(id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.NothingToClaim.selector, id, bob));
        factory.claim(id);
    }

    function test_ClaimPaysWinnersProRataMinusFees() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        _stake(alice, id, 0, 100 * 10 ** 18); // Yes
        _stake(bob, id, 0, 300 * 10 ** 18); // Yes
        _stake(carol, id, 1, 100 * 10 ** 18); // No

        vm.warp(deadline);
        _resolve(id, 110 * SCALE); // Yes wins

        // Total staked 500, fees 15 + 10 + 5 = 30, distributable
        // 500 - 30 + 250 = 720 over 400 winning stakes.
        // Alice: 100 * 720 / 400 = 180. Bob: 300 * 720 / 400 = 540.
        uint256 aliceBefore = tick.balanceOf(alice);
        vm.prank(alice);
        factory.claim(id);
        require(tick.balanceOf(alice) - aliceBefore == 180 * 10 ** 18, "alice pro-rata wrong");
        uint256 bobBefore = tick.balanceOf(bob);
        vm.prank(bob);
        factory.claim(id);
        require(tick.balanceOf(bob) - bobBefore == 540 * 10 ** 18, "bob pro-rata wrong");
        require(tick.balanceOf(treasury) == 15 * 10 ** 18, "treasury fee wrong");
    }

    function test_ResolveWithNoStakesSendsSeedToTreasury() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);

        vm.warp(deadline);
        _resolve(id, 110 * SCALE);

        require(tick.balanceOf(treasury) == 250 * 10 ** 18, "seed should go to treasury");
        (uint256 seedAmount,, StockMarketFactory.MarketState state, uint256 bitmap, uint256 pps,) =
            _settlement(id);
        require(seedAmount == 0, "seed should be cleared");
        require(state == StockMarketFactory.MarketState.Resolved, "not resolved");
        require(bitmap == 1, "stored winner should still be Yes");
        require(pps == 0, "payoutPerShare should be zero with no stakes");
    }

    function test_TreasurySweepWhenWinningSideHasZeroStakers() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        _stake(alice, id, 0, 100 * 10 ** 18); // only Yes staked

        vm.warp(deadline);
        _resolve(id, 90 * SCALE); // No wins, but nobody staked No

        // The ENTIRE pool (100 staked + 250 seed) goes to treasury, no
        // separate fees are taken on this path, no refunds.
        require(tick.balanceOf(treasury) == 350 * 10 ** 18, "whole pool should sweep to treasury");
        require(tick.balanceOf(resolver) == 0, "resolver should get no fee on a sweep");
        require(tick.balanceOf(address(factory)) == 0, "factory should be empty after sweep");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.NothingToClaim.selector, id, alice));
        factory.claim(id);
    }

    // --- void ---

    function test_VoidRefundsStakesOneToOneAndReturnsSeed() public {
        uint256 id = _create(StockDirection.Above, TARGET, _deadline(3 days));
        _stake(alice, id, 0, 50 * 10 ** 18);
        _stake(bob, id, 1, 30 * 10 ** 18);

        uint256 creatorBefore = tick.balanceOf(creator);
        vm.prank(resolver);
        factory.voidMarket(id);

        (uint256 seedAmount,, StockMarketFactory.MarketState state,,,) = _settlement(id);
        require(state == StockMarketFactory.MarketState.Voided, "not voided");
        require(seedAmount == 0, "seed should be cleared");
        require(
            tick.balanceOf(creator) - creatorBefore == 250 * 10 ** 18,
            "seed not returned to creator on void"
        );

        // Full 1:1 refunds through claim(), no fee taken.
        uint256 aliceBefore = tick.balanceOf(alice);
        vm.prank(alice);
        factory.claim(id);
        require(tick.balanceOf(alice) - aliceBefore == 50 * 10 ** 18, "alice refund wrong");
        uint256 bobBefore = tick.balanceOf(bob);
        vm.prank(bob);
        factory.claim(id);
        require(tick.balanceOf(bob) - bobBefore == 30 * 10 ** 18, "bob refund wrong");
        require(tick.balanceOf(address(factory)) == 0, "factory should be empty after refunds");
        require(tick.balanceOf(treasury) == 0, "no fee should be taken on a void");
    }

    function test_VoidByOwnerWorks() public {
        uint256 id = _create(StockDirection.Below, TARGET, _deadline(3 days));
        vm.prank(owner);
        factory.voidMarket(id);
        (,, StockMarketFactory.MarketState state,,,) = _settlement(id);
        require(state == StockMarketFactory.MarketState.Voided, "owner void failed");
    }

    function test_VoidByStrangerReverts() public {
        uint256 id = _create(StockDirection.Above, TARGET, _deadline(3 days));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.OnlyResolverOrOwner.selector));
        factory.voidMarket(id);
    }

    function test_VoidAfterResolveReverts() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        vm.warp(deadline);
        _resolve(id, 110 * SCALE);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.AlreadySettled.selector, id));
        factory.voidMarket(id);
    }

    function test_StakeOnVoidedMarketReverts() public {
        uint256 id = _create(StockDirection.Above, TARGET, _deadline(3 days));
        vm.prank(resolver);
        factory.voidMarket(id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.MarketNotOpen.selector, id));
        factory.stake(id, 0, 50 * 10 ** 18);
    }

    function test_ClaimOnOpenMarketReverts() public {
        uint256 id = _create(StockDirection.Above, TARGET, _deadline(3 days));
        _stake(alice, id, 0, 50 * 10 ** 18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.MarketNotOpen.selector, id));
        factory.claim(id);
    }

    // --- admin ---

    function test_SetFeesRejectsOverCeiling() public {
        vm.prank(owner);
        vm.expectRevert();
        factory.setFees(500, 300, 300); // 11 percent > 10 percent ceiling
    }

    function test_SetFeesOk() public {
        vm.prank(owner);
        factory.setFees(200, 100, 50);
        require(factory.treasuryFeeBps() == 200, "treasury fee not set");
        require(factory.creatorFeeBps() == 100, "creator fee not set");
        require(factory.resolverFeeBps() == 50, "resolver fee not set");
    }

    function test_SetResolverRotatesResolutionRights() public {
        uint64 deadline = _deadline(3 days);
        uint256 id = _create(StockDirection.Above, TARGET, deadline);
        address newResolver = address(0xEE501);
        vm.prank(owner);
        factory.setResolver(newResolver);
        require(factory.resolver() == newResolver, "resolver not rotated");

        vm.warp(deadline);
        // The old resolver can no longer resolve.
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(StockMarketFactory.OnlyResolver.selector));
        factory.resolve(id, 110 * SCALE);
        // The new resolver can.
        vm.prank(newResolver);
        factory.resolve(id, 110 * SCALE);
        (,, StockMarketFactory.MarketState state,,,) = _settlement(id);
        require(state == StockMarketFactory.MarketState.Resolved, "new resolver could not resolve");
    }

    function test_SetTreasuryOk() public {
        address newTreasury = address(0x7EA52);
        vm.prank(owner);
        factory.setTreasury(newTreasury);
        require(factory.treasury() == newTreasury, "treasury not updated");
    }
}

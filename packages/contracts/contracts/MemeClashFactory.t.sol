// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { TickToken } from "./TickToken.sol";
import { StockERC1967Proxy } from "./StockERC1967Proxy.sol";
import { MemeClashFactory } from "./MemeClashFactory.sol";
import { MemeClashConstants, OpponentKind } from "./MemeClashConstants.sol";

/// @notice V2 mock used only to prove the UUPS proxy is upgradeable by the
/// owner. Adds one function, changes no storage layout.
contract MemeClashFactoryV2Mock is MemeClashFactory {
    function version() external pure returns (uint256) {
        return 2;
    }
}

/// @notice MemeClashFactory tests: creation against a stock and in a
/// derby, the non-cup duplicate guard and the cup exemption, staking
/// closing at window start, blitz and standard window timing, the
/// strict-greater outcome rule, exact-tie handling for open clashes and
/// cup ties, the 30 percent spike breaker, fee splits, seed handling on
/// resolve and on void, void refunds, and the treasury sweep. Mirrors
/// the style of StockMarketFactory.t.sol. The factory is deployed
/// behind StockERC1967Proxy exactly as MemeClashFactoryDeploy.ts does.
contract MemeClashFactoryTest is Test {
    TickToken tick;
    MemeClashFactory factory;

    address owner = address(0xA11CE);
    address resolver = address(0xBACC);
    address treasury = address(0x7EA5);
    address creator = address(0xC4EA70);
    address alice = address(0xA11CE + 1);
    address bob = address(0xB0B);
    address carol = address(0xCA401);

    // The factory treats both tokens as opaque identities, so no calls
    // are made to them. The stock opponent is NVDAc, the real Base B20
    // token for NVIDIA, as in StockMarketFactory.t.sol.
    address constant MEME_TOKEN = address(0x1001);
    address constant MEME_OPP_TOKEN = address(0x2002);
    address constant STOCK_TOKEN = address(0xb20000000000000000000078ee7ce2fE4908108C);

    uint256 constant SCALE = 100_000_000; // MemeClashConstants.PRICE_SCALE
    uint256 constant START = 100 * SCALE; // $100.00 snapshot start price
    uint64 constant STANDARD = 24 hours;
    uint64 constant BLITZ = 1 hours;

    function setUp() public {
        // A realistic base time: Nov 2023, far before every window used here.
        vm.warp(1_700_000_000);

        tick = new TickToken(owner, 10_000_000 * 10 ** 18);

        MemeClashFactory impl = new MemeClashFactory();
        bytes memory initData = abi.encodeCall(
            MemeClashFactory.initialize, (owner, address(tick), treasury, resolver)
        );
        StockERC1967Proxy proxy = new StockERC1967Proxy(address(impl), initData);
        factory = MemeClashFactory(address(proxy));

        // Fund creator/alice/bob/carol and the resolver (the backend
        // signer, which also creates cup ties) and approve the factory.
        vm.startPrank(owner);
        tick.mint(creator, 100_000 * 10 ** 18);
        tick.mint(alice, 100_000 * 10 ** 18);
        tick.mint(bob, 100_000 * 10 ** 18);
        tick.mint(carol, 100_000 * 10 ** 18);
        tick.mint(resolver, 100_000 * 10 ** 18);
        vm.stopPrank();

        _approveAll(creator);
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);
        _approveAll(resolver);
    }

    // --- helpers ---

    function _approveAll(address user) internal {
        vm.prank(user);
        tick.approve(address(factory), type(uint256).max);
    }

    function _createVsStock(uint64 duration) internal returns (uint256) {
        vm.prank(creator);
        return factory.createClash(
            MEME_TOKEN, "BLUECHIP", OpponentKind.Stock, STOCK_TOKEN, "NVDAc", duration, false, "diego"
        );
    }

    function _createDerby(uint64 duration) internal returns (uint256) {
        vm.prank(creator);
        return factory.createClash(
            MEME_TOKEN, "BLUECHIP", OpponentKind.Meme, MEME_OPP_TOKEN, "REDPILL", duration, false, "diego"
        );
    }

    function _createCupTie(uint64 duration) internal returns (uint256) {
        vm.prank(creator);
        return factory.createClash(
            MEME_TOKEN, "BLUECHIP", OpponentKind.Stock, STOCK_TOKEN, "NVDAc", duration, true, "cup seeder"
        );
    }

    function _stake(address user, uint256 id, uint256 outcome, uint256 amount) internal {
        vm.prank(user);
        factory.stake(id, outcome, amount);
    }

    function _resolve(
        uint256 id,
        uint256 memeStart,
        uint256 memeEnd,
        uint256 oppStart,
        uint256 oppEnd
    ) internal {
        vm.prank(resolver);
        factory.resolve(id, memeStart, memeEnd, oppStart, oppEnd);
    }

    function _windowEnd(uint256 id) internal view returns (uint64 windowEnd) {
        (,,,,,,,,, windowEnd,,) = factory.clashInfo(id);
    }

    function _warpToEnd(uint256 id) internal {
        vm.warp(_windowEnd(id));
    }

    function _settlement(uint256 id)
        internal
        view
        returns (
            uint256 seedAmount,
            uint256 totalStaked,
            MemeClashFactory.ClashState state,
            uint256 winnerBitmap,
            uint256 payoutPerShare,
            uint256 memeStartPrice,
            uint256 memeEndPrice,
            uint256 oppStartPrice,
            uint256 oppEndPrice
        )
    {
        return factory.clashSettlement(id);
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
        require(factory.clashCount() == 0, "clash count not zero");
    }

    function test_CannotInitializeTwice() public {
        vm.expectRevert();
        factory.initialize(owner, address(tick), treasury, resolver);
    }

    function test_OwnerCanUpgrade() public {
        MemeClashFactoryV2Mock v2 = new MemeClashFactoryV2Mock();
        vm.prank(owner);
        factory.upgradeToAndCall(address(v2), bytes(""));
        require(MemeClashFactoryV2Mock(address(factory)).version() == 2, "upgrade did not take");
    }

    function test_NonOwnerCannotUpgrade() public {
        MemeClashFactoryV2Mock v2 = new MemeClashFactoryV2Mock();
        vm.prank(alice);
        vm.expectRevert();
        factory.upgradeToAndCall(address(v2), bytes(""));
    }

    // --- create: vs stock ---

    function test_CreateVsStockPullsSeedAndStoresTerms() public {
        uint256 id = _createVsStock(STANDARD);
        require(id == 0, "first clash id should be 0");
        require(factory.clashCount() == 1, "clash count wrong");
        require(
            tick.balanceOf(address(factory)) == MemeClashConstants.CREATION_SEED,
            "seed not pulled into the factory"
        );
        require(
            tick.balanceOf(creator) == 100_000 * 10 ** 18 - 250 * 10 ** 18,
            "seed not pulled from the creator"
        );

        (
            address memeToken,
            string memory memeSymbol,
            OpponentKind opponentKind,
            address opponentToken,
            string memory opponentSymbol,
            address mCreator,
            string memory creatorName,
            uint64 createdAt,
            uint64 windowStart,
            uint64 windowEnd,
            bool cupTie,
            uint8 outcomeCount
        ) = factory.clashInfo(id);
        require(memeToken == MEME_TOKEN, "wrong meme token");
        require(keccak256(bytes(memeSymbol)) == keccak256(bytes("BLUECHIP")), "wrong meme symbol");
        require(opponentKind == OpponentKind.Stock, "wrong opponent kind");
        require(opponentToken == STOCK_TOKEN, "wrong opponent token");
        require(keccak256(bytes(opponentSymbol)) == keccak256(bytes("NVDAc")), "wrong opponent symbol");
        require(mCreator == creator, "wrong creator");
        require(keccak256(bytes(creatorName)) == keccak256(bytes("diego")), "wrong creator name");
        require(createdAt == uint64(block.timestamp), "wrong createdAt");
        require(windowStart == createdAt + 1 hours, "window must start 1 hour after creation");
        require(windowEnd == windowStart + 24 hours, "standard window must run 24 hours");
        require(!cupTie, "open clash must not be a cup tie");
        require(outcomeCount == 2, "wrong outcome count");

        (uint256 seedAmount, uint256 totalStaked, MemeClashFactory.ClashState state,,,,,,) =
            _settlement(id);
        require(seedAmount == 250 * 10 ** 18, "seed not stored on the clash");
        require(totalStaked == 0, "total staked should start at zero");
        require(state == MemeClashFactory.ClashState.Open, "clash should be open");
    }

    function test_CreateDerbyStoresMemeOpponent() public {
        uint256 id = _createDerby(STANDARD);
        (, , OpponentKind opponentKind, address opponentToken, string memory opponentSymbol,,,,,,,) =
            factory.clashInfo(id);
        require(opponentKind == OpponentKind.Meme, "derby opponent kind should be Meme");
        require(opponentToken == MEME_OPP_TOKEN, "derby opponent token wrong");
        require(keccak256(bytes(opponentSymbol)) == keccak256(bytes("REDPILL")), "derby symbol wrong");
    }

    function test_CreateBlitzWindowTiming() public {
        uint256 id = _createVsStock(BLITZ);
        (,,,,,,,, uint64 windowStart, uint64 windowEnd,,) = factory.clashInfo(id);
        require(windowStart == uint64(block.timestamp) + 1 hours, "blitz windowStart must be +1h");
        require(windowEnd == windowStart + 1 hours, "blitz windowEnd must be +1h more");
    }

    function test_CreateRegistersActiveAndCreatedIndex() public {
        uint256 id = _createVsStock(STANDARD);
        (bool exists, uint256 activeId) = factory.activeClash(MEME_TOKEN, STOCK_TOKEN, STANDARD);
        require(exists && activeId == id, "active clash index missing");
        (bool wasCreated, uint256 createdId) = factory.createdClash(MEME_TOKEN, STOCK_TOKEN, STANDARD);
        require(wasCreated && createdId == id, "created clash index missing");
        (bool missing,) = factory.activeClash(MEME_TOKEN, MEME_OPP_TOKEN, STANDARD);
        require(!missing, "uncreated terms should not be active");
    }

    // --- create: validation ---

    function test_CreateRejectsInvalidWindowDuration() public {
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(MemeClashFactory.InvalidWindowDuration.selector, uint64(2 hours))
        );
        factory.createClash(
            MEME_TOKEN, "BLUECHIP", OpponentKind.Stock, STOCK_TOKEN, "NVDAc", 2 hours, false, "x"
        );

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(MemeClashFactory.InvalidWindowDuration.selector, uint64(0))
        );
        factory.createClash(MEME_TOKEN, "BLUECHIP", OpponentKind.Stock, STOCK_TOKEN, "NVDAc", 0, false, "x");

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(MemeClashFactory.InvalidWindowDuration.selector, uint64(48 hours))
        );
        factory.createClash(
            MEME_TOKEN, "BLUECHIP", OpponentKind.Stock, STOCK_TOKEN, "NVDAc", 48 hours, false, "x"
        );
    }

    function test_CreateRejectsSameToken() public {
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.SameToken.selector, MEME_TOKEN));
        factory.createClash(
            MEME_TOKEN, "BLUECHIP", OpponentKind.Meme, MEME_TOKEN, "BLUECHIP", STANDARD, false, "x"
        );
    }

    function test_CreateRejectsZeroTokens() public {
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.InvalidParams.selector));
        factory.createClash(
            address(0), "BLUECHIP", OpponentKind.Stock, STOCK_TOKEN, "NVDAc", STANDARD, false, "x"
        );
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.InvalidParams.selector));
        factory.createClash(
            MEME_TOKEN, "BLUECHIP", OpponentKind.Stock, address(0), "NVDAc", STANDARD, false, "x"
        );
    }

    function test_CreateRejectsEmptySymbols() public {
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.InvalidParams.selector));
        factory.createClash(MEME_TOKEN, "", OpponentKind.Stock, STOCK_TOKEN, "NVDAc", STANDARD, false, "x");
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.InvalidParams.selector));
        factory.createClash(MEME_TOKEN, "BLUECHIP", OpponentKind.Stock, STOCK_TOKEN, "", STANDARD, false, "x");
    }

    function test_CreateRejectsLongSymbols() public {
        vm.prank(creator);
        vm.expectRevert();
        factory.createClash(
            MEME_TOKEN, "THIS SYMBOL IS TOO LONG", OpponentKind.Stock, STOCK_TOKEN, "NVDAc", STANDARD, false, "x"
        );
        vm.prank(creator);
        vm.expectRevert();
        factory.createClash(
            MEME_TOKEN, "BLUECHIP", OpponentKind.Stock, STOCK_TOKEN, "THIS SYMBOL IS TOO LONG", STANDARD, false, "x"
        );
    }

    function test_CreateRejectsLongCreatorName() public {
        vm.prank(creator);
        vm.expectRevert();
        factory.createClash(
            MEME_TOKEN,
            "BLUECHIP",
            OpponentKind.Stock,
            STOCK_TOKEN,
            "NVDAc",
            STANDARD,
            false,
            "this name is definitely way too long for the limit"
        );
    }

    // --- create: duplicate guard ---

    function test_DuplicateActiveClashReverts() public {
        uint256 first = _createVsStock(STANDARD);
        bytes32 key = keccak256(abi.encode(MEME_TOKEN, STOCK_TOKEN, uint64(STANDARD)));
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MemeClashFactory.DuplicateOpenClash.selector, key, first)
        );
        factory.createClash(
            MEME_TOKEN, "BLUECHIP", OpponentKind.Stock, STOCK_TOKEN, "NVDAc", STANDARD, false, "clone"
        );
    }

    function test_DuplicateGuardKeyIncludesDuration() public {
        _createVsStock(STANDARD);
        uint256 blitz = _createVsStock(BLITZ);
        require(blitz == 1, "same pairing at blitz duration should be a distinct clash");
    }

    function test_DuplicateGuardKeyIncludesOpponent() public {
        _createVsStock(STANDARD);
        uint256 derby = _createDerby(STANDARD);
        require(derby == 1, "same meme against a different opponent should be distinct");
    }

    function test_CupTiesExemptFromDuplicateGuard() public {
        uint256 first = _createCupTie(STANDARD);
        uint256 second = _createCupTie(STANDARD);
        require(second == first + 1, "identical cup ties must coexist");
        require(factory.clashCount() == 2, "both cup ties should exist");

        // Cup ties are not indexed, so they never block the open catalogue.
        (bool exists,) = factory.activeClash(MEME_TOKEN, STOCK_TOKEN, STANDARD);
        require(!exists, "cup ties should not occupy the active index");
        uint256 open = _createVsStock(STANDARD);
        (bool nowExists, uint256 activeId) = factory.activeClash(MEME_TOKEN, STOCK_TOKEN, STANDARD);
        require(nowExists && activeId == open, "non-cup clash should register as active");
    }

    function test_CupTieDoesNotExemptOpenClashDuplicate() public {
        _createVsStock(STANDARD);
        // A cup tie with the same terms is fine while the open clash runs.
        uint256 cup = _createCupTie(STANDARD);
        require(cup == 1, "cup tie should coexist with the open clash");
        // But a second non-cup clash with the same terms still reverts.
        vm.prank(alice);
        vm.expectRevert();
        factory.createClash(
            MEME_TOKEN, "BLUECHIP", OpponentKind.Stock, STOCK_TOKEN, "NVDAc", STANDARD, false, "clone"
        );
    }

    function test_CreateSameTermsAfterResolveSucceeds() public {
        uint256 first = _createVsStock(STANDARD);
        _warpToEnd(first);
        _resolve(first, START, 110 * SCALE, START, 105 * SCALE);

        (bool exists,) = factory.activeClash(MEME_TOKEN, STOCK_TOKEN, STANDARD);
        require(!exists, "settled clash should leave the active index");
        (bool wasCreated, uint256 createdId) = factory.createdClash(MEME_TOKEN, STOCK_TOKEN, STANDARD);
        require(wasCreated && createdId == first, "created index should keep the settled clash");

        uint256 second = _createVsStock(STANDARD);
        require(second == first + 1, "same terms should clash again after settlement");
        (bool nowCreated, uint256 latestId) = factory.createdClash(MEME_TOKEN, STOCK_TOKEN, STANDARD);
        require(nowCreated && latestId == second, "created index should track the latest clash");
    }

    function test_CreateSameTermsAfterVoidSucceeds() public {
        uint256 first = _createVsStock(STANDARD);
        vm.prank(resolver);
        factory.voidClash(first);
        uint256 second = _createVsStock(STANDARD);
        require(second == first + 1, "same terms should clash again after a void");
    }

    // --- staking ---

    function test_StakeOnBothSides() public {
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18); // Yes
        _stake(bob, id, 1, 300 * 10 ** 18); // No

        require(factory.outcomeTotals(id, 0) == 100 * 10 ** 18, "Yes total wrong");
        require(factory.outcomeTotals(id, 1) == 300 * 10 ** 18, "No total wrong");
        require(factory.stakes(id, alice, 0) == 100 * 10 ** 18, "alice stake wrong");
        require(factory.stakes(id, bob, 1) == 300 * 10 ** 18, "bob stake wrong");
        (, uint256 totalStaked,,,,,,,) = _settlement(id);
        require(totalStaked == 400 * 10 ** 18, "total staked wrong");
        require(
            tick.balanceOf(address(factory)) == 250 * 10 ** 18 + 400 * 10 ** 18,
            "factory balance should be seed plus stakes"
        );
    }

    function test_StakeBelowMinimumReverts() public {
        uint256 id = _createVsStock(STANDARD);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeClashFactory.StakeTooLow.selector, 1 * 10 ** 18, MemeClashConstants.MIN_STAKE
            )
        );
        factory.stake(id, 0, 1 * 10 ** 18);
    }

    function test_StakeInvalidOutcomeReverts() public {
        uint256 id = _createVsStock(STANDARD);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.InvalidOutcome.selector, id, 2));
        factory.stake(id, 2, 100 * 10 ** 18);
    }

    function test_StakeRevertsAtAndAfterWindowStart() public {
        uint256 id = _createVsStock(BLITZ);
        (,,,,,,,, uint64 windowStart,,,) = factory.clashInfo(id);

        // One second before the window starts, staking is still open.
        vm.warp(windowStart - 1);
        _stake(alice, id, 0, 50 * 10 ** 18);

        // Exactly at windowStart, staking is closed.
        vm.warp(windowStart);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.BettingClosed.selector, id));
        factory.stake(id, 0, 50 * 10 ** 18);

        // After the window ends (still unresolved) it stays closed.
        vm.warp(windowStart + 2 hours);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.BettingClosed.selector, id));
        factory.stake(id, 0, 50 * 10 ** 18);
    }

    function test_StakeOnResolvedClashReverts() public {
        uint256 id = _createVsStock(BLITZ);
        _warpToEnd(id);
        _resolve(id, START, 110 * SCALE, START, 105 * SCALE);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.ClashNotOpen.selector, id));
        factory.stake(id, 0, 50 * 10 ** 18);
    }

    // --- resolution: outcomes ---

    function test_ResolveYesWinsOnStrictlyGreaterMove() public {
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18);

        _warpToEnd(id);
        _resolve(id, START, 110 * SCALE, START, 105 * SCALE); // meme +10 percent, stock +5 percent

        (,, MemeClashFactory.ClashState state, uint256 bitmap,, uint256 ms, uint256 me, uint256 os, uint256 oe) =
            _settlement(id);
        require(state == MemeClashFactory.ClashState.Resolved, "not resolved");
        require(bitmap == 1, "Yes (outcome 0) should win");
        require(ms == START && me == 110 * SCALE, "meme snapshots not stored");
        require(os == START && oe == 105 * SCALE, "opponent snapshots not stored");
    }

    function test_ResolveNoWinsWhenMemeMoveIsSmaller() public {
        uint256 id = _createVsStock(STANDARD);
        _stake(bob, id, 1, 100 * 10 ** 18);

        _warpToEnd(id);
        _resolve(id, START, 102 * SCALE, START, 108 * SCALE); // meme +2 percent, stock +8 percent

        (,, MemeClashFactory.ClashState state, uint256 bitmap,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Resolved, "not resolved");
        require(bitmap == 2, "No (outcome 1) should win");
    }

    function test_ResolveComparesPercentMovesNotAbsoluteMoves() public {
        // Meme falls 5 percent, opponent falls 2 percent: the meme moved
        // less (more negative), so No wins even though both fell.
        uint256 id = _createDerby(STANDARD);
        _stake(bob, id, 1, 100 * 10 ** 18);

        _warpToEnd(id);
        _resolve(id, START, 95 * SCALE, START, 98 * SCALE);

        (,, MemeClashFactory.ClashState state, uint256 bitmap,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Resolved, "not resolved");
        require(bitmap == 2, "No should win when memeMove is below oppMove");
    }

    function test_CupClashWithDecisiveMovesSettlesViaResolve() public {
        uint256 id = _createCupTie(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18);

        _warpToEnd(id);
        _resolve(id, START, 110 * SCALE, START, 105 * SCALE);

        (,, MemeClashFactory.ClashState state, uint256 bitmap,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Resolved, "cup clash not resolved");
        require(bitmap == 1, "Yes should win a decisive cup clash via resolve");
    }

    // --- resolution: exact ties ---

    function test_ExactTieOpenClashNoWins() public {
        // Same percent move from different start prices: the moves tie
        // exactly, and an open clash resolves No (Yes needed strictly more).
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18); // Yes
        _stake(bob, id, 1, 50 * 10 ** 18); // No

        _warpToEnd(id);
        _resolve(id, 200 * SCALE, 210 * SCALE, START, 105 * SCALE); // both +5 percent

        (,, MemeClashFactory.ClashState state, uint256 bitmap,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Resolved, "not resolved");
        require(bitmap == 2, "exact tie on an open clash must resolve No");

        // Bob (sole No staker) claims the whole distributable:
        // total 150, fees 4.5 + 3 + 1.5 = 9, distributable 150 - 9 + 250 = 391.
        uint256 bobBefore = tick.balanceOf(bob);
        vm.prank(bob);
        factory.claim(id);
        require(tick.balanceOf(bob) - bobBefore == 391 * 10 ** 18, "No winner payout wrong");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.NothingToClaim.selector, id, alice));
        factory.claim(id);
    }

    function test_CupTieResolveRevertsOnExactTie() public {
        uint256 id = _createCupTie(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18);

        _warpToEnd(id);
        vm.prank(resolver);
        vm.expectRevert(
            abi.encodeWithSelector(MemeClashFactory.CupTieRequiresExplicitWinner.selector, id)
        );
        factory.resolve(id, START, 105 * SCALE, START, 105 * SCALE); // both +5 percent

        // The revert leaves the clash open for resolveCupTie.
        (,, MemeClashFactory.ClashState state,,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Open, "cup tie should stay open after the revert");
    }

    function test_ResolveCupTieMemeWins() public {
        uint256 id = _createCupTie(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18); // Yes
        _stake(bob, id, 1, 100 * 10 ** 18); // No

        _warpToEnd(id);
        vm.prank(resolver);
        factory.resolveCupTie(id, START, 105 * SCALE, START, 105 * SCALE, true);

        (,, MemeClashFactory.ClashState state, uint256 bitmap,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Resolved, "cup tie not resolved");
        require(bitmap == 1, "memeWins true must settle Yes");

        // Total 200, fees 6 + 4 + 2 = 12, distributable 200 - 12 + 250 = 438.
        uint256 aliceBefore = tick.balanceOf(alice);
        vm.prank(alice);
        factory.claim(id);
        require(tick.balanceOf(alice) - aliceBefore == 438 * 10 ** 18, "cup winner payout wrong");
    }

    function test_ResolveCupTieOpponentWins() public {
        uint256 id = _createCupTie(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18); // Yes
        _stake(bob, id, 1, 100 * 10 ** 18); // No

        _warpToEnd(id);
        vm.prank(resolver);
        factory.resolveCupTie(id, START, 105 * SCALE, START, 105 * SCALE, false);

        (,, MemeClashFactory.ClashState state, uint256 bitmap,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Resolved, "cup tie not resolved");
        require(bitmap == 2, "memeWins false must settle No");

        uint256 bobBefore = tick.balanceOf(bob);
        vm.prank(bob);
        factory.claim(id);
        require(tick.balanceOf(bob) - bobBefore == 438 * 10 ** 18, "cup winner payout wrong");
    }

    function test_ResolveCupTieRevertsWhenMovesNotEqual() public {
        uint256 id = _createCupTie(STANDARD);
        _warpToEnd(id);
        vm.prank(resolver);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeClashFactory.MovesNotEqual.selector, id, int256(10_000_000), int256(5_000_000)
            )
        );
        factory.resolveCupTie(id, START, 110 * SCALE, START, 105 * SCALE, true);
    }

    function test_ResolveCupTieRevertsForNonCupClash() public {
        uint256 id = _createVsStock(STANDARD);
        _warpToEnd(id);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.NotCupTie.selector, id));
        factory.resolveCupTie(id, START, 105 * SCALE, START, 105 * SCALE, true);
    }

    function test_CupTieCreatedBySystemAccountWorksLikeAnyCreator() public {
        // The backend signer (the resolver address) seeds the cup bracket:
        // it creates the tie, pays the seed, and later settles the tiebreak.
        vm.prank(resolver);
        uint256 id = factory.createClash(
            MEME_TOKEN, "BLUECHIP", OpponentKind.Meme, MEME_OPP_TOKEN, "REDPILL", STANDARD, true, "tickr cup"
        );
        (,,,,, address mCreator,,,,,,) = factory.clashInfo(id);
        require(mCreator == resolver, "system account should be recorded as creator");

        _stake(alice, id, 0, 100 * 10 ** 18);
        _stake(bob, id, 1, 100 * 10 ** 18);

        _warpToEnd(id);
        vm.prank(resolver);
        factory.resolveCupTie(id, START, 103 * SCALE, START, 103 * SCALE, true);

        (,, MemeClashFactory.ClashState state, uint256 bitmap,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Resolved, "system cup tie not resolved");
        require(bitmap == 1, "system cup tie should settle Yes");
    }

    // --- resolution: spike breaker ---

    function test_BreakerVoidsOnMemeSpikeExactlyThirtyPercent() public {
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18);
        _stake(bob, id, 1, 50 * 10 ** 18);

        uint256 creatorBefore = tick.balanceOf(creator);
        _warpToEnd(id);
        _resolve(id, START, 130 * SCALE, START, 105 * SCALE); // meme exactly +30 percent

        (uint256 seedAmount,, MemeClashFactory.ClashState state,, uint256 pps, uint256 ms, uint256 me,,) =
            _settlement(id);
        require(state == MemeClashFactory.ClashState.Voided, "breaker should void the clash");
        require(seedAmount == 0, "seed should be cleared on a breaker void");
        require(pps == 0, "no payoutPerShare on a void");
        require(ms == START && me == 130 * SCALE, "breaker snapshots should be stored");
        require(
            tick.balanceOf(creator) - creatorBefore == 250 * 10 ** 18,
            "seed not returned to creator on breaker void"
        );
        require(tick.balanceOf(treasury) == 0, "no fee should be taken on a breaker void");
        require(tick.balanceOf(resolver) == 100_000 * 10 ** 18, "resolver should get no fee on a void");

        // Stakes refund 1:1 through claim().
        uint256 aliceBefore = tick.balanceOf(alice);
        vm.prank(alice);
        factory.claim(id);
        require(tick.balanceOf(alice) - aliceBefore == 100 * 10 ** 18, "alice refund wrong");
        uint256 bobBefore = tick.balanceOf(bob);
        vm.prank(bob);
        factory.claim(id);
        require(tick.balanceOf(bob) - bobBefore == 50 * 10 ** 18, "bob refund wrong");
        require(tick.balanceOf(address(factory)) == 0, "factory should be empty after refunds");
    }

    function test_BreakerVoidsOnMemeCrash() public {
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18);

        _warpToEnd(id);
        _resolve(id, START, 60 * SCALE, START, 105 * SCALE); // meme -40 percent

        (,, MemeClashFactory.ClashState state,,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Voided, "a 40 percent crash should void");
    }

    function test_BreakerVoidsOnOpponentSpike() public {
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18);

        _warpToEnd(id);
        _resolve(id, START, 110 * SCALE, START, 145 * SCALE); // opponent +45 percent

        (,, MemeClashFactory.ClashState state,,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Voided, "opponent spike should void");
    }

    function test_MoveJustBelowBreakerResolves() public {
        // 29.9 percent is below the breaker: the clash settles normally.
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18);

        _warpToEnd(id);
        _resolve(id, START, (100 * SCALE * 1299) / 1000, START, START); // meme +29.9 percent, opponent flat

        (,, MemeClashFactory.ClashState state, uint256 bitmap,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Resolved, "29.9 percent must not void");
        require(bitmap == 1, "Yes should win at +29.9 percent against flat");
    }

    function test_BreakerVoidsInsideResolveCupTie() public {
        uint256 id = _createCupTie(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18);

        uint256 creatorBefore = tick.balanceOf(creator);
        _warpToEnd(id);
        vm.prank(resolver);
        factory.resolveCupTie(id, START, 140 * SCALE, START, 140 * SCALE, true); // both +40 percent

        (,, MemeClashFactory.ClashState state,,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Voided, "breaker should void inside resolveCupTie");
        require(
            tick.balanceOf(creator) - creatorBefore == 250 * 10 ** 18,
            "seed not returned on cup breaker void"
        );
    }

    function test_BreakerBeatsCupTieRevertInResolve() public {
        // Both moves tied AND breached: resolve() voids instead of
        // reverting with CupTieRequiresExplicitWinner.
        uint256 id = _createCupTie(STANDARD);
        _warpToEnd(id);
        _resolve(id, START, 140 * SCALE, START, 140 * SCALE);

        (,, MemeClashFactory.ClashState state,,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Voided, "breaker should win over the tie revert");
    }

    // --- resolution: guards ---

    function test_ResolveBeforeWindowEndReverts() public {
        uint256 id = _createVsStock(STANDARD);
        (,,,,,,,, uint64 windowStart,,,) = factory.clashInfo(id);
        vm.warp(windowStart + 1 hours); // inside the window
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.NotResolvableYet.selector, id));
        factory.resolve(id, START, 110 * SCALE, START, 105 * SCALE);
    }

    function test_ResolveByNonResolverReverts() public {
        uint256 id = _createVsStock(STANDARD);
        _warpToEnd(id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.OnlyResolver.selector));
        factory.resolve(id, START, 110 * SCALE, START, 105 * SCALE);

        uint256 cupId = _createCupTie(STANDARD);
        _warpToEnd(cupId);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.OnlyResolver.selector));
        factory.resolveCupTie(cupId, START, 105 * SCALE, START, 105 * SCALE, true);
    }

    function test_ResolveZeroPriceReverts() public {
        uint256 id = _createVsStock(STANDARD);
        _warpToEnd(id);

        // Every one of the four snapshot prices must be non-zero.
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.InvalidPrice.selector));
        factory.resolve(id, 0, 110 * SCALE, START, 105 * SCALE);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.InvalidPrice.selector));
        factory.resolve(id, START, 0, START, 105 * SCALE);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.InvalidPrice.selector));
        factory.resolve(id, START, 110 * SCALE, 0, 105 * SCALE);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.InvalidPrice.selector));
        factory.resolve(id, START, 110 * SCALE, START, 0);

        // The reverts leave the clash open: a valid resolve still lands.
        _resolve(id, START, 110 * SCALE, START, 105 * SCALE);
        (,, MemeClashFactory.ClashState state,,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Resolved, "valid resolve should land after reverts");
    }

    function test_ResolveTwiceReverts() public {
        uint256 id = _createVsStock(STANDARD);
        _warpToEnd(id);
        _resolve(id, START, 110 * SCALE, START, 105 * SCALE);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.AlreadySettled.selector, id));
        factory.resolve(id, START, 110 * SCALE, START, 105 * SCALE);
    }

    // --- resolution: economics ---

    function test_FeeSplitExactlyThreeTwoOneAndSeedSubsidy() public {
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18); // Yes
        _stake(bob, id, 1, 300 * 10 ** 18); // No

        _warpToEnd(id);
        _resolve(id, START, 110 * SCALE, START, 105 * SCALE); // Yes wins

        // Fees on staked volume only (400): treasury 12 (3 percent),
        // creator 8 (2 percent), resolver 4 (1 percent). Seed pays no fee.
        require(tick.balanceOf(treasury) == 12 * 10 ** 18, "treasury fee wrong");
        require(
            tick.balanceOf(creator) == 100_000 * 10 ** 18 - 250 * 10 ** 18 + 8 * 10 ** 18,
            "creator fee wrong"
        );
        require(
            tick.balanceOf(resolver) == 100_000 * 10 ** 18 + 4 * 10 ** 18, "resolver fee wrong"
        );

        // Distributable = 400 - 24 + 250 (seed) = 626. Alice is the sole
        // winner, so she claims all 626.
        (,,,, uint256 pps,,,,) = _settlement(id);
        require(pps == 626 * 10 ** 18 / 100, "wrong payoutPerShare");
        uint256 aliceBefore = tick.balanceOf(alice);
        vm.prank(alice);
        factory.claim(id);
        require(tick.balanceOf(alice) - aliceBefore == 626 * 10 ** 18, "winner payout wrong");

        // Double claim reverts, and the loser has nothing to claim.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.AlreadyClaimed.selector, id, alice));
        factory.claim(id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.NothingToClaim.selector, id, bob));
        factory.claim(id);
    }

    function test_ClaimPaysWinnersProRataMinusFees() public {
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18); // Yes
        _stake(bob, id, 0, 300 * 10 ** 18); // Yes
        _stake(carol, id, 1, 100 * 10 ** 18); // No

        _warpToEnd(id);
        _resolve(id, START, 110 * SCALE, START, 105 * SCALE); // Yes wins

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
        uint256 id = _createVsStock(STANDARD);

        _warpToEnd(id);
        _resolve(id, START, 110 * SCALE, START, 105 * SCALE);

        require(tick.balanceOf(treasury) == 250 * 10 ** 18, "seed should go to treasury");
        (uint256 seedAmount,, MemeClashFactory.ClashState state, uint256 bitmap, uint256 pps,,,,) =
            _settlement(id);
        require(seedAmount == 0, "seed should be cleared");
        require(state == MemeClashFactory.ClashState.Resolved, "not resolved");
        require(bitmap == 1, "stored winner should still be Yes");
        require(pps == 0, "payoutPerShare should be zero with no stakes");
    }

    function test_TreasurySweepWhenWinningSideHasZeroStakers() public {
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 100 * 10 ** 18); // only Yes staked

        _warpToEnd(id);
        _resolve(id, START, 102 * SCALE, START, 108 * SCALE); // No wins, nobody staked No

        // The ENTIRE pool (100 staked + 250 seed) goes to treasury, no
        // separate fees are taken on this path, no refunds.
        require(tick.balanceOf(treasury) == 350 * 10 ** 18, "whole pool should sweep to treasury");
        require(
            tick.balanceOf(resolver) == 100_000 * 10 ** 18, "resolver should get no fee on a sweep"
        );
        require(tick.balanceOf(address(factory)) == 0, "factory should be empty after sweep");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.NothingToClaim.selector, id, alice));
        factory.claim(id);
    }

    // --- void ---

    function test_VoidClashRefundsStakesOneToOneAndReturnsSeed() public {
        // The missing price path: a side never gets a price, so the
        // resolver voids and every stake refunds 1:1.
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 50 * 10 ** 18);
        _stake(bob, id, 1, 30 * 10 ** 18);

        uint256 creatorBefore = tick.balanceOf(creator);
        vm.prank(resolver);
        factory.voidClash(id);

        (uint256 seedAmount,, MemeClashFactory.ClashState state,,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Voided, "not voided");
        require(seedAmount == 0, "seed should be cleared");
        require(
            tick.balanceOf(creator) - creatorBefore == 250 * 10 ** 18,
            "seed not returned to creator on void"
        );

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
        uint256 id = _createDerby(STANDARD);
        vm.prank(owner);
        factory.voidClash(id);
        (,, MemeClashFactory.ClashState state,,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Voided, "owner void failed");
    }

    function test_VoidByStrangerReverts() public {
        uint256 id = _createVsStock(STANDARD);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.OnlyResolverOrOwner.selector));
        factory.voidClash(id);
    }

    function test_VoidAfterResolveReverts() public {
        uint256 id = _createVsStock(STANDARD);
        _warpToEnd(id);
        _resolve(id, START, 110 * SCALE, START, 105 * SCALE);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.AlreadySettled.selector, id));
        factory.voidClash(id);
    }

    function test_StakeOnVoidedClashReverts() public {
        uint256 id = _createVsStock(STANDARD);
        vm.prank(resolver);
        factory.voidClash(id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.ClashNotOpen.selector, id));
        factory.stake(id, 0, 50 * 10 ** 18);
    }

    function test_ClaimOnOpenClashReverts() public {
        uint256 id = _createVsStock(STANDARD);
        _stake(alice, id, 0, 50 * 10 ** 18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.ClashNotOpen.selector, id));
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
        uint256 id = _createVsStock(STANDARD);
        address newResolver = address(0xEE501);
        vm.prank(owner);
        factory.setResolver(newResolver);
        require(factory.resolver() == newResolver, "resolver not rotated");

        _warpToEnd(id);
        // The old resolver can no longer resolve.
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(MemeClashFactory.OnlyResolver.selector));
        factory.resolve(id, START, 110 * SCALE, START, 105 * SCALE);
        // The new resolver can.
        vm.prank(newResolver);
        factory.resolve(id, START, 110 * SCALE, START, 105 * SCALE);
        (,, MemeClashFactory.ClashState state,,,,,,) = _settlement(id);
        require(state == MemeClashFactory.ClashState.Resolved, "new resolver could not resolve");
    }

    function test_SetTreasuryOk() public {
        address newTreasury = address(0x7EA52);
        vm.prank(owner);
        factory.setTreasury(newTreasury);
        require(factory.treasury() == newTreasury, "treasury not updated");
    }
}

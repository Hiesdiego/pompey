// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { TickToken } from "./TickToken.sol";
import { StockOutcome } from "./StockConstants.sol";
import { StockTeamRegistry } from "./StockTeamRegistry.sol";
import { StockMatchRegistry, StockFixture } from "./StockMatchRegistry.sol";
import { StockPriceOracle } from "./StockPriceOracle.sol";
import { StockResultEngine } from "./StockResultEngine.sol";
import { StockPredictionPool } from "./StockPredictionPool.sol";

/// @title StockLeagueTest - Foundry tests for the TICKR Stock League
///
/// @notice Run from packages/contracts with:
///   pnpm test:sol
/// or: forge test --match-contract StockLeagueTest
/// PLACEMENT: copy this file FLAT into packages/contracts/contracts/
/// next to the Stock*.sol files and TickToken.sol (imports below assume
/// that layout). If the stock contracts live in a stock/ subfolder,
/// adjust the "./TickToken.sol" import to "../TickToken.sol".
///
/// Coverage: banded scoring (revised 2026-11-27), no-negative
/// scorelines, no goal cap, 3% volatile cap with circuit breaker flag,
/// forfeit 3-0 with explicit flag, both-no-performance void with 1:1
/// refund, tiebreak fields (points, GD, GF), treasury sweep on zero
/// winning stakers, 7% fee parimutuel payout, and schedule shape
/// (22 rounds, 132 fixtures, 6 per round, double round-robin with a
/// mirrored second leg and a Dec 16 double-header finale).
contract StockLeagueTest is Test {
    TickToken tick;
    StockTeamRegistry teamRegistry;
    StockMatchRegistry matchRegistry;
    StockPriceOracle oracle;
    StockResultEngine engine;
    StockPredictionPool pool;

    address owner = address(0xA11CE);
    address backend = address(0xBACC);
    address treasury = address(0x7EA54);
    address alice = address(0xA1);
    address bob = address(0xB0B);
    address carol = address(0xCA5);

    uint256 constant SEASON_ID = 1;
    uint256 constant STAKE_100 = 100 * 10 ** 18;
    uint256 constant STAKE_300 = 300 * 10 ** 18;

    // 8-decimal NAV prices. $100.00 = 100 * 10**8.
    uint256 constant PRICE_100 = 100 * 10 ** 8;
    // 0.05% of $100 = $0.05 = 5_000_000 units (a 5 bps move).
    uint256 constant STEP_005PCT = 5_000_000;

    function setUp() public {
        vm.startPrank(owner);
        tick = new TickToken(owner, 1_000_000 * 10 ** 18);
        tick.mint(alice, 10_000 * 10 ** 18);
        tick.mint(bob, 10_000 * 10 ** 18);
        tick.mint(carol, 10_000 * 10 ** 18);

        string[] memory names = new string[](12);
        names[0] = "NVIDIA"; names[1] = "Apple"; names[2] = "Microsoft"; names[3] = "Amazon";
        names[4] = "Alphabet"; names[5] = "Meta"; names[6] = "Tesla"; names[7] = "Strategy";
        names[8] = "Circle"; names[9] = "Intel"; names[10] = "Sandisk"; names[11] = "SpaceX";
        string[] memory symbols = new string[](12);
        symbols[0] = "NVDAc"; symbols[1] = "AAPLc"; symbols[2] = "MSFTc"; symbols[3] = "AMZNc";
        symbols[4] = "GOOGLc"; symbols[5] = "METAc"; symbols[6] = "TSLAc"; symbols[7] = "MSTRc";
        symbols[8] = "CRCLc"; symbols[9] = "INTCc"; symbols[10] = "SNDKc"; symbols[11] = "SPCXc";
        address[] memory tokens = new address[](12);
        tokens[0] = 0xb20000000000000000000078ee7ce2fE4908108C;
        tokens[1] = 0xb200000000000000000000C2e324d24d7eEcd1fb;
        tokens[2] = 0xB200000000000000000000Ab99cFa739E253872B;
        tokens[3] = 0xb200000000000000000000d9192b6B456483C2E8;
        tokens[4] = 0xb2000000000000000000002D0BA3164cc74f58B7;
        tokens[5] = 0xb2000000000000000000008bC8786B856E61707C;
        tokens[6] = 0xb2000000000000000000001e800a7f5189430cD0;
        tokens[7] = 0xb2000000000000000000004884b426556b92883d;
        tokens[8] = 0xB20000000000000000000019f6E7C675b73C2e4D;
        tokens[9] = 0xB2000000000000000000004AFF16039bA04bdFBc;
        tokens[10] = 0xb200000000000000000000397293Cb8cda9a10c5;
        tokens[11] = 0xb2000000000000000000007b9fcbd005511aCBd5;


        address teamImpl = address(new StockTeamRegistry());
        teamRegistry = StockTeamRegistry(
            address(
                new ERC1967Proxy(
                    teamImpl, abi.encodeCall(StockTeamRegistry.initialize, (owner, names, symbols, tokens))
                )
            )
        );

        address matchImpl = address(new StockMatchRegistry());
        matchRegistry = StockMatchRegistry(
            address(
                new ERC1967Proxy(
                    matchImpl,
                    abi.encodeCall(
                        StockMatchRegistry.initialize, (owner, address(teamRegistry), backend, uint64(3600))
                    )
                )
            )
        );

        address oracleImpl = address(new StockPriceOracle());
        oracle = StockPriceOracle(
            address(
                new ERC1967Proxy(oracleImpl, abi.encodeCall(StockPriceOracle.initialize, (owner, backend)))
            )
        );

        address engineImpl = address(new StockResultEngine());
        engine = StockResultEngine(
            address(
                new ERC1967Proxy(engineImpl, abi.encodeCall(StockResultEngine.initialize, (owner, backend)))
            )
        );

        address poolImpl = address(new StockPredictionPool());
        pool = StockPredictionPool(
            address(
                new ERC1967Proxy(
                    poolImpl,
                    abi.encodeCall(
                        StockPredictionPool.initialize, (owner, address(tick), address(matchRegistry), treasury)
                    )
                )
            )
        );

        // One-time wiring.
        oracle.setResultEngine(address(engine));
        engine.setPriceOracle(address(oracle));
        engine.setPredictionPool(address(pool));
        engine.setMatchRegistry(address(matchRegistry));
        pool.setResultEngine(address(engine));
        matchRegistry.setResultEngine(address(engine));

        // Full schedule: 22 rounds in batches of 7, 7 and 8.
        matchRegistry.generateScheduleBatch(uint64(1795651200), uint64(86400), 0, 7);
        matchRegistry.generateScheduleBatch(uint64(1795651200), uint64(86400), 7, 7);
        matchRegistry.generateScheduleBatch(uint64(1795651200), uint64(86400), 14, 8);

        // Seed the fixtures the tests use (0, 1, 2): 250 TICK each.
        tick.approve(address(pool), 250 * 10 ** 18 * 3);
        pool.seedFixtures(SEASON_ID, 0, 3);
        vm.stopPrank();

        // Stakers approve the pool.
        vm.prank(alice);
        tick.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        tick.approve(address(pool), type(uint256).max);
        vm.prank(carol);
        tick.approve(address(pool), type(uint256).max);
    }

    // --- Helpers ---

    /// @dev Settles `fixtureId` by submitting start then end prices as the backend.
    function _settle(uint256 fixtureId, uint256 homeEnd, uint256 awayEnd) internal {
        vm.startPrank(backend);
        oracle.submitStartPrice(SEASON_ID, fixtureId, PRICE_100, PRICE_100);
        oracle.submitEndPrice(SEASON_ID, fixtureId, homeEnd, awayEnd);
        vm.stopPrank();
    }

    // --- Scoring ---

    function testScoringBandedScale() public {
        // Home +0.50% = 50 bps lands in the 2-goal band (25 to 74 bps),
        // away flat: 2-0, home wins.
        _settle(0, PRICE_100 + 50_000_000, PRICE_100);
        (uint32 points, int32 gd, uint32 gf) = engine.getTeamScore(SEASON_ID, 0);
        // Fixture 0 home team is team 0 in the circle method (arr[0] home, round 0 even).
        assertEq(points, 3);
        assertEq(gd, 2);
        assertEq(gf, 2);
    }

    function testFirstBandEdge() public {
        // Home +0.10% = 10 bps is the first band edge: 1 goal. Away flat: 1-0.
        _settle(0, PRICE_100 + 10_000_000, PRICE_100);
        (uint32 points,,) = engine.getTeamScore(SEASON_ID, 0);
        assertEq(points, 3);
    }

    function testBelowFirstBandIsZero() public {
        // Home +0.09% = 9 bps: below the 10 bps first band, 0 goals.
        // 0-0 draw, 1 point each.
        _settle(0, PRICE_100 + 9_000_000, PRICE_100);
        (uint32 homePoints,,) = engine.getTeamScore(SEASON_ID, 0);
        assertEq(homePoints, 1);
    }

    function testNoNegativeScoreline() public {
        // Home -0.50% (raw -2 goals), away +0.50% (raw +2 goals).
        // Normalized: G_home = 0 + 0 = 0, G_away = 2 + 2 = 4. 0-4, away wins.
        _settle(0, PRICE_100 - 50_000_000, PRICE_100 + 50_000_000);
        (uint32 homePoints, int32 homeGd,) = engine.getTeamScore(SEASON_ID, 0);
        assertEq(homePoints, 0);
        assertEq(homeGd, -4);
    }

    function testNoGoalCap() public {
        // Home +12.00% = 1200 bps: 6 goals at the 600 bps band plus one
        // per full extra 300 bps, so 8 goals. Nothing caps the count,
        // and 7 or 8 goal results stay reachable on extreme moves.
        _settle(0, PRICE_100 + 1_200_000_000, PRICE_100);
        (uint32 points, int32 gd, uint32 gf) = engine.getTeamScore(SEASON_ID, 0);
        assertEq(points, 3);
        assertEq(gd, 8);
        assertEq(gf, 8);
    }

    function testVolatileCapTripsCircuitBreaker() public {
        // Home +3.50% = 350 bps: above the 3% volatile cap, so the
        // circuit breaker flag trips for review. The move lands in the
        // 5-goal band (300 to 599 bps).
        _settle(0, PRICE_100 + 350_000_000, PRICE_100);
        uint256 gid = SEASON_ID * 1_000_000 + 0;
        assertTrue(oracle.volatileSpike(gid));
        (uint32 points, int32 gd,) = engine.getTeamScore(SEASON_ID, 0);
        assertEq(points, 3);
        assertEq(gd, 5);
    }

    function testPreviewScoreline() public view {
        // Below the first band: no goals.
        (int16 h, int16 a) = oracle.previewScoreline(5, 0);
        assertEq(h, 0);
        assertEq(a, 0);
        // First band edge: 10 bps scores 1.
        (h, a) = oracle.previewScoreline(10, 0);
        assertEq(h, 1);
        assertEq(a, 0);
        // A fall transfers goals to the opponent: -57 bps is raw -2.
        (h, a) = oracle.previewScoreline(-57, 0);
        assertEq(h, 0);
        assertEq(a, 2);
        // Season 1 Matchday 2, MSTR +1.68% vs MSFT +0.50%: 4-2. The old
        // linear scale recorded this match as a 10-10 draw.
        (h, a) = oracle.previewScoreline(168, 50);
        assertEq(h, 4);
        assertEq(a, 2);
        // Season 1 Matchday 2, SNDK +5.63% vs NVDA +0.12%: 5-1.
        (h, a) = oracle.previewScoreline(563, 12);
        assertEq(h, 5);
        assertEq(a, 1);
        // The tail is uncapped: 900 bps scores 7, 1200 bps scores 8.
        (h, a) = oracle.previewScoreline(900, 0);
        assertEq(h, 7);
        assertEq(a, 0);
        (h, a) = oracle.previewScoreline(1200, 0);
        assertEq(h, 8);
        assertEq(a, 0);
    }

    // --- Forfeit and void ---

    function testForfeitThreeNilWithFlag() public {
        // Fixture 1: read the pairing, forfeit the away team.
        (uint16 homeId, uint16 awayId) = _fixtureTeams(1);
        vm.prank(backend);
        engine.recordForfeit(SEASON_ID, 1, awayId);
        uint256 gid = SEASON_ID * 1_000_000 + 1;
        assertTrue(engine.resultForfeit(gid));
        (uint32 homePoints, int32 homeGd, uint32 homeGf) = engine.getTeamScore(SEASON_ID, homeId);
        assertEq(homePoints, 3);
        assertEq(homeGd, 3);
        assertEq(homeGf, 3);
        (uint32 awayPoints, int32 awayGd,) = engine.getTeamScore(SEASON_ID, awayId);
        assertEq(awayPoints, 0);
        assertEq(awayGd, -3);
        // The forfeit flag is what distinguishes this from a normal 3-0:
        // a fixture settled on the pitch has resultForfeit false.
        _settle(0, PRICE_100 + 10 * STEP_005PCT, PRICE_100);
        assertFalse(engine.resultForfeit(SEASON_ID * 1_000_000 + 0));
    }

    function testForfeitSettlesPool() public {
        (uint16 homeId, uint16 awayId) = _fixtureTeams(1);
        vm.prank(alice);
        pool.stake(SEASON_ID, 1, StockOutcome.WinHome, STAKE_100);
        uint256 aliceBefore = tick.balanceOf(alice);
        vm.prank(backend);
        engine.recordForfeit(SEASON_ID, 1, awayId);
        assertTrue(engine.resultForfeit(SEASON_ID * 1_000_000 + 1));
        (uint32 homePoints,,) = engine.getTeamScore(SEASON_ID, homeId);
        assertEq(homePoints, 3);
        vm.prank(alice);
        pool.claim(SEASON_ID, 1);
        // Total pool 100 + 250 seed = 350, fee 7%: 325.5 distributable,
        // alice is the only home staker, so she takes it all.
        assertEq(tick.balanceOf(alice), aliceBefore + 325_500_000_000_000_000_000);
    }

    function testVoidBothMissingRefundsOneToOne() public {
        (uint16 homeId, uint16 awayId) = _fixtureTeams(2);
        vm.prank(alice);
        pool.stake(SEASON_ID, 2, StockOutcome.WinHome, STAKE_100);
        uint256 aliceBefore = tick.balanceOf(alice);
        vm.prank(backend);
        engine.recordVoid(SEASON_ID, 2);
        assertTrue(engine.resultVoided(SEASON_ID * 1_000_000 + 2));
        // No table change at all.
        (uint32 homePoints,,) = engine.getTeamScore(SEASON_ID, homeId);
        (uint32 awayPoints,,) = engine.getTeamScore(SEASON_ID, awayId);
        assertEq(homePoints, 0);
        assertEq(awayPoints, 0);
        StockResultEngine.TeamRecord memory rec = engine.getTeamRecord(SEASON_ID, homeId);
        assertEq(rec.played, 0);
        // Full 1:1 refund, no fee.
        vm.prank(alice);
        pool.claim(SEASON_ID, 2);
        assertEq(tick.balanceOf(alice), aliceBefore + STAKE_100);
    }

    // --- Tiebreak ---

    function testTiebreakPointsThenGdThenGf() public {
        // Team 0 wins fixture 0 by 2-0 (+0.50%, the 2-goal band):
        // 3 pts, GD +2, GF 2.
        _settle(0, PRICE_100 + 10 * STEP_005PCT, PRICE_100);
        // Fixture 1: forfeit the away team, home team wins 3-0.
        (uint16 homeId, uint16 awayId1) = _fixtureTeams(1);
        vm.prank(backend);
        engine.recordForfeit(SEASON_ID, 1, awayId1);
        // Both home teams sit on 3 points; the 3-0 winner leads on GD.
        (uint32 p0, int32 gd0, uint32 gf0) = engine.getTeamScore(SEASON_ID, 0);
        (uint32 p1, int32 gd1, uint32 gf1) = engine.getTeamScore(SEASON_ID, homeId);
        assertEq(p0, 3);
        assertEq(p1, 3);
        assertGt(gd1, gd0);
        assertGt(gf1, gf0);
        // And the loser of fixture 0 has 0 points and GD -2.
        (uint16 home0, uint16 away0) = _fixtureTeams(0);
        assertEq(home0, 0); // circle method, round 0: team 0 is home in fixture 0
        (, int32 gdLoser,) = engine.getTeamScore(SEASON_ID, away0);
        assertEq(gdLoser, -2);
    }

    // --- Pool economics ---

    function testTreasurySweepWhenNoWinningStakers() public {
        vm.prank(alice);
        pool.stake(SEASON_ID, 0, StockOutcome.WinHome, STAKE_100);
        uint256 treasuryBefore = tick.balanceOf(treasury);
        // Away wins 2-0: nobody staked WinAway, entire pool sweeps.
        _settle(0, PRICE_100, PRICE_100 + 10 * STEP_005PCT);
        // Pool was 100 staked + 250 seed = 350 TICK, all to treasury.
        assertEq(tick.balanceOf(treasury), treasuryBefore + 350 * 10 ** 18);
        // Alice's claim pays nothing (pool already swept).
        vm.prank(alice);
        pool.claim(SEASON_ID, 0);
        assertEq(tick.balanceOf(alice), 10_000 * 10 ** 18 - STAKE_100);
    }

    function testFeeAndParimutuelPayout() public {
        vm.prank(alice);
        pool.stake(SEASON_ID, 0, StockOutcome.WinHome, STAKE_100);
        vm.prank(bob);
        pool.stake(SEASON_ID, 0, StockOutcome.WinHome, STAKE_300);
        vm.prank(carol);
        pool.stake(SEASON_ID, 0, StockOutcome.WinAway, STAKE_100);
        // Home wins 2-0. Total pool = 100 + 300 + 100 + 250 seed = 750.
        // Distributable after 7% fee = 697.5. Winning pool = 400.
        // Alice: 100/400 * 697.5 = 174.375 TICK. Bob: 523.125 TICK.
        _settle(0, PRICE_100 + 10 * STEP_005PCT, PRICE_100);
        vm.prank(alice);
        pool.claim(SEASON_ID, 0);
        assertEq(tick.balanceOf(alice), 10_000 * 10 ** 18 - STAKE_100 + 174_375_000_000_000_000_000);
        vm.prank(bob);
        pool.claim(SEASON_ID, 0);
        assertEq(tick.balanceOf(bob), 10_000 * 10 ** 18 - STAKE_300 + 523_125_000_000_000_000_000);
        // Carol staked the loser: nothing.
        vm.prank(carol);
        pool.claim(SEASON_ID, 0);
        assertEq(tick.balanceOf(carol), 10_000 * 10 ** 18 - STAKE_100);
    }

    // --- Schedule shape ---

    function testScheduleShape() public view {
        assertEq(matchRegistry.fixtureCount(), 132);
        assertTrue(matchRegistry.scheduleGenerated());
        assertEq(matchRegistry.getFixturesByMatchday(0).length, 6);
        assertEq(matchRegistry.getFixturesByMatchday(20).length, 6);
        assertEq(matchRegistry.getFixturesByMatchday(21).length, 6);
        // Matchday 21 window opens Dec 16 2026 00:00 UTC: the double-header
        // finale shares the Dec 16 window with matchday 20, it does NOT
        // open Dec 17.
        StockFixture memory f131 = matchRegistry.getFixture(131);
        assertEq(f131.windowStart, uint64(1795651200) + 20 * 86400);
        assertEq(f131.windowEnd, uint64(1795651200) + 21 * 86400);
        // Season is complete only after all 132 finalize.
        assertFalse(engine.isSeasonComplete(SEASON_ID));
    }

    function testMirrorLegSwapsHomeAndAway() public view {
        // Fixture f (first leg, rounds 0-10) and fixture f + 66 (second
        // leg, rounds 11-21) are the same pairing with home and away
        // swapped, so every pairing is played once at each home.
        for (uint256 f = 0; f < 66; f++) {
            (uint16 h0, uint16 a0) = _fixtureTeams(f);
            (uint16 h1, uint16 a1) = _fixtureTeams(f + 66);
            assertEq(h1, a0);
            assertEq(a1, h0);
        }
    }

    function testDoubleHeaderFinaleSharesDec16Window() public view {
        // Rounds 21 and 22 (matchdayIndex 20 and 21) share the Dec 16
        // window: 12 fixtures that day, in two waves.
        StockFixture memory f120 = matchRegistry.getFixture(120);
        StockFixture memory f126 = matchRegistry.getFixture(126);
        assertEq(f120.windowStart, f126.windowStart);
        assertEq(f120.windowStart, uint64(1795651200) + 20 * 86400);
        assertEq(uint256(f120.matchdayIndex), 20);
        assertEq(uint256(f126.matchdayIndex), 21);
        assertEq(
            matchRegistry.getFixturesByMatchday(20).length
                + matchRegistry.getFixturesByMatchday(21).length,
            12
        );
    }

    function testEachTeamPlays22MatchesElevenHomeElevenAway() public view {
        // Every team plays 22 matches: 11 at home, 11 away.
        for (uint16 t = 0; t < 12; t++) {
            uint256 homeCount;
            uint256 awayCount;
            for (uint256 f = 0; f < 132; f++) {
                (uint16 h, uint16 a) = _fixtureTeams(f);
                if (h == t) homeCount++;
                if (a == t) awayCount++;
            }
            assertEq(homeCount, 11);
            assertEq(awayCount, 11);
        }
    }

    function testEachTeamPlaysOncePerMatchday() public view {
        // Matchday 0: 12 distinct teams across 6 fixtures.
        uint256[] memory ids = matchRegistry.getFixturesByMatchday(0);
        bool[] memory seen = new bool[](12);
        for (uint256 i = 0; i < ids.length; i++) {
            (uint16 h, uint16 a) = _fixtureTeams(ids[i]);
            assertFalse(seen[h]);
            assertFalse(seen[a]);
            seen[h] = true;
            seen[a] = true;
        }
    }

    function testCannotReinitializeProxy() public {
        string[] memory n = new string[](12);
        string[] memory s = new string[](12);
        address[] memory t = new address[](12);
        vm.prank(owner);
        vm.expectRevert();
        teamRegistry.initialize(owner, n, s, t);
    }

    // --- Internal helpers ---

    function _fixtureTeams(uint256 fixtureId) internal view returns (uint16 homeId, uint16 awayId) {
        StockFixture memory f = matchRegistry.getFixture(fixtureId);
        homeId = f.homeTeamId;
        awayId = f.awayTeamId;
    }

}

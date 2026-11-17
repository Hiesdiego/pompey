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
/// Coverage: scoring at 0.05% per goal, half-up rounding, no-negative
/// scorelines, 10-goal cap, 3% volatile cap with circuit breaker flag,
/// forfeit 3-0 with explicit flag, both-no-performance void with 1:1
/// refund, tiebreak fields (points, GD, GF), treasury sweep on zero
/// winning stakers, 7% fee parimutuel payout, and schedule shape
/// (21 matchdays, 231 fixtures, 11 per matchday).
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
    // 0.05% of $100 = $0.05 = 5_000_000 units (1 goal at 5 bps).
    uint256 constant STEP_005PCT = 5_000_000;

    function setUp() public {
        vm.startPrank(owner);
        tick = new TickToken(owner, 1_000_000 * 10 ** 18);
        tick.mint(alice, 10_000 * 10 ** 18);
        tick.mint(bob, 10_000 * 10 ** 18);
        tick.mint(carol, 10_000 * 10 ** 18);

        string[] memory names = new string[](22);
        names[0] = "NVIDIA"; names[1] = "Apple"; names[2] = "Microsoft"; names[3] = "Amazon";
        names[4] = "Alphabet"; names[5] = "Meta"; names[6] = "Tesla"; names[7] = "AMD";
        names[8] = "Netflix"; names[9] = "Broadcom"; names[10] = "Palantir"; names[11] = "Strategy";
        names[12] = "Oracle"; names[13] = "Salesforce"; names[14] = "JPMorgan"; names[15] = "Visa";
        names[16] = "Eli Lilly"; names[17] = "Disney"; names[18] = "Robinhood"; names[19] = "Circle";
        names[20] = "GameStop"; names[21] = "AMC";
        string[] memory symbols = new string[](22);
        symbols[0] = "NVDAc"; symbols[1] = "AAPLc"; symbols[2] = "MSFTc"; symbols[3] = "AMZNc";
        symbols[4] = "GOOGLc"; symbols[5] = "METAc"; symbols[6] = "TSLAc"; symbols[7] = "AMDc";
        symbols[8] = "NFLXc"; symbols[9] = "AVGOc"; symbols[10] = "PLTRc"; symbols[11] = "MSTRc";
        symbols[12] = "ORCLc"; symbols[13] = "CRMc"; symbols[14] = "JPMc"; symbols[15] = "Vc";
        symbols[16] = "LLYc"; symbols[17] = "DISc"; symbols[18] = "HOODc"; symbols[19] = "CRCLc";
        symbols[20] = "GMEc"; symbols[21] = "AMCc";
        address[] memory tokens = new address[](22);
        tokens[0] = 0xb20000000000000000000078ee7ce2fE4908108C;
        tokens[1] = 0xb200000000000000000000C2e324d24d7eEcd1fb;
        tokens[2] = 0xB200000000000000000000Ab99cFa739E253872B;
        tokens[3] = 0xb200000000000000000000d9192b6B456483C2E8;
        tokens[4] = 0xb2000000000000000000002D0BA3164cc74f58B7;
        tokens[5] = 0xb2000000000000000000008bC8786B856E61707C;
        tokens[6] = 0xb2000000000000000000001e800a7f5189430cD0;
        tokens[7] = 0xB2000000000000000000000d8Ce462E99ee7A47B;
        tokens[8] = 0xb20000000000000000000058B8c947e44011dFE6;
        tokens[9] = 0xB200000000000000000000Fc737aeA6196aB5a4c;
        tokens[10] = 0xb2000000000000000000007d16372840dF4dAbbe;
        tokens[11] = 0xb2000000000000000000004884b426556b92883d;
        tokens[12] = 0xb200000000000000000000347AFbA223D7B6b63C;
        tokens[13] = 0xB2000000000000000000006432a3a7991e718DBB;
        tokens[14] = 0xB200000000000000000000FDe956536A25725156;
        tokens[15] = 0xB20000000000000000000054b11Fd279a4f7D4EF;
        tokens[16] = 0xB200000000000000000000f1a0F91e34892E4718;
        tokens[17] = 0xb2000000000000000000000bD75bF439A38bF7DF;
        tokens[18] = 0xb2000000000000000000006F944897540579D3f2;
        tokens[19] = 0xB20000000000000000000019f6E7C675b73C2e4D;
        tokens[20] = 0xb2000000000000000000007790ed6E48e06eD935;
        tokens[21] = 0xB200000000000000000000CD7e6b8042cb7c2BB5;

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

        // Full schedule: 21 matchdays in batches of 7.
        matchRegistry.generateScheduleBatch(uint64(1795651200), uint64(86400), 0, 7);
        matchRegistry.generateScheduleBatch(uint64(1795651200), uint64(86400), 7, 7);
        matchRegistry.generateScheduleBatch(uint64(1795651200), uint64(86400), 14, 7);

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

    function testScoringOneGoalPer005Pct() public {
        // Home +0.05% (1 goal), away flat (0 goals): 1-0, home wins.
        _settle(0, PRICE_100 + STEP_005PCT, PRICE_100);
        (uint32 points, int32 gd, uint32 gf) = engine.getTeamScore(SEASON_ID, 0);
        // Fixture 0 home team is team 0 in the circle method (arr[0] home, round 0 even).
        assertEq(points, 3);
        assertEq(gd, 1);
        assertEq(gf, 1);
    }

    function testHalfUpRounding() public {
        // Home +0.03% = 3 bps: (3 + 2) / 5 = 1 goal. Away flat: 1-0.
        _settle(0, PRICE_100 + 3_000_000, PRICE_100);
        (uint32 points,,) = engine.getTeamScore(SEASON_ID, 0);
        assertEq(points, 3);
    }

    function testBelowHalfGoalIsZero() public {
        // Home +0.02% = 2 bps: (2 + 2) / 5 = 0 goals. 0-0 draw, 1 point each.
        _settle(0, PRICE_100 + 2_000_000, PRICE_100);
        (uint32 homePoints,,) = engine.getTeamScore(SEASON_ID, 0);
        assertEq(homePoints, 1);
    }

    function testNoNegativeScoreline() public {
        // Home -0.05% (raw -1 goal), away +0.05% (raw +1 goal).
        // Normalized: G_home = 0 + 0 = 0, G_away = 1 + 1 = 2. 0-2, away wins.
        _settle(0, PRICE_100 - STEP_005PCT, PRICE_100 + STEP_005PCT);
        (uint32 homePoints, int32 homeGd,) = engine.getTeamScore(SEASON_ID, 0);
        assertEq(homePoints, 0);
        assertEq(homeGd, -2);
    }

    function testTenGoalCap() public {
        // Home +1.00% = 100 bps = 20 goals raw, capped at 10. 10-0.
        _settle(0, PRICE_100 + 100_000_000, PRICE_100);
        (uint32 points, int32 gd, uint32 gf) = engine.getTeamScore(SEASON_ID, 0);
        assertEq(points, 3);
        assertEq(gd, 10);
        assertEq(gf, 10);
    }

    function testVolatileCapTripsCircuitBreaker() public {
        // Home +3.50% = 350 bps: above the 3% cap. Goals capped at 10 and
        // the circuit breaker flag trips for review.
        _settle(0, PRICE_100 + 350_000_000, PRICE_100);
        uint256 gid = SEASON_ID * 1_000_000 + 0;
        assertTrue(oracle.volatileSpike(gid));
        (uint32 points, int32 gd,) = engine.getTeamScore(SEASON_ID, 0);
        assertEq(points, 3);
        assertEq(gd, 10);
    }

    function testPreviewScoreline() public view {
        (int16 h, int16 a) = oracle.previewScoreline(5, 0);
        assertEq(h, 1);
        assertEq(a, 0);
        (h, a) = oracle.previewScoreline(-5, 5);
        assertEq(h, 0);
        assertEq(a, 2);
        (h, a) = oracle.previewScoreline(100, 0);
        assertEq(h, 10);
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
        _settle(0, PRICE_100 + STEP_005PCT, PRICE_100);
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
        // Team 0 wins fixture 0 by 2-0: 3 pts, GD +2, GF 2.
        _settle(0, PRICE_100 + 2 * STEP_005PCT, PRICE_100);
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
        // Away wins 1-0: nobody staked WinAway, entire pool sweeps.
        _settle(0, PRICE_100, PRICE_100 + STEP_005PCT);
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
        // Home wins 1-0. Total pool = 100 + 300 + 100 + 250 seed = 750.
        // Distributable after 7% fee = 697.5. Winning pool = 400.
        // Alice: 100/400 * 697.5 = 174.375 TICK. Bob: 523.125 TICK.
        _settle(0, PRICE_100 + STEP_005PCT, PRICE_100);
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
        assertEq(matchRegistry.fixtureCount(), 231);
        assertTrue(matchRegistry.scheduleGenerated());
        assertEq(matchRegistry.getFixturesByMatchday(0).length, 11);
        assertEq(matchRegistry.getFixturesByMatchday(20).length, 11);
        // Matchday 20 window opens Dec 16 2026 00:00 UTC.
        StockFixture memory f230 = matchRegistry.getFixture(230);
        assertEq(f230.windowStart, uint64(1795651200) + 20 * 86400);
        assertEq(f230.windowEnd, uint64(1795651200) + 21 * 86400);
        // Season is complete only after all 231 finalize.
        assertFalse(engine.isSeasonComplete(SEASON_ID));
    }

    function testEachTeamPlaysOncePerMatchday() public view {
        // Matchday 0: 22 distinct teams across 11 fixtures.
        uint256[] memory ids = matchRegistry.getFixturesByMatchday(0);
        bool[] memory seen = new bool[](22);
        for (uint256 i = 0; i < ids.length; i++) {
            (uint16 h, uint16 a) = _fixtureTeams(ids[i]);
            assertFalse(seen[h]);
            assertFalse(seen[a]);
            seen[h] = true;
            seen[a] = true;
        }
    }

    function testCannotReinitializeProxy() public {
        string[] memory n = new string[](22);
        string[] memory s = new string[](22);
        address[] memory t = new address[](22);
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

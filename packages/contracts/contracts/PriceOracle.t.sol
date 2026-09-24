// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { PriceOracle } from "./PriceOracle.sol";
import { Outcome } from "./interfaces/ITickr.sol";

/// @dev Minimal mock ResultEngine — just records the last recorded result so
/// tests can assert PriceOracle computed the right outcome/rounding.
contract MockResultEngine {
    uint256 public lastSeasonId;
    uint256 public lastFixtureId;
    Outcome public lastOutcome;
    int16 public lastHomePct;
    int16 public lastAwayPct;
    uint256 public callCount;

    function recordResult(uint256 seasonId, uint256 fixtureId, Outcome outcome, int16 homePct, int16 awayPct) external {
        lastSeasonId = seasonId;
        lastFixtureId = fixtureId;
        lastOutcome = outcome;
        lastHomePct = homePct;
        lastAwayPct = awayPct;
        callCount += 1;
    }
}

contract PriceOracleTest is Test {
    PriceOracle oracle;
    MockResultEngine resultEngine;

    address owner = address(0xA11CE);
    address backend = address(0xBACC);

    uint256 constant SEASON_ID = 1;
    uint256 constant FIXTURE_ID = 0;
    uint8 constant DEC = 8;
    uint256 constant ONE = 10 ** DEC;

    function setUp() public {
        vm.startPrank(owner);
        oracle = new PriceOracle(owner, backend);
        resultEngine = new MockResultEngine();
        oracle.setResultEngine(address(resultEngine));
        vm.stopPrank();
    }

    /// @notice Home coin +5.2% (rounds to +5), Away coin +2.4% (rounds to
    /// +2). Home should win with rounded scores 5 vs 2.
    function test_HomeWinsOnHigherRoundedPercent() public {
        vm.prank(backend);
        oracle.submitStartPrice(SEASON_ID, FIXTURE_ID, 100 * ONE, 100 * ONE);

        vm.prank(backend);
        oracle.submitEndPrice(SEASON_ID, FIXTURE_ID, 1052 * ONE / 10, 1024 * ONE / 10); // +5.2%, +2.4%

        require(resultEngine.lastOutcome() == Outcome.WinHome, "expected home win");
        require(resultEngine.lastHomePct() == 5, "expected home rounded to +5");
        require(resultEngine.lastAwayPct() == 2, "expected away rounded to +2");
    }

    /// @notice Equal rounded percentages (even from different raw values)
    /// must be a draw. Home +3.4% rounds to +3, Away +3.49% also rounds to +3.
    function test_EqualRoundedPercentIsDraw() public {
        vm.prank(backend);
        oracle.submitStartPrice(SEASON_ID, FIXTURE_ID, 100 * ONE, 100 * ONE);

        vm.prank(backend);
        oracle.submitEndPrice(SEASON_ID, FIXTURE_ID, 1034 * ONE / 10, 10349 * ONE / 1000); // +3.4%, +3.49%

        require(resultEngine.lastOutcome() == Outcome.Draw, "expected draw on equal rounded pct");
        require(resultEngine.lastHomePct() == 3, "home should round to +3");
        require(resultEngine.lastAwayPct() == 3, "away should round to +3");
    }

    /// @notice Negative price changes (a coin dropping) must round correctly
    /// too — Home -5.6% rounds to -6, Away -1.2% rounds to -1, Away wins
    /// (loses less).
    function test_AwayWinsWhenBothNegativeButAwayLostLess() public {
        vm.prank(backend);
        oracle.submitStartPrice(SEASON_ID, FIXTURE_ID, 100 * ONE, 100 * ONE);

        vm.prank(backend);
        oracle.submitEndPrice(SEASON_ID, FIXTURE_ID, 944 * ONE / 10, 988 * ONE / 10); // -5.6%, -1.2%

        require(resultEngine.lastOutcome() == Outcome.WinAway, "expected away win (lost less)");
        require(resultEngine.lastHomePct() == -6, "home should round to -6");
        require(resultEngine.lastAwayPct() == -1, "away should round to -1");
    }

    /// @notice Round-half-up boundary check: exactly +0.5% must round up to
    /// +1, not down to 0 or via banker's rounding.
    function test_RoundHalfUpAtExactBoundary() public {
        vm.prank(backend);
        oracle.submitStartPrice(SEASON_ID, FIXTURE_ID, 1000 * ONE, 1000 * ONE);

        vm.prank(backend);
        // +0.5% exactly on home, +0% on away
        oracle.submitEndPrice(SEASON_ID, FIXTURE_ID, 1005 * ONE, 1000 * ONE);

        require(resultEngine.lastHomePct() == 1, "exact +0.5% should round up to +1");
        require(resultEngine.lastAwayPct() == 0, "no change should round to 0");
    }

    function test_CannotSubmitEndPriceBeforeStartPrice() public {
        vm.prank(backend);
        vm.expectRevert();
        oracle.submitEndPrice(SEASON_ID, FIXTURE_ID, 100 * ONE, 100 * ONE);
    }

    function test_OnlyBackendCanSubmitPrices() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        oracle.submitStartPrice(SEASON_ID, FIXTURE_ID, 100 * ONE, 100 * ONE);
    }

    function test_CannotSubmitStartPriceTwice() public {
        vm.startPrank(backend);
        oracle.submitStartPrice(SEASON_ID, FIXTURE_ID, 100 * ONE, 100 * ONE);

        vm.expectRevert();
        oracle.submitStartPrice(SEASON_ID, FIXTURE_ID, 100 * ONE, 100 * ONE);
        vm.stopPrank();
    }
}

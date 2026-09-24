// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { TeamRegistry } from "./TeamRegistry.sol";
import { MatchRegistry } from "./MatchRegistry.sol";
import { Fixture } from "./interfaces/ITickr.sol";

contract MatchRegistryScheduleTest is Test {
    TeamRegistry teamRegistry;
    MatchRegistry matchRegistry;

    address owner = address(0xA11CE);
    address backend = address(0xBACC);

    uint16 constant TEAM_COUNT = 20;
    uint256 constant EXPECTED_FIXTURES = 380;
    uint8 constant EXPECTED_MATCHDAYS = 38;
    uint16 constant MATCHES_PER_MATCHDAY = 10;

    function setUp() public {
        string[] memory names = new string[](TEAM_COUNT);
        string[] memory symbols = new string[](TEAM_COUNT);
        for (uint16 i = 0; i < TEAM_COUNT; i++) {
            names[i] = string(abi.encodePacked("Team", vm.toString(i)));
            symbols[i] = string(abi.encodePacked("T", vm.toString(i)));
        }

        vm.startPrank(owner);
        teamRegistry = new TeamRegistry(owner, names, symbols);
        matchRegistry = new MatchRegistry(owner, address(teamRegistry), backend);
        vm.stopPrank();
    }

    function test_GeneratesExactly380Fixtures() public {
        vm.prank(owner);
        matchRegistry.generateSchedule(uint64(block.timestamp + 1 days), 7 days);

        require(matchRegistry.fixtureCount() == EXPECTED_FIXTURES, "wrong total fixture count");
    }

    function test_GeneratesExactly38Matchdays() public {
        vm.prank(owner);
        matchRegistry.generateSchedule(uint64(block.timestamp + 1 days), 7 days);

        for (uint8 md = 0; md < EXPECTED_MATCHDAYS; md++) {
            uint256[] memory ids = matchRegistry.getFixturesByMatchday(md);
            require(ids.length == MATCHES_PER_MATCHDAY, "matchday does not have 10 fixtures");
        }
    }

    function test_EachTeamPlaysExactly38Matches() public {
        vm.prank(owner);
        matchRegistry.generateSchedule(uint64(block.timestamp + 1 days), 7 days);

        uint16[TEAM_COUNT] memory appearances;

        for (uint256 i = 0; i < EXPECTED_FIXTURES; i++) {
            Fixture memory f = matchRegistry.getFixture(i);
            appearances[f.homeTeamId] += 1;
            appearances[f.awayTeamId] += 1;
        }

        for (uint16 t = 0; t < TEAM_COUNT; t++) {
            require(appearances[t] == 38, "team does not play exactly 38 matches");
        }
    }

    function test_NoTeamPlaysItself() public {
        vm.prank(owner);
        matchRegistry.generateSchedule(uint64(block.timestamp + 1 days), 7 days);

        for (uint256 i = 0; i < EXPECTED_FIXTURES; i++) {
            Fixture memory f = matchRegistry.getFixture(i);
            require(f.homeTeamId != f.awayTeamId, "team scheduled against itself");
        }
    }

    function test_EachTeamPlaysEveryOpponentExactlyTwice() public {
        vm.prank(owner);
        matchRegistry.generateSchedule(uint64(block.timestamp + 1 days), 7 days);

        uint8[TEAM_COUNT][TEAM_COUNT] memory directedCount;

        for (uint256 i = 0; i < EXPECTED_FIXTURES; i++) {
            Fixture memory f = matchRegistry.getFixture(i);
            directedCount[f.homeTeamId][f.awayTeamId] += 1;
        }

        for (uint16 a = 0; a < TEAM_COUNT; a++) {
            for (uint16 b = 0; b < TEAM_COUNT; b++) {
                if (a == b) continue;
                require(directedCount[a][b] == 1, "teams do not meet exactly once per home/away direction");
            }
        }
    }

    function test_CannotGenerateScheduleTwice() public {
        vm.startPrank(owner);
        matchRegistry.generateSchedule(uint64(block.timestamp + 1 days), 7 days);

        vm.expectRevert();
        matchRegistry.generateSchedule(uint64(block.timestamp + 1 days), 7 days);
        vm.stopPrank();
    }

    function test_OnlyOwnerCanGenerateSchedule() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        matchRegistry.generateSchedule(uint64(block.timestamp + 1 days), 7 days);
    }

    // =========================================================================
    // Kickoff reveal
    // =========================================================================

    function test_BackendCanRevealKickoffWithinBounds() public {
        uint64 seasonStart = uint64(block.timestamp + 1 days);
        vm.prank(owner);
        matchRegistry.generateSchedule(seasonStart, 7 days);

        vm.warp(seasonStart); // enter matchday 0's window

        uint64 validKickoff = uint64(block.timestamp) + 60 minutes; // within 30-120 min bounds
        vm.prank(backend);
        matchRegistry.revealKickoff(0, validKickoff);

        Fixture memory f = matchRegistry.getFixture(0);
        require(f.kickoffRevealed, "should be revealed");
        require(f.kickoffTimestamp == validKickoff, "kickoff timestamp mismatch");
    }

    function test_RevealRejectsTimestampBelowMinLeadTime() public {
        uint64 seasonStart = uint64(block.timestamp + 1 days);
        vm.prank(owner);
        matchRegistry.generateSchedule(seasonStart, 7 days);
        vm.warp(seasonStart);

        uint64 tooSoon = uint64(block.timestamp) + 10 minutes; // below 30 min minimum
        vm.prank(backend);
        vm.expectRevert();
        matchRegistry.revealKickoff(0, tooSoon);
    }

    function test_RevealRejectsTimestampAboveMaxLeadTime() public {
        uint64 seasonStart = uint64(block.timestamp + 1 days);
        vm.prank(owner);
        matchRegistry.generateSchedule(seasonStart, 7 days);
        vm.warp(seasonStart);

        uint64 tooFar = uint64(block.timestamp) + 200 minutes; // above 120 min maximum
        vm.prank(backend);
        vm.expectRevert();
        matchRegistry.revealKickoff(0, tooFar);
    }

    function test_OnlyBackendCanReveal() public {
        uint64 seasonStart = uint64(block.timestamp + 1 days);
        vm.prank(owner);
        matchRegistry.generateSchedule(seasonStart, 7 days);
        vm.warp(seasonStart);

        vm.prank(address(0xBAD));
        vm.expectRevert();
        matchRegistry.revealKickoff(0, uint64(block.timestamp) + 60 minutes);
    }

    function test_CannotRevealSameFixtureTwice() public {
        uint64 seasonStart = uint64(block.timestamp + 1 days);
        vm.prank(owner);
        matchRegistry.generateSchedule(seasonStart, 7 days);
        vm.warp(seasonStart);

        vm.startPrank(backend);
        matchRegistry.revealKickoff(0, uint64(block.timestamp) + 60 minutes);

        vm.expectRevert();
        matchRegistry.revealKickoff(0, uint64(block.timestamp) + 60 minutes);
        vm.stopPrank();
    }

    function test_BettingOpenBeforeRevealAndClosesAtKickoff() public {
        uint64 seasonStart = uint64(block.timestamp + 1 days);
        vm.prank(owner);
        matchRegistry.generateSchedule(seasonStart, 7 days);

        require(matchRegistry.isBettingOpen(0), "betting should be open before reveal");

        vm.warp(seasonStart);
        uint64 kickoff = uint64(block.timestamp) + 60 minutes;
        vm.prank(backend);
        matchRegistry.revealKickoff(0, kickoff);

        require(matchRegistry.isBettingOpen(0), "betting should still be open before kickoff arrives");

        vm.warp(kickoff);
        require(!matchRegistry.isBettingOpen(0), "betting should close once kickoff arrives");
    }
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { SeasonRegistry } from "./SeasonRegistry.sol";

contract SeasonRegistryTest is Test {
    SeasonRegistry registry;

    address owner = address(0xA11CE);
    address teamRegistryV1 = address(0x1EA1);
    address matchRegistryV1 = address(0x1A7C);
    address teamRegistryV2 = address(0x2EA2);
    address matchRegistryV2 = address(0x2A7C);

    function setUp() public {
        vm.prank(owner);
        registry = new SeasonRegistry(owner);
    }

    function test_StartsWithNoSeason() public view {
        require(registry.currentSeasonId() == 0, "should start at season 0");
    }

    function test_FirstSeasonIsId1() public {
        vm.prank(owner);
        uint256 id = registry.startNewSeason(teamRegistryV1, matchRegistryV1);
        require(id == 1, "first season should be id 1");
        require(registry.currentSeasonId() == 1, "current season should advance to 1");
    }

    function test_ResolvesCorrectAddressesPerSeason() public {
        vm.startPrank(owner);
        registry.startNewSeason(teamRegistryV1, matchRegistryV1);
        registry.startNewSeason(teamRegistryV2, matchRegistryV2);
        vm.stopPrank();

        require(registry.getMatchRegistry(1) == matchRegistryV1, "season 1 match registry mismatch");
        require(registry.getMatchRegistry(2) == matchRegistryV2, "season 2 match registry mismatch");
        require(registry.getTeamRegistry(1) == teamRegistryV1, "season 1 team registry mismatch");
        require(registry.getTeamRegistry(2) == teamRegistryV2, "season 2 team registry mismatch");
    }

    /// @notice Starting a new season must not disturb old seasons' data —
    /// this is what lets pending claims from an old season still resolve
    /// correctly after a new season has already started.
    function test_OldSeasonRemainsResolvableAfterNewSeasonStarts() public {
        vm.startPrank(owner);
        registry.startNewSeason(teamRegistryV1, matchRegistryV1);
        vm.stopPrank();

        require(registry.getMatchRegistry(1) == matchRegistryV1, "season 1 should resolve before season 2 starts");

        vm.prank(owner);
        registry.startNewSeason(teamRegistryV2, matchRegistryV2);

        require(registry.getMatchRegistry(1) == matchRegistryV1, "season 1 should still resolve after season 2 starts");
        require(registry.currentSeasonId() == 2, "current season should now be 2");
    }

    function test_OnlyOwnerCanStartSeason() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        registry.startNewSeason(teamRegistryV1, matchRegistryV1);
    }

    function test_RevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert();
        registry.startNewSeason(address(0), matchRegistryV1);
    }

    function test_RevertsResolvingNonexistentSeason() public {
        vm.expectRevert();
        registry.getMatchRegistry(99);
    }
}

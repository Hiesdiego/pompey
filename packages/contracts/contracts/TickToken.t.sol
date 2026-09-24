// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { TickToken } from "./TickToken.sol";
import { Test } from "forge-std/Test.sol";

contract TickTokenTest is Test {
    TickToken tick;
    address owner = address(0xA11CE);
    address user = address(0xB0B);

    function setUp() public {
        vm.prank(owner);
        tick = new TickToken(owner, 1_000_000 * 10 ** 18);
    }

    function test_InitialSupplyMintedToOwner() public view {
        require(tick.balanceOf(owner) == 1_000_000 * 10 ** 18, "wrong initial supply");
    }

    function test_NameAndSymbol() public view {
        require(
            keccak256(bytes(tick.name())) == keccak256(bytes("TICKR")),
            "wrong name"
        );
        require(
            keccak256(bytes(tick.symbol())) == keccak256(bytes("TICK")),
            "wrong symbol"
        );
    }

    function test_FaucetClaimMintsTokens() public {
        vm.prank(user);
        tick.claimFaucet();
        require(tick.balanceOf(user) == 1_000 * 10 ** 18, "faucet did not mint expected amount");
    }

    function test_FaucetCooldownBlocksSecondClaim() public {
        vm.prank(user);
        tick.claimFaucet();

        vm.prank(user);
        vm.expectRevert();
        tick.claimFaucet();
    }

    function test_FaucetClaimAllowedAfterCooldown() public {
        vm.prank(user);
        tick.claimFaucet();

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(user);
        tick.claimFaucet();

        require(tick.balanceOf(user) == 2_000 * 10 ** 18, "second faucet claim failed");
    }

    function test_OwnerCanDisableFaucet() public {
        vm.prank(owner);
        tick.setFaucetConfig(false, 1_000 * 10 ** 18, 1 days);

        vm.prank(user);
        vm.expectRevert();
        tick.claimFaucet();
    }

    function test_OnlyOwnerCanMint() public {
        vm.prank(user);
        vm.expectRevert();
        tick.mint(user, 100 * 10 ** 18);
    }

    function test_OwnerCanMint() public {
        vm.prank(owner);
        tick.mint(user, 500 * 10 ** 18);
        require(tick.balanceOf(user) == 500 * 10 ** 18, "owner mint failed");
    }

    function testFuzz_FaucetAmountConfigurable(uint96 amount) public {
        vm.assume(amount > 0 && amount < 1_000_000 * 10 ** 18);
        vm.prank(owner);
        tick.setFaucetConfig(true, amount, 1 days);

        vm.prank(user);
        tick.claimFaucet();

        require(tick.balanceOf(user) == amount, "fuzzed faucet amount mismatch");
    }
}

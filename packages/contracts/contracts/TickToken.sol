// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TICK — TICKR v0.1 in-game token
/// @notice The sole staking currency for TICKR v0.1. Used for all prediction
/// pool stakes and reward payouts. Includes a testnet faucet, gated to the
/// testnet deployment only (the faucet is intentionally left in the contract
/// even for a mainnet deploy path so the same bytecode can be reused, but
/// `faucetEnabled` should be permanently set to false before any mainnet
/// deployment).
contract TickToken is ERC20, ERC20Burnable, Ownable {
    /// @notice Whether the public faucet is currently active.
    bool public faucetEnabled;

    /// @notice Amount dispensed per faucet claim (in whole TICK, 18 decimals).
    uint256 public faucetAmount = 1_000 * 10 ** 18;

    /// @notice Cooldown between faucet claims per address.
    uint256 public faucetCooldown = 1 days;

    /// @notice Last claim timestamp per address.
    mapping(address => uint256) public lastFaucetClaim;

    event FaucetClaimed(address indexed to, uint256 amount);
    event FaucetConfigUpdated(bool enabled, uint256 amount, uint256 cooldown);

    error FaucetDisabled();
    error FaucetCooldownActive(uint256 secondsRemaining);

    constructor(address initialOwner, uint256 initialSupply)
        ERC20("TICKR", "TICK")
        Ownable(initialOwner)
    {
        faucetEnabled = true;
        if (initialSupply > 0) {
            _mint(initialOwner, initialSupply);
        }
    }

    /// @notice Claim testnet TICK from the faucet. Anyone can call this while
    /// the faucet is enabled, subject to a per-address cooldown.
    function claimFaucet() external {
        if (!faucetEnabled) revert FaucetDisabled();

        uint256 nextClaimAt = lastFaucetClaim[msg.sender] + faucetCooldown;
        if (block.timestamp < nextClaimAt) {
            revert FaucetCooldownActive(nextClaimAt - block.timestamp);
        }

        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);

        emit FaucetClaimed(msg.sender, faucetAmount);
    }

    /// @notice Admin mint — used for reward pool seeding, sponsor allocations, etc.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Permanently or temporarily disable the faucet. Must be called
    /// with `enabled = false` before/at mainnet launch.
    function setFaucetConfig(bool enabled, uint256 amount, uint256 cooldown) external onlyOwner {
        faucetEnabled = enabled;
        faucetAmount = amount;
        faucetCooldown = cooldown;
        emit FaucetConfigUpdated(enabled, amount, cooldown);
    }
}

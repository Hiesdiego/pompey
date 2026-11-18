// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { StockConstants } from "./StockConstants.sol";

/// @title StockTeamRegistry - TICKR Stock League roster (UUPS upgradeable)
///
/// @notice Stores the fixed 12-team stock roster, in the locked teamId
/// order 0-11: NVDA, AAPL, MSFT, AMZN, GOOGL, META, TSLA, MSTR, CRCL,
/// INTC, SNDK, SPCX (SpaceX). Revised Nov 18 2026 from the 22-team
/// roster: INTC, SNDK and SPCX are NEW, not in the 22-team roster.
/// The 13 sidelined teams return for Season 2. Every team is a
/// Coinbase B20 tokenized stock (symbol suffixed `c`, 8 decimals).
/// Token addresses are copied verbatim from the Base Tokenized Stocks
/// API (https://api.coinbase.com/v1/tokenized-stocks), re-verified live
/// Nov 18 2026: all 12 carry a live nav_price that day. The old
/// 22-team registry is NOT reused and NOT modified; this is a fresh
/// registry for the fresh 12-team stack (see StockDeploy.ts).
///
/// @dev STOCK DIFFERENCES FROM CRYPTO TeamRegistry:
///   - 12 teams, not 20, and each team carries its on-chain token address
///     plus decimals (crypto teams are off-chain CoinGecko/Binance ids).
///   - UUPS upgradeable instead of a plain constructor deployment, so the
///     roster metadata can be corrected without a full stack redeploy.
///     Upgrades are owner-only (see _authorizeUpgrade).
///   - initialize() replaces the constructor. It must be called exactly
///     once, through the ERC1967 proxy, by StockDeploy.ts.
///   - Storage gap reserved for future upgrades (UUPS storage layout rule).
contract StockTeamRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    struct Team {
        string name;
        string symbol;
        address tokenAddress;
        uint8 decimals;
        bool active;
    }

    uint16 public teamCount;
    mapping(uint16 => Team) private _teams;

    /// @notice Reserved storage for future upgrades. Never remove or reorder.
    uint256[48] private __gap;

    event TeamDeactivated(uint16 indexed teamId);
    event TeamReactivated(uint16 indexed teamId);

    error TeamCountMismatch();
    error InvalidTeamId(uint16 teamId);
    error EmptyRoster();
    error ZeroTokenAddress(uint16 teamId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer, called through the proxy by the deploy
    /// script. `names`, `symbols` and `tokenAddresses` must each have
    /// exactly StockConstants.TEAM_COUNT (12) entries, in the locked order.
    function initialize(
        address initialOwner,
        string[] memory names,
        string[] memory symbols,
        address[] memory tokenAddresses
    ) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();

        if (names.length == 0) revert EmptyRoster();
        if (
            names.length != StockConstants.TEAM_COUNT || symbols.length != StockConstants.TEAM_COUNT
                || tokenAddresses.length != StockConstants.TEAM_COUNT
        ) revert TeamCountMismatch();

        teamCount = uint16(names.length);

        for (uint16 i = 0; i < teamCount; i++) {
            if (tokenAddresses[i] == address(0)) revert ZeroTokenAddress(i);
            _teams[i] = Team({
                name: names[i],
                symbol: symbols[i],
                tokenAddress: tokenAddresses[i],
                decimals: StockConstants.PRICE_DECIMALS,
                active: true
            });
        }
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function getTeam(uint16 teamId) external view returns (Team memory) {
        if (teamId >= teamCount) revert InvalidTeamId(teamId);
        return _teams[teamId];
    }

    function getTokenAddress(uint16 teamId) external view returns (address) {
        if (teamId >= teamCount) revert InvalidTeamId(teamId);
        return _teams[teamId].tokenAddress;
    }

    function isActive(uint16 teamId) external view returns (bool) {
        if (teamId >= teamCount) revert InvalidTeamId(teamId);
        return _teams[teamId].active;
    }

    /// @notice Emergency safety valve only (e.g. a stock's NAV feed becomes
    /// unreliable mid-season). Does NOT remove historical fixtures or
    /// results, it only marks the team inactive for backend display and
    /// future scheduling decisions. Fixtures are generated once up front,
    /// so in practice this flag is informational during Season 1.
    function deactivateTeam(uint16 teamId) external onlyOwner {
        if (teamId >= teamCount) revert InvalidTeamId(teamId);
        _teams[teamId].active = false;
        emit TeamDeactivated(teamId);
    }

    function reactivateTeam(uint16 teamId) external onlyOwner {
        if (teamId >= teamCount) revert InvalidTeamId(teamId);
        _teams[teamId].active = true;
        emit TeamReactivated(teamId);
    }
}

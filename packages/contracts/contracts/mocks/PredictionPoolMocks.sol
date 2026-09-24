// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ISeasonRegistry, IMatchRegistry, IPlayerStats, Fixture } from "../interfaces/ITickr.sol";

/// @dev Minimal mock of MatchRegistry for unit tests. Lets tests directly
/// control whether betting is "open" for a given fixture without needing a
/// real MatchRegistry deployment.
contract MockMatchRegistry is IMatchRegistry {
    mapping(uint256 => bool) public bettingOpenOverride;
    mapping(uint256 => bool) public settledOverride;

    function setBettingOpen(uint256 fixtureId, bool open) external {
        bettingOpenOverride[fixtureId] = open;
    }

    function getFixture(uint256) external pure returns (Fixture memory) {
        return Fixture({
            homeTeamId: 0,
            awayTeamId: 1,
            matchdayIndex: 0,
            windowStart: 0,
            windowEnd: 0,
            kickoffTimestamp: 0,
            kickoffRevealed: false,
            settled: false
        });
    }

    function fixtureCount() external pure returns (uint256) {
        return 1;
    }

    function isBettingOpen(uint256 fixtureId) external view returns (bool) {
        return bettingOpenOverride[fixtureId];
    }

    function markSettled(uint256 fixtureId) external {
        settledOverride[fixtureId] = true;
    }
}

/// @dev Minimal mock of SeasonRegistry — always resolves every seasonId to
/// the same single mocked MatchRegistry, which is enough for unit tests
/// that only exercise one season at a time.
contract MockSeasonRegistry is ISeasonRegistry {
    address public matchRegistryAddr;
    address public teamRegistryAddr;
    uint256 public currentSeasonIdValue = 1;

    constructor(address _matchRegistry, address _teamRegistry) {
        matchRegistryAddr = _matchRegistry;
        teamRegistryAddr = _teamRegistry;
    }

    function currentSeasonId() external view returns (uint256) {
        return currentSeasonIdValue;
    }

    function getMatchRegistry(uint256) external view returns (address) {
        return matchRegistryAddr;
    }

    function getTeamRegistry(uint256) external view returns (address) {
        return teamRegistryAddr;
    }
}

/// @dev Minimal mock of PlayerStats — just records the last call's args so
/// tests can assert on them without needing the real access-control wiring.
contract MockPlayerStats is IPlayerStats {
    address public lastPlayer;
    uint256 public lastSeasonId;
    uint256 public lastFixtureId;
    bool public lastWon;
    bool public lastIsDraw;
    uint256 public lastAmountStaked;
    uint256 public lastAmountWon;
    uint256 public callCount;

    function recordOutcome(
        address player,
        uint256 seasonId,
        uint256 fixtureId,
        bool won,
        bool isDraw,
        uint256 amountStaked,
        uint256 amountWon
    ) external {
        lastPlayer = player;
        lastSeasonId = seasonId;
        lastFixtureId = fixtureId;
        lastWon = won;
        lastIsDraw = isDraw;
        lastAmountStaked = amountStaked;
        lastAmountWon = amountWon;
        callCount += 1;
    }
}

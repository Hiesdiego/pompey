// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SeasonRegistry — TICKR season lifecycle
///
/// @notice TICK, PlayerStats, PredictionPool, PriceOracle, and ResultEngine
/// are deployed once and persist across every season. TeamRegistry and
/// MatchRegistry are redeployed fresh for each season (so the roster and
/// fixture list can change between seasons) and get registered here.
///
/// The persistent contracts never hold a direct immutable reference to a
/// specific TeamRegistry/MatchRegistry — they hold a reference to this
/// registry instead, and resolve "which MatchRegistry for season N" on
/// every call via `getMatchRegistry(seasonId)`. This is what lets a new
/// season start with a completely different roster/fixture contract while
/// old seasons' pending claims and results remain fully readable and
/// settleable against their original MatchRegistry.
contract SeasonRegistry is Ownable {
    struct Season {
        address teamRegistry;
        address matchRegistry;
        uint64 startedAt;
    }

    /// @notice 0 means no season has started yet.
    uint256 public currentSeasonId;

    mapping(uint256 => Season) public seasons;

    event SeasonStarted(
        uint256 indexed seasonId,
        address indexed teamRegistry,
        address indexed matchRegistry,
        uint64 startedAt
    );

    error ZeroAddress();
    error SeasonDoesNotExist(uint256 seasonId);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Registers a new season's already-deployed TeamRegistry and
    /// MatchRegistry, and advances currentSeasonId. Does NOT deploy those
    /// contracts itself — deploy them first (e.g. via Ignition), then call
    /// this to make them "live". Nothing about a prior season is disabled
    /// by starting a new one; PredictionPool/PriceOracle/ResultEngine can
    /// still be pointed at any past seasonId to settle stragglers.
    function startNewSeason(address teamRegistry, address matchRegistry)
        external
        onlyOwner
        returns (uint256 seasonId)
    {
        if (teamRegistry == address(0) || matchRegistry == address(0)) revert ZeroAddress();

        seasonId = currentSeasonId + 1;
        seasons[seasonId] = Season({
            teamRegistry: teamRegistry,
            matchRegistry: matchRegistry,
            startedAt: uint64(block.timestamp)
        });
        currentSeasonId = seasonId;

        emit SeasonStarted(seasonId, teamRegistry, matchRegistry, uint64(block.timestamp));
    }

    function getMatchRegistry(uint256 seasonId) external view returns (address) {
        Season memory s = seasons[seasonId];
        if (s.matchRegistry == address(0)) revert SeasonDoesNotExist(seasonId);
        return s.matchRegistry;
    }

    function getTeamRegistry(uint256 seasonId) external view returns (address) {
        Season memory s = seasons[seasonId];
        if (s.teamRegistry == address(0)) revert SeasonDoesNotExist(seasonId);
        return s.teamRegistry;
    }

    function getSeason(uint256 seasonId) external view returns (Season memory) {
        return seasons[seasonId];
    }
}

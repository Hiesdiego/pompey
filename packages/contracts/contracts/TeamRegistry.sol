// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TeamRegistry — TICKR v0.1 team roster
/// @notice Stores the fixed 20-team league roster. v0.1 is a single,
/// permanent league (no promotion/relegation, no mid-season roster changes)
/// so this contract is intentionally simple: teams are set once at
/// construction, in the exact order of packages/shared/src/teams.ts so that
/// on-chain teamId always matches the off-chain roster definition.
///
/// `deactivateTeam` exists purely as an emergency safety valve (e.g. a coin
/// loses liquidity or a price feed becomes unreliable mid-season) — it does
/// NOT remove historical fixtures or results, it only blocks that team's
/// FUTURE un-generated fixtures from being scheduled. For v0.1, fixtures are
/// generated once for the whole season up front, so in practice this flag is
/// informational until v0.2's multi-season/multi-league logic exists.
contract TeamRegistry is Ownable {
    struct Team {
        string name;
        string symbol;
        bool active;
    }

    uint16 public immutable teamCount;
    mapping(uint16 => Team) private _teams;

    event TeamDeactivated(uint16 indexed teamId);
    event TeamReactivated(uint16 indexed teamId);

    error TeamCountMismatch();
    error InvalidTeamId(uint16 teamId);
    error EmptyRoster();

    constructor(address initialOwner, string[] memory names, string[] memory symbols)
        Ownable(initialOwner)
    {
        if (names.length == 0) revert EmptyRoster();
        if (names.length != symbols.length) revert TeamCountMismatch();

        teamCount = uint16(names.length);

        for (uint16 i = 0; i < teamCount; i++) {
            _teams[i] = Team({ name: names[i], symbol: symbols[i], active: true });
        }
    }

    function getTeam(uint16 teamId) external view returns (Team memory) {
        if (teamId >= teamCount) revert InvalidTeamId(teamId);
        return _teams[teamId];
    }

    function isActive(uint16 teamId) external view returns (bool) {
        if (teamId >= teamCount) revert InvalidTeamId(teamId);
        return _teams[teamId].active;
    }

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

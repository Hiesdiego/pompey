// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PlayerStats — TICKR v0.1 player prediction record
/// @notice Tracks each player's wins/losses/draws and staking totals.
/// Written only by PredictionPool (the sole authorized writer, wired
/// post-deploy). Read by the backend to build the leaderboard and by the
/// frontend to render a player's profile page (wins, losses, win rate).
/// Ranking/sorting itself happens off-chain in the backend by indexing
/// events + reading this contract's state — sorting on-chain across an
/// unbounded player set is not gas-viable.
contract PlayerStats is Ownable {
    struct Stats {
        uint32 wins;
        uint32 losses;
        uint32 draws;
        uint32 currentStreak; // consecutive correct predictions
        uint32 longestStreak;
        uint256 totalStakedTick;
        uint256 totalWonTick;
    }

    mapping(address => Stats) private _stats;

    address public predictionPool;
    bool public predictionPoolSet;

    event OutcomeRecorded(address indexed player, uint256 indexed seasonId, uint256 fixtureId, bool won, bool isDraw);

    error OnlyPredictionPool();
    error PredictionPoolAlreadySet();

    modifier onlyPredictionPool() {
        if (msg.sender != predictionPool) revert OnlyPredictionPool();
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice One-time wiring after PredictionPool is deployed.
    function setPredictionPool(address _predictionPool) external onlyOwner {
        if (predictionPoolSet) revert PredictionPoolAlreadySet();
        predictionPool = _predictionPool;
        predictionPoolSet = true;
    }

    /// @notice Deliberately career-cumulative, NOT reset per season — a
    /// player's overall win rate and streaks carry across every season they
    /// play. seasonId is accepted and emitted purely for off-chain
    /// analytics (so the backend can compute season-specific leaderboards
    /// by filtering events), not for any on-chain per-season bucketing. If
    /// a future version wants season-scoped leaderboards stored on-chain
    /// too, this would need its own seasonId-keyed mapping alongside this
    /// one.
    function recordOutcome(
        address player,
        uint256 seasonId,
        uint256 fixtureId,
        bool won,
        bool isDraw,
        uint256 amountStaked,
        uint256 amountWon
    ) external onlyPredictionPool {
        Stats storage s = _stats[player];

        s.totalStakedTick += amountStaked;

        if (won) {
            s.wins += 1;
            s.totalWonTick += amountWon;
            s.currentStreak += 1;
            if (s.currentStreak > s.longestStreak) {
                s.longestStreak = s.currentStreak;
            }
        } else if (isDraw) {
            s.draws += 1;
            // A draw is treated as neutral for streak purposes in v0.1 —
            // does not extend a win streak, does not reset it either.
        } else {
            s.losses += 1;
            s.currentStreak = 0;
        }

        emit OutcomeRecorded(player, seasonId, fixtureId, won, isDraw);
    }

    function getStats(address player) external view returns (Stats memory) {
        return _stats[player];
    }

    /// @notice Win rate in basis points (e.g. 6543 = 65.43%). Returns 0 if
    /// the player has no resolved predictions yet.
    function winRateBps(address player) external view returns (uint256) {
        Stats memory s = _stats[player];
        uint256 resolved = uint256(s.wins) + uint256(s.losses) + uint256(s.draws);
        if (resolved == 0) return 0;
        return (uint256(s.wins) * 10_000) / resolved;
    }
}

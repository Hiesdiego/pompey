// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IResultEngine, Outcome, SeasonMath } from "./interfaces/ITickr.sol";

/// @title PriceOracle — TICKR price-battle result computation
///
/// @notice Persists across every season. The backend (a single authorized
/// signer for v0.1 — a multi-sig or decentralized oracle committee is a
/// v0.2 hardening item) submits the start price (at kickoff) and end price
/// (at kickoff + match duration) for both teams in a fixture. This contract
/// computes each team's % change, rounds it to goals, normalizes the
/// scoreline (no negative scores — a side's negative goals become
/// plus-goals for the opponent), and determines the outcome: higher score
/// wins, equal scores = draw.
///
/// v0.3 scoring: 1 goal = 0.5% price move (was 1%). The finer granularity
/// means genuine sub-0.5% edges (e.g. +0.49% vs −0.49%) resolve to a win
/// instead of rounding both sides to a 0-0 draw.
///
/// Prices are submitted as fixed-point integers with PRICE_DECIMALS decimal
/// places. Snapshots are stored keyed by (seasonId, fixtureId) via
/// SeasonMath, same pattern as PredictionPool.
///
/// Additionally the backend submits HOURLY PRICE CHECKPOINTS for every team
/// (submitCheckpoints). These form a 30-day rolling price history that the
/// MarketFactory reads for trustless outright-market resolution
/// (getPriceAt). Checkpoints are global (not per-season) — a coin's price
/// history doesn't reset when a season does.
contract PriceOracle is Ownable {
    uint8 public constant PRICE_DECIMALS = 8;

    /// @notice Checkpoint cadence and retention. 720 hourly slots = 30 days
    /// of history; older slots are pruned on every submit to bound storage.
    uint64 public constant CHECKPOINT_INTERVAL = 1 hours;
    uint64 public constant CHECKPOINT_RETENTION_HOURS = 720;
    /// @notice How far getPriceAt walks back over gaps (backend downtime).
    /// Bounded so resolution lookups can never blow past the block gas
    /// limit; 48 hourly steps covers ~2 days of outage.
    uint64 public constant CHECKPOINT_MAX_LOOKBACK = 48;

    /// @notice Basis points of price movement per goal. v0.3: 50 = 1 goal
    /// per 0.5% move (was 100 = 1 goal per 1%).
    uint256 internal constant BPS_PER_GOAL = 50;

    IResultEngine public resultEngine;
    bool public resultEngineSet;

    address public backendSigner;

    struct Snapshot {
        uint256 homeStart;
        uint256 awayStart;
        uint256 homeEnd;
        uint256 awayEnd;
        bool startSubmitted;
        bool endSubmitted;
    }

    mapping(uint256 => Snapshot) public snapshots; // globalFixtureId => snapshot

    /// @notice teamId => hourTimestamp (floored to the hour) => price.
    /// A zero price means "no checkpoint" — submitted prices are required
    /// non-zero so zero is an unambiguous sentinel.
    mapping(uint16 => mapping(uint64 => uint256)) public checkpoints;

    event StartPriceSubmitted(uint256 indexed seasonId, uint256 indexed fixtureId, uint256 homeStart, uint256 awayStart);
    event EndPriceSubmitted(
        uint256 indexed seasonId,
        uint256 indexed fixtureId,
        uint256 homeEnd,
        uint256 awayEnd,
        int16 homeRoundedPct,
        int16 awayRoundedPct,
        Outcome outcome
    );
    event CheckpointsSubmitted(uint64 indexed hourTimestamp, uint16 teamCount);
    event BackendSignerUpdated(address indexed newSigner);

    error OnlyBackendSigner();
    error ResultEngineAlreadySet();
    error StartAlreadySubmitted(uint256 seasonId, uint256 fixtureId);
    error EndAlreadySubmitted(uint256 seasonId, uint256 fixtureId);
    error StartNotSubmitted(uint256 seasonId, uint256 fixtureId);
    error InvalidPrice();
    error CheckpointLengthMismatch(uint256 teamCount, uint256 priceCount);
    error CheckpointNotHourAligned(uint64 timestamp);

    modifier onlyBackend() {
        if (msg.sender != backendSigner) revert OnlyBackendSigner();
        _;
    }

    constructor(address initialOwner, address _backendSigner) Ownable(initialOwner) {
        backendSigner = _backendSigner;
    }

    function setResultEngine(address _resultEngine) external onlyOwner {
        if (resultEngineSet) revert ResultEngineAlreadySet();
        resultEngine = IResultEngine(_resultEngine);
        resultEngineSet = true;
    }

    function setBackendSigner(address newSigner) external onlyOwner {
        backendSigner = newSigner;
        emit BackendSignerUpdated(newSigner);
    }

    /// @notice Submitted the moment a fixture's kickoff arrives.
    function submitStartPrice(uint256 seasonId, uint256 fixtureId, uint256 homePrice, uint256 awayPrice)
        external
        onlyBackend
    {
        if (homePrice == 0 || awayPrice == 0) revert InvalidPrice();
        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        Snapshot storage s = snapshots[gid];
        if (s.startSubmitted) revert StartAlreadySubmitted(seasonId, fixtureId);

        s.homeStart = homePrice;
        s.awayStart = awayPrice;
        s.startSubmitted = true;

        emit StartPriceSubmitted(seasonId, fixtureId, homePrice, awayPrice);
    }

    /// @notice Submitted at kickoff + match duration. Computes each team's
    /// rounded % change (in goals), normalizes the scoreline so neither
    /// side is negative, determines the outcome, and pushes the result
    /// onward to ResultEngine in the same transaction.
    function submitEndPrice(uint256 seasonId, uint256 fixtureId, uint256 homePrice, uint256 awayPrice)
        external
        onlyBackend
    {
        if (homePrice == 0 || awayPrice == 0) revert InvalidPrice();
        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        Snapshot storage s = snapshots[gid];
        if (!s.startSubmitted) revert StartNotSubmitted(seasonId, fixtureId);
        if (s.endSubmitted) revert EndAlreadySubmitted(seasonId, fixtureId);

        s.homeEnd = homePrice;
        s.awayEnd = awayPrice;
        s.endSubmitted = true;

        int16 homeRaw = _roundedPercentChange(s.homeStart, homePrice);
        int16 awayRaw = _roundedPercentChange(s.awayStart, awayPrice);

        // v0.3: no negative scorelines. Margin-preserving, so the outcome
        // below is identical to comparing the raw values — the recorded
        // (and emitted) scoreline is simply the non-negative presentation.
        (int16 homeGoals, int16 awayGoals) = _normalizeScoreline(homeRaw, awayRaw);

        Outcome outcome;
        if (homeGoals > awayGoals) {
            outcome = Outcome.WinHome;
        } else if (awayGoals > homeGoals) {
            outcome = Outcome.WinAway;
        } else {
            outcome = Outcome.Draw;
        }

        emit EndPriceSubmitted(seasonId, fixtureId, homePrice, awayPrice, homeGoals, awayGoals, outcome);

        resultEngine.recordResult(seasonId, fixtureId, outcome, homeGoals, awayGoals);
    }

    /// @notice Backend submits every team's current price once per hour.
    /// The slot is floored to the hour from block.timestamp, so retries
    /// within the same hour are idempotent overwrites (latest wins) and can
    /// never brick the feed. Also prunes the slot that just fell out of the
    /// 30-day retention window, keeping storage bounded.
    function submitCheckpoints(uint16[] calldata teamIds, uint256[] calldata prices)
        external
        onlyBackend
    {
        if (teamIds.length != prices.length) {
            revert CheckpointLengthMismatch(teamIds.length, prices.length);
        }
        uint64 hourTs = uint64((block.timestamp / CHECKPOINT_INTERVAL) * CHECKPOINT_INTERVAL);

        for (uint256 i = 0; i < teamIds.length; i++) {
            if (prices[i] == 0) revert InvalidPrice();
            checkpoints[teamIds[i]][hourTs] = prices[i];

            // Prune the slot aging out of retention (guarded against
            // underflow for theoretical sub-30-day chain timestamps).
            uint64 retentionSeconds = CHECKPOINT_RETENTION_HOURS * CHECKPOINT_INTERVAL;
            if (hourTs >= retentionSeconds) {
                delete checkpoints[teamIds[i]][hourTs - retentionSeconds];
            }
        }

        emit CheckpointsSubmitted(hourTs, uint16(teamIds.length));
    }

    /// @notice One-time migration helper (v0.2 → v0.3 cutover): backfills
    /// hourly checkpoints from the previous PriceOracle deployment so
    /// outright markets with lookback windows keep resolving without
    /// waiting ~48h for fresh history to accumulate. Owner-only. Every
    /// timestamp must be hour-aligned (getPriceAt only ever reads
    /// hour-floored slots) and every price non-zero. Not used in normal
    /// operation.
    function importCheckpoints(
        uint16[] calldata teamIds,
        uint64[] calldata hourTimestamps,
        uint256[] calldata prices
    ) external onlyOwner {
        if (teamIds.length != hourTimestamps.length || teamIds.length != prices.length) {
            revert CheckpointLengthMismatch(teamIds.length, prices.length);
        }
        for (uint256 i = 0; i < teamIds.length; i++) {
            if (hourTimestamps[i] % CHECKPOINT_INTERVAL != 0) {
                revert CheckpointNotHourAligned(hourTimestamps[i]);
            }
            if (prices[i] == 0) revert InvalidPrice();
            checkpoints[teamIds[i]][hourTimestamps[i]] = prices[i];
        }
    }

    /// @notice Price of `teamId` at time `timestamp`: the latest checkpoint
    /// at or before `timestamp`. Walks back over gaps (up to
    /// CHECKPOINT_MAX_LOOKBACK hourly steps) so short backend outages don't
    /// void markets; returns found=false when no checkpoint exists in the
    /// window.
    function getPriceAt(uint16 teamId, uint64 timestamp)
        external
        view
        returns (bool found, uint256 price)
    {
        uint64 hourTs = uint64((timestamp / CHECKPOINT_INTERVAL) * CHECKPOINT_INTERVAL);
        for (uint64 i = 0; i < CHECKPOINT_MAX_LOOKBACK; i++) {
            uint256 p = checkpoints[teamId][hourTs];
            if (p != 0) return (true, p);
            if (hourTs < CHECKPOINT_INTERVAL) break;
            unchecked {
                hourTs -= CHECKPOINT_INTERVAL;
            }
        }
        return (false, 0);
    }

    /// @notice Raw fixture prices for outright resolution. `endSubmitted`
    /// doubles as "the fixture's result is knowable on-chain".
    function getFixtureEndPrices(uint256 seasonId, uint256 fixtureId)
        external
        view
        returns (
            bool endSubmitted,
            uint256 homeStart,
            uint256 awayStart,
            uint256 homeEnd,
            uint256 awayEnd
        )
    {
        Snapshot storage s = snapshots[SeasonMath.globalFixtureId(seasonId, fixtureId)];
        return (s.endSubmitted, s.homeStart, s.awayStart, s.homeEnd, s.awayEnd);
    }

    /// @notice % change from `startPrice` to `endPrice`, converted to goals
    /// at BPS_PER_GOAL basis points per goal (v0.3: 1 goal = 0.5%),
    /// rounded half up (half away from zero for negatives) at the
    /// half-goal threshold. Handles negative changes (price drops) via
    /// signed arithmetic.
    function _roundedPercentChange(uint256 startPrice, uint256 endPrice) internal pure returns (int16) {
        int256 delta = int256(endPrice) - int256(startPrice);
        int256 bps = (delta * 10_000) / int256(startPrice);

        int256 halfGoal = int256(BPS_PER_GOAL) / 2;
        int256 goals;
        if (bps >= 0) {
            goals = (bps + halfGoal) / int256(BPS_PER_GOAL);
        } else {
            goals = (bps - halfGoal) / int256(BPS_PER_GOAL);
        }

        return int16(goals);
    }

    /// @notice Removes negative scorelines: each side's negative goals are
    /// transferred to the opponent as plus-goals (equal negatives cancel
    /// out, e.g. −2:−2 → 2:2, and 0:−1 → 1:0).
    ///
    /// Margin-preserving: homeGoals − awayGoals == homeRaw − awayRaw in all
    /// four sign cases, so outcomes, points and goal differences are
    /// bit-identical to the unnormalized computation — only the
    /// presentation changes.
    function _normalizeScoreline(int16 homeRaw, int16 awayRaw)
        internal
        pure
        returns (int16 homeGoals, int16 awayGoals)
    {
        int16 homeGains = homeRaw > 0 ? homeRaw : int16(0);
        int16 awayGains = awayRaw > 0 ? awayRaw : int16(0);
        int16 homeLosses = homeRaw < 0 ? -homeRaw : int16(0);
        int16 awayLosses = awayRaw < 0 ? -awayRaw : int16(0);
        homeGoals = homeGains + awayLosses;
        awayGoals = awayGains + homeLosses;
    }

    function getSnapshot(uint256 seasonId, uint256 fixtureId) external view returns (Snapshot memory) {
        return snapshots[SeasonMath.globalFixtureId(seasonId, fixtureId)];
    }
}

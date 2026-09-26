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
/// computes each team's % change, rounds to the nearest whole integer (the
/// "score"), and determines the outcome: higher rounded score wins, equal
/// rounded scores = draw.
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

    /// @notice Submitted at kickoff + match duration. Computes the rounded
    /// % change for both teams, determines the outcome, and pushes the
    /// result onward to ResultEngine in the same transaction.
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

        int16 homeRoundedPct = _roundedPercentChange(s.homeStart, homePrice);
        int16 awayRoundedPct = _roundedPercentChange(s.awayStart, awayPrice);

        Outcome outcome;
        if (homeRoundedPct > awayRoundedPct) {
            outcome = Outcome.WinHome;
        } else if (awayRoundedPct > homeRoundedPct) {
            outcome = Outcome.WinAway;
        } else {
            outcome = Outcome.Draw;
        }

        emit EndPriceSubmitted(seasonId, fixtureId, homePrice, awayPrice, homeRoundedPct, awayRoundedPct, outcome);

        resultEngine.recordResult(seasonId, fixtureId, outcome, homeRoundedPct, awayRoundedPct);
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

    /// @notice % change from `startPrice` to `endPrice`, in basis points,
    /// rounded to the nearest whole integer percent using round-half-up.
    /// Handles negative changes (price drops) via signed arithmetic.
    function _roundedPercentChange(uint256 startPrice, uint256 endPrice) internal pure returns (int16) {
        int256 delta = int256(endPrice) - int256(startPrice);
        int256 bps = (delta * 10_000) / int256(startPrice);

        int256 roundedPct;
        if (bps >= 0) {
            roundedPct = (bps + 50) / 100;
        } else {
            roundedPct = (bps - 50) / 100;
        }

        return int16(roundedPct);
    }

    function getSnapshot(uint256 seasonId, uint256 fixtureId) external view returns (Snapshot memory) {
        return snapshots[SeasonMath.globalFixtureId(seasonId, fixtureId)];
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { StockConstants, StockOutcome, StockSeasonMath } from "./StockConstants.sol";

/// @notice Minimal interface of StockResultEngine used by this contract.
interface IStockResultEngine {
    function recordResult(
        uint256 seasonId,
        uint256 fixtureId,
        StockOutcome outcome,
        int16 homeGoals,
        int16 awayGoals
    ) external;
}

/// @title StockPriceOracle - TICKR Stock League price-battle result computation
///
/// @notice The backend (a single authorized signer for Season 1) submits
/// the start price (at kickoff, from Chainlink NAV via the Base API) and
/// the end price (at kickoff + 3600s) for both teams in a fixture. This
/// contract computes each team's % change, rounds it to goals, normalizes
/// the scoreline (no negative scores), and determines the outcome.
/// The backend also submits HOURLY PRICE CHECKPOINTS for every team,
/// forming a 30-day rolling price history (same pattern as crypto).
///
/// @dev STOCK DIFFERENCES FROM CRYPTO PriceOracle:
///   - BANDED GOAL SCALE (revised 2026-11-27, replacing the original
///     linear 1 goal = 0.05% with a 10-goal cap): goals come from the
///     absolute move's band: under 0.10% scores 0, then 0.10% / 0.25% /
///     0.75% / 1.50% / 3.00% / 6.00% score 1 / 2 / 3 / 4 / 5 / 6 goals,
///     and each full extra 3.00% beyond 6.00% adds one more goal. There
///     is NO goal cap: 9.00% scores 7, 12.00% scores 8, and the scale
///     keeps climbing, just at a slower rate, so normal matches stay in
///     football range while extreme moves are still respected. The
///     linear scale saturated its cap on routine in-session moves (a
///     +1.68% vs +0.50% match was recorded as a 10-10 draw on Matchday 2
///     of Season 1), which is why it was replaced. No-negative
///     normalization is unchanged and still applies after conversion.
///   - 3% VOLATILE CAP / CIRCUIT BREAKER: a raw move above 3% (300 bps)
///     in the 1-hour window trips `volatileSpike[globalFixtureId]` and
///     emits CircuitBreakerTripped. The scoreline is still recorded, so
///     the season does not stall, but the flag is on-chain for
///     backend/DAO review. This is a flag, not an automatic void:
///     voiding stays a deliberate backend action via
///     StockResultEngine.recordVoid.
///   - STALE NAV: there is deliberately NO Dinari fallback in this
///     contract. If no fresh NAV price exists for a match period, the
///     backend must NOT submit a stale price. It records a forfeit (one
///     team missing) or a void (both missing) through
///     StockResultEngine.recordForfeit / recordVoid instead. A stale
///     snapshot must never decide a match.
///   - UUPS upgradeable, owner-only upgrades. initialize() replaces the
///     constructor; resultEngine is a one-time setter, as in crypto.
///   - Season id is fixed to StockConstants.SEASON_ID (1) for this stack.
contract StockPriceOracle is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    IStockResultEngine public resultEngine;
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

    /// @notice True when either team's raw move in the window exceeded the
    /// 3% volatile cap. Flagged for review; the scoreline still stands.
    mapping(uint256 => bool) public volatileSpike;

    /// @notice teamId => hourTimestamp (floored to the hour) => NAV price.
    /// A zero price means "no checkpoint", submitted prices must be non-zero.
    mapping(uint16 => mapping(uint64 => uint256)) public checkpoints;

    /// @notice Reserved storage for future upgrades. Never remove or reorder.
    uint256[48] private __gap;

    event StartPriceSubmitted(uint256 indexed seasonId, uint256 indexed fixtureId, uint256 homeStart, uint256 awayStart);
    event EndPriceSubmitted(
        uint256 indexed seasonId,
        uint256 indexed fixtureId,
        uint256 homeEnd,
        uint256 awayEnd,
        int16 homeGoals,
        int16 awayGoals,
        StockOutcome outcome
    );
    /// @notice Emitted when a raw move exceeds the 3% volatile cap. The
    /// recorded scoreline is capped at 10 goals per team; this event is
    /// the on-chain marker that the fixture deserves review.
    event CircuitBreakerTripped(
        uint256 indexed seasonId,
        uint256 indexed fixtureId,
        int256 homeRawBps,
        int256 awayRawBps
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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address _backendSigner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        backendSigner = _backendSigner;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function setResultEngine(address _resultEngine) external onlyOwner {
        if (resultEngineSet) revert ResultEngineAlreadySet();
        resultEngine = IStockResultEngine(_resultEngine);
        resultEngineSet = true;
    }

    function setBackendSigner(address newSigner) external onlyOwner {
        backendSigner = newSigner;
        emit BackendSignerUpdated(newSigner);
    }

    /// @notice Submitted the moment a fixture's kickoff arrives. Prices are
    /// Chainlink NAV values with 8 decimals. A missing NAV price must NOT
    /// be submitted as zero or stale: use the forfeit/void path instead.
    function submitStartPrice(uint256 seasonId, uint256 fixtureId, uint256 homePrice, uint256 awayPrice)
        external
        onlyBackend
    {
        if (homePrice == 0 || awayPrice == 0) revert InvalidPrice();
        uint256 gid = StockSeasonMath.globalFixtureId(seasonId, fixtureId);
        Snapshot storage s = snapshots[gid];
        if (s.startSubmitted) revert StartAlreadySubmitted(seasonId, fixtureId);

        s.homeStart = homePrice;
        s.awayStart = awayPrice;
        s.startSubmitted = true;

        emit StartPriceSubmitted(seasonId, fixtureId, homePrice, awayPrice);
    }

    /// @notice Submitted at kickoff + 3600s. Computes each team's raw % move
    /// in basis points, converts to goals at 5 bps per goal (half-up),
    /// normalizes the scoreline so neither side is negative, caps each
    /// side at 10 goals, trips the circuit breaker flag if either raw move
    /// exceeded 3%, determines the outcome, and pushes the result onward
    /// to StockResultEngine in the same transaction.
    function submitEndPrice(uint256 seasonId, uint256 fixtureId, uint256 homePrice, uint256 awayPrice)
        external
        onlyBackend
    {
        if (homePrice == 0 || awayPrice == 0) revert InvalidPrice();
        uint256 gid = StockSeasonMath.globalFixtureId(seasonId, fixtureId);
        Snapshot storage s = snapshots[gid];
        if (!s.startSubmitted) revert StartNotSubmitted(seasonId, fixtureId);
        if (s.endSubmitted) revert EndAlreadySubmitted(seasonId, fixtureId);

        s.homeEnd = homePrice;
        s.awayEnd = awayPrice;
        s.endSubmitted = true;

        int256 homeRawBps = _rawBps(s.homeStart, homePrice);
        int256 awayRawBps = _rawBps(s.awayStart, awayPrice);

        if (homeRawBps > StockConstants.VOLATILE_CAP_BPS || homeRawBps < -StockConstants.VOLATILE_CAP_BPS
            || awayRawBps > StockConstants.VOLATILE_CAP_BPS || awayRawBps < -StockConstants.VOLATILE_CAP_BPS)
        {
            volatileSpike[gid] = true;
            emit CircuitBreakerTripped(seasonId, fixtureId, homeRawBps, awayRawBps);
        }

        int16 homeRaw = _bpsToGoals(homeRawBps);
        int16 awayRaw = _bpsToGoals(awayRawBps);

        (int16 homeGoals, int16 awayGoals) = _normalizeScoreline(homeRaw, awayRaw);

        StockOutcome outcome;
        if (homeGoals > awayGoals) {
            outcome = StockOutcome.WinHome;
        } else if (awayGoals > homeGoals) {
            outcome = StockOutcome.WinAway;
        } else {
            outcome = StockOutcome.Draw;
        }

        emit EndPriceSubmitted(seasonId, fixtureId, homePrice, awayPrice, homeGoals, awayGoals, outcome);

        resultEngine.recordResult(seasonId, fixtureId, outcome, homeGoals, awayGoals);
    }

    /// @notice Backend submits every team's current NAV price once per hour.
    /// The slot is floored to the hour from block.timestamp, so retries
    /// within the same hour are idempotent overwrites (latest wins).
    /// Prunes the slot that just fell out of the 30-day retention window.
    function submitCheckpoints(uint16[] calldata teamIds, uint256[] calldata prices)
        external
        onlyBackend
    {
        if (teamIds.length != prices.length) {
            revert CheckpointLengthMismatch(teamIds.length, prices.length);
        }
        uint64 hourTs = uint64((block.timestamp / StockConstants.CHECKPOINT_INTERVAL) * StockConstants.CHECKPOINT_INTERVAL);

        for (uint256 i = 0; i < teamIds.length; i++) {
            if (prices[i] == 0) revert InvalidPrice();
            checkpoints[teamIds[i]][hourTs] = prices[i];

            uint64 retentionSeconds = StockConstants.CHECKPOINT_RETENTION_HOURS * StockConstants.CHECKPOINT_INTERVAL;
            if (hourTs >= retentionSeconds) {
                delete checkpoints[teamIds[i]][hourTs - retentionSeconds];
            }
        }

        emit CheckpointsSubmitted(hourTs, uint16(teamIds.length));
    }

    /// @notice Owner-only backfill of hourly checkpoints (e.g. at launch,
    /// so outright-style markets with lookback windows can resolve without
    /// waiting for fresh history). Every timestamp must be hour-aligned
    /// and every price non-zero.
    function importCheckpoints(
        uint16[] calldata teamIds,
        uint64[] calldata hourTimestamps,
        uint256[] calldata prices
    ) external onlyOwner {
        if (teamIds.length != hourTimestamps.length || teamIds.length != prices.length) {
            revert CheckpointLengthMismatch(teamIds.length, prices.length);
        }
        for (uint256 i = 0; i < teamIds.length; i++) {
            if (hourTimestamps[i] % StockConstants.CHECKPOINT_INTERVAL != 0) {
                revert CheckpointNotHourAligned(hourTimestamps[i]);
            }
            if (prices[i] == 0) revert InvalidPrice();
            checkpoints[teamIds[i]][hourTimestamps[i]] = prices[i];
        }
    }

    /// @notice Price of `teamId` at time `timestamp`: the latest checkpoint
    /// at or before `timestamp`. Walks back over gaps (up to 48 hourly
    /// steps) so short backend outages don't void lookups; returns
    /// found=false when no checkpoint exists in the window.
    function getPriceAt(uint16 teamId, uint64 timestamp)
        external
        view
        returns (bool found, uint256 price)
    {
        uint64 hourTs = uint64((timestamp / StockConstants.CHECKPOINT_INTERVAL) * StockConstants.CHECKPOINT_INTERVAL);
        for (uint64 i = 0; i < StockConstants.CHECKPOINT_MAX_LOOKBACK; i++) {
            uint256 p = checkpoints[teamId][hourTs];
            if (p != 0) return (true, p);
            if (hourTs < StockConstants.CHECKPOINT_INTERVAL) break;
            unchecked {
                hourTs -= StockConstants.CHECKPOINT_INTERVAL;
            }
        }
        return (false, 0);
    }

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
        Snapshot storage s = snapshots[StockSeasonMath.globalFixtureId(seasonId, fixtureId)];
        return (s.endSubmitted, s.homeStart, s.awayStart, s.homeEnd, s.awayEnd);
    }

    /// @notice Raw % change in basis points (signed). Kept separate from
    /// the goals conversion so the circuit breaker can inspect the raw
    /// move before any rounding or capping.
    function _rawBps(uint256 startPrice, uint256 endPrice) internal pure returns (int256) {
        int256 delta = int256(endPrice) - int256(startPrice);
        return (delta * 10_000) / int256(startPrice);
    }

    /// @notice Converts a raw basis-point move to goals on the banded
    /// scale (see StockConstants): the absolute move's band decides the
    /// goals and the sign is preserved for the no-negative normalization
    /// below. Examples: +9 bps = 0 goals, +10 bps = 1, +50 bps = 2,
    /// +168 bps = 4, +563 bps = 5, +900 bps = 7, -57 bps = -2 goals.
    /// There is no cap: past the 6-goal band, each full extra 300 bps
    /// adds one more goal.
    function _bpsToGoals(int256 bps) internal pure returns (int16) {
        uint256 magnitude = bps >= 0 ? uint256(bps) : uint256(-bps);
        uint256 goals;
        if (magnitude < StockConstants.GOAL_BAND_1_BPS) {
            goals = 0;
        } else if (magnitude < StockConstants.GOAL_BAND_2_BPS) {
            goals = 1;
        } else if (magnitude < StockConstants.GOAL_BAND_3_BPS) {
            goals = 2;
        } else if (magnitude < StockConstants.GOAL_BAND_4_BPS) {
            goals = 3;
        } else if (magnitude < StockConstants.GOAL_BAND_5_BPS) {
            goals = 4;
        } else if (magnitude < StockConstants.GOAL_BAND_6_BPS) {
            goals = 5;
        } else {
            goals = 6 + (magnitude - StockConstants.GOAL_BAND_6_BPS) / StockConstants.GOAL_TAIL_STEP_BPS;
        }
        int16 signed = int16(int256(goals));
        return bps < 0 ? -signed : signed;
    }

    /// @notice Removes negative scorelines: each side's negative goals are
    /// transferred to the opponent as plus-goals. Margin-preserving:
    /// homeGoals - awayGoals == homeRaw - awayRaw in all four sign cases.
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

    /// @notice Pure helper exposed for tests and off-chain tooling: the
    /// scoreline a (homeBps, awayBps) pair of raw moves produces, after
    /// the banded conversion and no-negative normalization. No cap is
    /// applied at any step.
    function previewScoreline(int256 homeBps, int256 awayBps)
        external
        pure
        returns (int16 homeGoals, int16 awayGoals)
    {
        (homeGoals, awayGoals) = _normalizeScoreline(_bpsToGoals(homeBps), _bpsToGoals(awayBps));
    }

    function getSnapshot(uint256 seasonId, uint256 fixtureId) external view returns (Snapshot memory) {
        return snapshots[StockSeasonMath.globalFixtureId(seasonId, fixtureId)];
    }
}

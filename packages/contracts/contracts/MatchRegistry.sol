// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { TeamRegistry } from "./TeamRegistry.sol";
import { Fixture } from "./interfaces/ITickr.sol";

/// @title MatchRegistry — TICKR fixture list & kickoff reveal (per-season)
///
/// @notice Redeployed fresh for each season (see SeasonRegistry) so a new
/// roster/fixture list can start clean. Two responsibilities:
///
/// 1. FIXTURE GENERATION — a full home-and-away round robin for the
///    registered team roster, generated deterministically on-chain via the
///    "circle method" scheduling algorithm. Run once, by the owner, after
///    TeamRegistry is deployed and populated.
///
/// 2. KICKOFF REVEAL — backend-signed, not VRF-based. Design note: earlier
///    versions of this contract used Chainlink VRF so that literally nobody
///    (not even the backend/admin) could know a match's kickoff time before
///    the oracle generated it live. That was replaced with a simpler
///    backend-signed reveal for two reasons: (1) PriceOracle already
///    requires trusting a single backend signer for match RESULTS — that
///    signer effectively decides who wins every match — so having that same
///    trusted party also pick the kickoff time doesn't introduce a new
///    trust assumption, it just extends the one that already exists; and
///    (2) it removes the Chainlink VRF subscription, LINK funding, and
///    per-match request cost entirely. The contract still enforces the
///    *shape* of the fairness rule on-chain (30-120 min lead time, must
///    land inside the matchday window) even though it trusts the backend
///    to pick the specific value — defense in depth, not blind trust.
contract MatchRegistry is Ownable {
    // --- Config (mirrors packages/shared/src/constants.ts) ---
    uint256 public constant KICKOFF_LEAD_MIN_SECONDS = 30 minutes;
    uint256 public constant KICKOFF_LEAD_MAX_SECONDS = 120 minutes;

    TeamRegistry public immutable teamRegistry;

    /// @notice The address authorized to reveal kickoff times. Same trust
    /// tier as PriceOracle.backendSigner — recommended to actually BE the
    /// same signer address in production for operational simplicity.
    address public backendSigner;

    // Fixture storage
    mapping(uint256 => Fixture) private _fixtures;
    uint256 public fixtureCount;
    mapping(uint8 => uint256[]) public fixturesByMatchday; // matchdayIndex => fixtureIds
    bool public scheduleGenerated;

    // Batched schedule generation state (generateScheduleBatch)
    uint8 public matchdaysGenerated; // contiguous count from matchday 0
    uint64 public seasonStartTimestamp; // pinned on the first batch
    uint64 public matchdayIntervalSeconds; // pinned on the first batch

    // Wired post-deploy (avoids circular constructor dependencies)
    address public resultEngine;
    bool public resultEngineSet;

    event ScheduleGenerated(uint256 fixtureCount, uint8 matchdayCount, uint64 seasonStart);
    event MatchdaysGenerated(uint8 startMatchday, uint8 matchdayCount, uint8 totalGenerated);
    event KickoffRevealed(uint256 indexed fixtureId, uint64 kickoffTimestamp);
    event FixtureSettled(uint256 indexed fixtureId);
    event BackendSignerUpdated(address indexed newSigner);

    error ScheduleAlreadyGenerated();
    error InvalidBatchRange(uint8 startMatchday, uint8 matchdayCount);
    error NonContiguousBatch(uint8 expectedStart, uint8 gotStart);
    error BatchParameterMismatch();
    error TeamCountMustBeEvenAndNonZero();
    error InvalidFixtureId(uint256 fixtureId);
    error KickoffAlreadyRevealed(uint256 fixtureId);
    error OutsideMatchdayWindow(uint256 fixtureId, uint64 windowStart, uint64 windowEnd);
    error KickoffOutsideLeadTimeBounds(uint64 provided, uint64 minAllowed, uint64 maxAllowed);
    error OnlyBackendSigner();
    error OnlyResultEngine();
    error ResultEngineAlreadySet();
    error AlreadySettled(uint256 fixtureId);

    modifier onlyBackend() {
        if (msg.sender != backendSigner) revert OnlyBackendSigner();
        _;
    }

    modifier onlyResultEngine() {
        if (msg.sender != resultEngine) revert OnlyResultEngine();
        _;
    }

    constructor(address initialOwner, address teamRegistryAddress, address _backendSigner)
        Ownable(initialOwner)
    {
        teamRegistry = TeamRegistry(teamRegistryAddress);
        backendSigner = _backendSigner;
    }

    function setResultEngine(address _resultEngine) external onlyOwner {
        if (resultEngineSet) revert ResultEngineAlreadySet();
        resultEngine = _resultEngine;
        resultEngineSet = true;
    }

    function setBackendSigner(address newSigner) external onlyOwner {
        backendSigner = newSigner;
        emit BackendSignerUpdated(newSigner);
    }

    // =========================================================================
    // FIXTURE GENERATION — circle-method round robin
    // =========================================================================

    /// @notice Generates the fixture schedule IN BATCHES. A full 380-fixture
    /// season exceeds per-transaction gas limits, so generation is split
    /// across multiple transactions — e.g. 2 matchdays (20 fixtures) per
    /// call. Batches must be contiguous starting from matchday 0; the
    /// schedule is complete when every matchday is generated, at which point
    /// scheduleGenerated flips true and no further batches are accepted.
    /// Fixture indices are deterministic (first half occupies the low
    /// indices, second half the high ones), so the final schedule is
    /// identical regardless of batch sizing. Season timing params are
    /// pinned on the first batch and must match on later ones.
    /// @param _seasonStartTimestamp When matchday 0's window opens.
    /// @param _matchdayIntervalSeconds How long each matchday's window stays
    /// open for (during which its fixtures' kickoffs can be individually
    /// revealed). A week (604800) is a reasonable default.
    /// @param startMatchday First matchday in this batch (must equal the
    /// number of matchdays generated so far).
    /// @param matchdayCount How many consecutive matchdays to generate.
    function generateScheduleBatch(
        uint64 _seasonStartTimestamp,
        uint64 _matchdayIntervalSeconds,
        uint8 startMatchday,
        uint8 matchdayCount
    ) external onlyOwner {
        if (scheduleGenerated) revert ScheduleAlreadyGenerated();

        uint16 n = teamRegistry.teamCount();
        if (n == 0 || n % 2 != 0) revert TeamCountMustBeEvenAndNonZero();

        uint16 roundsPerHalf = n - 1;
        uint8 totalMatchdays = uint8(roundsPerHalf * 2);
        uint8 endMatchday = startMatchday + matchdayCount;

        if (matchdayCount == 0 || endMatchday > totalMatchdays) {
            revert InvalidBatchRange(startMatchday, matchdayCount);
        }
        if (startMatchday != matchdaysGenerated) {
            revert NonContiguousBatch(matchdaysGenerated, startMatchday);
        }

        if (matchdaysGenerated == 0) {
            seasonStartTimestamp = _seasonStartTimestamp;
            matchdayIntervalSeconds = _matchdayIntervalSeconds;
        } else if (
            _seasonStartTimestamp != seasonStartTimestamp
                || _matchdayIntervalSeconds != matchdayIntervalSeconds
        ) {
            revert BatchParameterMismatch();
        }

        // Walk the circle-method rotation round by round (memory only),
        // persisting only the matchdays inside this batch. The per-round
        // work lives in _storeBatchRound so each function stays under the
        // EVM's 16-slot stack reach.
        uint16[] memory arr = new uint16[](n);
        for (uint16 i = 0; i < n; i++) {
            arr[i] = i;
        }

        for (uint16 round = 0; round < roundsPerHalf; round++) {
            _storeBatchRound(arr, n, roundsPerHalf, round, startMatchday, endMatchday);
            _rotate(arr, n);
        }

        matchdaysGenerated = endMatchday;
        emit MatchdaysGenerated(startMatchday, matchdayCount, matchdaysGenerated);

        if (endMatchday == totalMatchdays) {
            fixtureCount = uint256(roundsPerHalf) * (n / 2) * 2;
            scheduleGenerated = true;
            emit ScheduleGenerated(fixtureCount, totalMatchdays, seasonStartTimestamp);
        }
    }

    /// @dev Stores one round's fixtures that fall inside the batch window —
    /// the first-leg round and/or its mirrored second leg. Fixture indices
    /// are deterministic (first half occupies the low indices, second half
    /// the high ones), so the final schedule is identical regardless of
    /// batch sizing.
    function _storeBatchRound(
        uint16[] memory arr,
        uint16 n,
        uint16 roundsPerHalf,
        uint16 round,
        uint8 startMatchday,
        uint8 endMatchday
    ) private {
        uint16 pairsPerRound = n / 2;

        if (round >= startMatchday && round < endMatchday) {
            _storeLeg(arr, n, pairsPerRound, round, uint8(round), uint256(round) * pairsPerRound, false);
        }

        uint8 mirrorMatchday = uint8(uint16(round) + roundsPerHalf);
        if (mirrorMatchday >= startMatchday && mirrorMatchday < endMatchday) {
            _storeLeg(
                arr,
                n,
                pairsPerRound,
                round,
                mirrorMatchday,
                uint256(roundsPerHalf) * pairsPerRound + uint256(round) * pairsPerRound,
                true
            );
        }
    }

    /// @dev Stores one leg's pairings for a single round, starting at
    /// `baseFixtureId`. When `swapHome` is true the home/away sides are
    /// swapped, producing the mirrored second leg of the same pairing.
    function _storeLeg(
        uint16[] memory arr,
        uint16 n,
        uint16 pairsPerRound,
        uint16 round,
        uint8 matchdayIndex,
        uint256 baseFixtureId,
        bool swapHome
    ) private {
        for (uint16 i = 0; i < pairsPerRound; i++) {
            // Circle method: teamA = arr[i], its partner = arr[n-1-i]
            // from the opposite end of the rotating array. Alternate
            // which side is home each round so no team is permanently at
            // home — even rounds put teamA home, odd rounds swap; the
            // mirrored leg swaps unconditionally.
            bool teamAHome = (round % 2 == 0) != swapHome;
            uint16 homeIdx = teamAHome ? i : n - 1 - i;
            uint16 awayIdx = teamAHome ? n - 1 - i : i;

            _storeFixture(baseFixtureId + i, arr[homeIdx], arr[awayIdx], matchdayIndex);
        }
    }

    /// @dev Circle-method rotation: hold position 0, move the last element
    /// to position 1, shift the rest right.
    function _rotate(uint16[] memory arr, uint16 n) private pure {
        uint16 last = arr[n - 1];
        for (uint16 k = n - 1; k >= 2; k--) {
            arr[k] = arr[k - 1];
        }
        arr[1] = last;
    }

    /// @dev Persists one fixture. Season timing is read from the pinned
    /// state set by the first generateScheduleBatch call.
    function _storeFixture(
        uint256 fixtureId,
        uint16 home,
        uint16 away,
        uint8 matchdayIndex
    ) private {
        uint64 windowStart = seasonStartTimestamp + (uint64(matchdayIndex) * matchdayIntervalSeconds);
        uint64 windowEnd = windowStart + matchdayIntervalSeconds;

        _fixtures[fixtureId] = Fixture({
            homeTeamId: home,
            awayTeamId: away,
            matchdayIndex: matchdayIndex,
            windowStart: windowStart,
            windowEnd: windowEnd,
            kickoffTimestamp: 0,
            kickoffRevealed: false,
            settled: false
        });

        fixturesByMatchday[matchdayIndex].push(fixtureId);
    }

    // =========================================================================
    // KICKOFF REVEAL — backend-signed, bounds enforced on-chain
    // =========================================================================

    /// @notice Backend calls this once per fixture, at the moment it wants
    /// to reveal that match's kickoff time. The contract enforces that the
    /// revealed timestamp is 30-120 minutes in the future from right now,
    /// and falls within the fixture's matchday window — the backend picks
    /// WHICH value within those bounds, but cannot cheat the bounds
    /// themselves, and cannot reveal a fixture twice.
    function revealKickoff(uint256 fixtureId, uint64 kickoffTimestamp) external onlyBackend {
        if (fixtureId >= fixtureCount) revert InvalidFixtureId(fixtureId);
        Fixture storage f = _fixtures[fixtureId];
        if (f.kickoffRevealed) revert KickoffAlreadyRevealed(fixtureId);

        uint64 minAllowed = uint64(block.timestamp) + uint64(KICKOFF_LEAD_MIN_SECONDS);
        uint64 maxAllowed = uint64(block.timestamp) + uint64(KICKOFF_LEAD_MAX_SECONDS);
        if (kickoffTimestamp < minAllowed || kickoffTimestamp > maxAllowed) {
            revert KickoffOutsideLeadTimeBounds(kickoffTimestamp, minAllowed, maxAllowed);
        }
        if (kickoffTimestamp < f.windowStart || kickoffTimestamp > f.windowEnd) {
            revert OutsideMatchdayWindow(fixtureId, f.windowStart, f.windowEnd);
        }

        f.kickoffRevealed = true;
        f.kickoffTimestamp = kickoffTimestamp;

        emit KickoffRevealed(fixtureId, kickoffTimestamp);
    }

    // =========================================================================
    // VIEWS & RESULT-ENGINE HOOK
    // =========================================================================

    function getFixture(uint256 fixtureId) external view returns (Fixture memory) {
        if (fixtureId >= fixtureCount) revert InvalidFixtureId(fixtureId);
        return _fixtures[fixtureId];
    }

    function getFixturesByMatchday(uint8 matchdayIndex) external view returns (uint256[] memory) {
        return fixturesByMatchday[matchdayIndex];
    }

    /// @notice Betting stays open until the kickoff moment is both revealed
    /// AND has arrived. Before reveal, betting is always open. After
    /// reveal, it closes the instant kickoffTimestamp is reached.
    function isBettingOpen(uint256 fixtureId) external view returns (bool) {
        if (fixtureId >= fixtureCount) revert InvalidFixtureId(fixtureId);
        Fixture memory f = _fixtures[fixtureId];
        if (f.settled) return false;
        if (f.kickoffTimestamp == 0) return true;
        return block.timestamp < f.kickoffTimestamp;
    }

    function markSettled(uint256 fixtureId) external onlyResultEngine {
        if (fixtureId >= fixtureCount) revert InvalidFixtureId(fixtureId);
        if (_fixtures[fixtureId].settled) revert AlreadySettled(fixtureId);
        _fixtures[fixtureId].settled = true;
        emit FixtureSettled(fixtureId);
    }
}

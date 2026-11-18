// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { StockConstants, StockFixtureStatus } from "./StockConstants.sol";

/// @notice Minimal read surface of StockTeamRegistry used by this contract.
interface IStockTeamRegistry {
    function teamCount() external view returns (uint16);
}

/// @notice Stock fixture. Same fields as the crypto Fixture, plus `voided`:
/// a fixture voided under the both-teams-no-performance rule is settled
/// for betting purposes (stakes refunded 1:1) but must never count as a
/// played match in the table.
struct StockFixture {
    uint16 homeTeamId;
    uint16 awayTeamId;
    uint8 matchdayIndex; // 0..21 (round index; see double-header note below)
    uint64 windowStart; // matchday window opens
    uint64 windowEnd; // matchday window closes
    uint64 kickoffTimestamp; // 0 until backend-revealed
    bool kickoffRevealed;
    bool settled;
    bool voided;
    uint64 matchEndTimestamp; // pinned at reveal = kickoff + 3600
}

/// @title StockMatchRegistry - TICKR Stock League fixtures and kickoff reveal
///
/// @notice Fresh stack, parallel to the crypto league, NOT Season 3.
/// Two responsibilities, copied from crypto MatchRegistry and adapted:
///
/// 1. FIXTURE GENERATION - a DOUBLE round-robin for the 12-team roster,
///    generated deterministically on-chain via the circle method with a
///    mirrored second leg. Crypto plays home-and-away over 38 matchdays;
///    the stock league plays home-and-away over 22 rounds: rounds 1-11
///    (matchdayIndex 0-10) are the first leg, rounds 12-22
///    (matchdayIndex 11-21) repeat every pairing with home and away
///    swapped. 6 fixtures per round, 132 fixtures total. Generation is
///    batched (a full season exceeds per-transaction gas limits) and
///    resumable.
///    DOUBLE-HEADER FINALE: Nov 26 to Dec 16 2026 inclusive is 21 days,
///    so 22 rounds need one double-header day. Dec 16 hosts rounds 21
///    and 22 (matchdayIndex 20 and 21) in two waves, morning and
///    evening, 12 fixtures that day. Both rounds share the Dec 16
///    matchday window: the window day offset is min(matchdayIndex, 20),
///    so matchdayIndex 21 opens Dec 16 00:00 UTC, not Dec 17. Kickoff
///    reveal still staggers the two waves inside that shared window
///    (30-120 minute lead, enforced on-chain).
///
/// 2. KICKOFF REVEAL - backend-signed, same trust model as crypto: the
///    backend signer already decides results via the price oracle, so
///    letting it pick kickoff times adds no new trust assumption. The
///    contract enforces the shape on-chain (30-120 min lead, inside the
///    matchday window). Match end is pinned at reveal (kickoff + 3600s)
///    so the in-play betting window can never be moved under live bettors.
///
/// @dev STOCK DIFFERENCES FROM CRYPTO MatchRegistry:
///   - Double round-robin (22 rounds, 132 fixtures), mirrored second leg.
///   - Matchday interval is 1 day (86400s): a matchday lasts 1 day, all
///     its matches end the same day, except the Dec 16 double-header,
///     when rounds 21 and 22 share one day in two waves. Season Nov 26
///     to Dec 16 2026.
///   - Match duration is fixed at 3600s (no owner setter: the stock
///     league is locked to 1-hour matches for Season 1).
///   - `voided` flag plus markVoided(), so the ResultEngine can void a
///     fixture where both teams had no performance. A voided fixture is
///     closed for betting and excluded from the table.
///   - UUPS upgradeable, owner-only upgrades. initialize() replaces the
///     constructor; teamRegistry is stored (not immutable) for that reason.
contract StockMatchRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    IStockTeamRegistry public teamRegistry;

    /// @notice Backend signer authorized to reveal kickoff times. Same
    /// trust tier as StockPriceOracle.backendSigner; recommended to BE the
    /// same signer address in production.
    address public backendSigner;

    /// @notice Fixed 1-hour match length (StockConstants.MATCH_DURATION_SECONDS).
    uint64 public matchDurationSeconds;

    mapping(uint256 => StockFixture) private _fixtures;
    uint256 public fixtureCount;
    mapping(uint8 => uint256[]) public fixturesByMatchday; // matchdayIndex => fixtureIds
    bool public scheduleGenerated;

    uint8 public matchdaysGenerated; // contiguous count from matchday 0
    uint64 public seasonStartTimestamp; // pinned on the first batch
    uint64 public matchdayIntervalSeconds; // pinned on the first batch

    address public resultEngine;
    bool public resultEngineSet;

    /// @notice Reserved storage for future upgrades. Never remove or reorder.
    uint256[48] private __gap;

    event ScheduleGenerated(uint256 fixtureCount, uint8 matchdayCount, uint64 seasonStart);
    event MatchdaysGenerated(uint8 startMatchday, uint8 matchdayCount, uint8 totalGenerated);
    event KickoffRevealed(uint256 indexed fixtureId, uint64 kickoffTimestamp);
    event FixtureSettled(uint256 indexed fixtureId);
    event FixtureVoided(uint256 indexed fixtureId);
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
    error AlreadyVoided(uint256 fixtureId);
    error InvalidMatchDuration(uint64 durationSeconds);

    modifier onlyBackend() {
        if (msg.sender != backendSigner) revert OnlyBackendSigner();
        _;
    }

    modifier onlyResultEngine() {
        if (msg.sender != resultEngine) revert OnlyResultEngine();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer, called through the proxy by the deploy
    /// script. matchDurationSeconds must equal
    /// StockConstants.MATCH_DURATION_SECONDS (3600) for Season 1.
    function initialize(
        address initialOwner,
        address teamRegistryAddress,
        address _backendSigner,
        uint64 _matchDurationSeconds
    ) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        if (_matchDurationSeconds == 0) revert InvalidMatchDuration(_matchDurationSeconds);
        teamRegistry = IStockTeamRegistry(teamRegistryAddress);
        backendSigner = _backendSigner;
        matchDurationSeconds = _matchDurationSeconds;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @notice One-time wiring after StockResultEngine is deployed.
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
    // FIXTURE GENERATION - circle-method DOUBLE round robin (mirrored second leg)
    // =========================================================================

    /// @notice Generates the fixture schedule IN BATCHES. 132 fixtures
    /// exceed per-transaction gas limits, so generation is split across
    /// multiple transactions, e.g. 3 matchdays (18 fixtures) per call.
    /// Batches must be contiguous starting from matchday 0; the schedule
    /// is complete when all 22 matchdays are generated, at which point
    /// scheduleGenerated flips true and no further batches are accepted.
    /// Fixture indices are deterministic, so the final schedule is
    /// identical regardless of batch sizing. Season timing params are
    /// pinned on the first batch and must match on later ones.
    /// @param _seasonStartTimestamp When matchday 0's window opens
    ///   (Nov 26 2026 00:00 UTC = 1795651200).
    /// @param _matchdayIntervalSeconds How long each matchday's window stays
    ///   open (86400 = 1 day for the stock league).
    /// @param startMatchday First matchday in this batch (must equal the
    ///   number of matchdays generated so far).
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
        if (n != StockConstants.TEAM_COUNT) revert TeamCountMustBeEvenAndNonZero();

        uint16 rounds = 2 * (n - 1); // double round-robin: 22 rounds
        uint8 totalMatchdays = uint8(rounds);
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

        uint16[] memory arr = new uint16[](n);
        for (uint16 i = 0; i < n; i++) {
            arr[i] = i;
        }

        for (uint16 round = 0; round < rounds; round++) {
            if (round >= startMatchday && round < endMatchday) {
                // Second leg (rounds 11-21) mirrors the first leg
                // (rounds 0-10): same pairings, home and away swapped.
                // The circle rotation has period n - 1 = 11, so after
                // 11 rotations `arr` is back to its starting order and
                // the second leg replays the first leg pairings exactly.
                bool mirrored = round >= (n - 1);
                _storeRound(arr, n, round, uint8(round), uint256(round) * (n / 2), mirrored);
            }
            _rotate(arr, n);
        }

        matchdaysGenerated = endMatchday;
        emit MatchdaysGenerated(startMatchday, matchdayCount, matchdaysGenerated);

        if (endMatchday == totalMatchdays) {
            fixtureCount = uint256(rounds) * (n / 2);
            scheduleGenerated = true;
            emit ScheduleGenerated(fixtureCount, totalMatchdays, seasonStartTimestamp);
        }
    }

    /// @dev Stores one round's pairings. Circle method: teamA = arr[i],
    /// its partner = arr[n-1-i] from the opposite end. Alternate which side
    /// is home each round so no team is permanently at home. When
    /// `mirrored` is true (second leg), home and away are swapped
    /// relative to the first-leg pairing, so every pairing is played
    /// once at each team's home. The home alternation uses the
    /// within-leg round (round % (n - 1)), NOT the absolute round:
    /// round 11 replays round 0, and if the absolute parity were used
    /// the odd-round flip plus the mirror swap would cancel out and
    /// the second leg would repeat the first leg's home team.
    function _storeRound(
        uint16[] memory arr,
        uint16 n,
        uint16 round,
        uint8 matchdayIndex,
        uint256 baseFixtureId,
        bool mirrored
    ) private {
        uint16 pairsPerRound = n / 2;
        uint16 legRound = round % (n - 1); // 0-10 in both legs
        for (uint16 i = 0; i < pairsPerRound; i++) {
            bool teamAHome = (legRound % 2 == 0);
            uint16 homeIdx = teamAHome ? i : n - 1 - i;
            uint16 awayIdx = teamAHome ? n - 1 - i : i;
            if (mirrored) {
                (homeIdx, awayIdx) = (awayIdx, homeIdx);
            }
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

    function _storeFixture(uint256 fixtureId, uint16 home, uint16 away, uint8 matchdayIndex) private {
        // Double-header finale: matchdayIndex 21 (round 22) shares the
        // Dec 16 window with matchdayIndex 20 (round 21). The window day
        // offset is capped at SEASON_DAY_COUNT - 1 = 20, so round 22
        // opens Dec 16 00:00 UTC, not Dec 17. Rounds 0-20 map 1:1 to
        // Nov 26-Dec 16. Kickoff reveal staggers the two Dec 16 waves
        // inside the shared window.
        uint64 dayOffset = matchdayIndex > StockConstants.SEASON_DAY_COUNT - 1
            ? uint64(StockConstants.SEASON_DAY_COUNT - 1)
            : uint64(matchdayIndex);
        uint64 windowStart = seasonStartTimestamp + (dayOffset * matchdayIntervalSeconds);
        uint64 windowEnd = windowStart + matchdayIntervalSeconds;

        _fixtures[fixtureId] = StockFixture({
            homeTeamId: home,
            awayTeamId: away,
            matchdayIndex: matchdayIndex,
            windowStart: windowStart,
            windowEnd: windowEnd,
            kickoffTimestamp: 0,
            kickoffRevealed: false,
            settled: false,
            voided: false,
            matchEndTimestamp: 0
        });

        fixturesByMatchday[matchdayIndex].push(fixtureId);
    }

    // =========================================================================
    // KICKOFF REVEAL - backend-signed, bounds enforced on-chain
    // =========================================================================

    /// @notice Backend calls this once per fixture, at the moment it wants
    /// to reveal that match's kickoff time. Enforced: revealed timestamp
    /// is 30-120 minutes in the future from right now, and falls within
    /// the fixture's matchday window. The match end is pinned here
    /// (kickoff + 3600s) and drives the in-play betting window.
    function revealKickoff(uint256 fixtureId, uint64 kickoffTimestamp) external onlyBackend {
        if (fixtureId >= fixtureCount) revert InvalidFixtureId(fixtureId);
        StockFixture storage f = _fixtures[fixtureId];
        if (f.kickoffRevealed) revert KickoffAlreadyRevealed(fixtureId);

        uint64 minAllowed = uint64(block.timestamp) + uint64(StockConstants.KICKOFF_LEAD_MIN_SECONDS);
        uint64 maxAllowed = uint64(block.timestamp) + uint64(StockConstants.KICKOFF_LEAD_MAX_SECONDS);
        if (kickoffTimestamp < minAllowed || kickoffTimestamp > maxAllowed) {
            revert KickoffOutsideLeadTimeBounds(kickoffTimestamp, minAllowed, maxAllowed);
        }
        if (kickoffTimestamp < f.windowStart || kickoffTimestamp > f.windowEnd) {
            revert OutsideMatchdayWindow(fixtureId, f.windowStart, f.windowEnd);
        }

        f.kickoffRevealed = true;
        f.kickoffTimestamp = kickoffTimestamp;
        f.matchEndTimestamp = kickoffTimestamp + matchDurationSeconds;

        emit KickoffRevealed(fixtureId, kickoffTimestamp);
    }

    // =========================================================================
    // VIEWS AND RESULT-ENGINE HOOKS
    // =========================================================================

    function getFixture(uint256 fixtureId) external view returns (StockFixture memory) {
        if (fixtureId >= fixtureCount) revert InvalidFixtureId(fixtureId);
        return _fixtures[fixtureId];
    }

    function getFixturesByMatchday(uint8 matchdayIndex) external view returns (uint256[] memory) {
        return fixturesByMatchday[matchdayIndex];
    }

    /// @notice In-play betting: open until the pinned match end minus the
    /// 5-minute close buffer. Before reveal, betting is always open.
    /// Settled and voided fixtures are always closed.
    function isBettingOpen(uint256 fixtureId) external view returns (bool) {
        if (fixtureId >= fixtureCount) revert InvalidFixtureId(fixtureId);
        StockFixture memory f = _fixtures[fixtureId];
        if (f.settled || f.voided) return false;
        if (f.kickoffTimestamp == 0) return true;
        return block.timestamp + StockConstants.INPLAY_CLOSE_BUFFER_SECONDS < f.matchEndTimestamp;
    }

    /// @notice Current status of a fixture for backend and frontend reads.
    function getFixtureStatus(uint256 fixtureId) external view returns (StockFixtureStatus) {
        if (fixtureId >= fixtureCount) revert InvalidFixtureId(fixtureId);
        StockFixture memory f = _fixtures[fixtureId];
        if (f.voided) return StockFixtureStatus.Voided;
        if (f.settled) return StockFixtureStatus.Settled;
        return StockFixtureStatus.Unsettled;
    }

    function markSettled(uint256 fixtureId) external onlyResultEngine {
        if (fixtureId >= fixtureCount) revert InvalidFixtureId(fixtureId);
        if (_fixtures[fixtureId].settled) revert AlreadySettled(fixtureId);
        if (_fixtures[fixtureId].voided) revert AlreadyVoided(fixtureId);
        _fixtures[fixtureId].settled = true;
        emit FixtureSettled(fixtureId);
    }

    /// @notice Marks a fixture voided (both teams had no performance for
    /// the match period). Only the ResultEngine may call this, via its
    /// recordVoid path. Voided fixtures never count in the league table.
    function markVoided(uint256 fixtureId) external onlyResultEngine {
        if (fixtureId >= fixtureCount) revert InvalidFixtureId(fixtureId);
        if (_fixtures[fixtureId].settled) revert AlreadySettled(fixtureId);
        if (_fixtures[fixtureId].voided) revert AlreadyVoided(fixtureId);
        _fixtures[fixtureId].voided = true;
        emit FixtureVoided(fixtureId);
    }
}

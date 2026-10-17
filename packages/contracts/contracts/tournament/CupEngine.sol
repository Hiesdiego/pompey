// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { CupRegistry } from "./CupRegistry.sol";

/// @title CupEngine — CRYPTO PRICE WORLD CUP scoring & settlement
///
/// @notice Brand-new cup contract. The league's ResultEngine and PriceOracle
/// are NEVER touched: the cup keeps its own price snapshots here and
/// re-implements the identical pricing math (8-decimal fixed point,
/// 1 goal = 0.5% move, half-up rounding, no-negative normalization —
/// the same standard the league's PriceOracle uses).
///
/// Call graph (mirrors the league's oracle -> engine -> registry -> pool):
///   CupEngine.submitEndPrice -> CupEngine.settleMatch
///     -> CupRegistry.recordResult + CupPool.onMatchSettled
///   On a ±30% raw price spike by either team (manipulation or black swan —
///   the DAO judges, the contract doesn't):
///     -> CupRegistry.markDisputed + DisputeBallot.openBallot
///   DisputeBallot.resolve -> CupEngine.resolveDispute
///     -> CupRegistry.recordResult + CupPool.onMatchSettled
///
/// Ties on goals break by best mover on full-precision prices
/// (integer math, deterministic). The DAO is the ONLY manipulation path.
///
/// Design note (user, 2026-10-17): the trigger is the RAW price spike, not
/// the goal margin. A big scoreline (e.g. 8-0, 16-0) can print legitimately
/// in a high-volatility hour; only a ±30% move inside the match window is
/// anomalous enough to pause settlement.
contract CupEngine is Ownable {
    /// @notice ±30% raw price move by either team inside the match window
    /// trips the breaker — regardless of the final scoreline.
    uint256 public constant CIRCUIT_BREAKER_SPIKE_BPS = 3000;
    uint16 public constant TBD = type(uint16).max;

    uint8 public constant PRICE_DECIMALS = 8;
    uint256 internal constant BPS_PER_GOAL = 50; // 1 goal = 0.5% move

    struct Snapshot {
        uint256 startA;
        uint256 startB;
        uint256 endA;
        uint256 endB;
        bool startSubmitted;
        bool endSubmitted;
    }

    CupRegistry public immutable registry;
    IDisputeBallot public disputeBallot;
    bool public disputeBallotSet;
    ICupPool public cupPool;
    bool public cupPoolSet;
    address public operator;

    mapping(uint16 => Snapshot) private _snapshots;

    event OperatorUpdated(address indexed newOperator);
    event StartPriceSubmitted(uint16 indexed matchId, uint256 priceA, uint256 priceB);
    event EndPriceSubmitted(uint16 indexed matchId, uint256 priceA, uint256 priceB, int16 goalsA, int16 goalsB);
    event MatchSettled(uint16 indexed matchId, uint16 indexed winner, int16 goalsA, int16 goalsB);
    event DisputeOpened(uint16 indexed matchId, uint16 indexed accusedTeam, int16 goalsA, int16 goalsB);
    event DisputeResolved(uint16 indexed matchId, bool manipulated, uint16 indexed winner);

    error OnlyOperator();
    error OnlyDisputeBallot();
    error DisputeBallotAlreadySet();
    error CupPoolAlreadySet();
    error WiringIncomplete();
    error InvalidMatchId(uint16 matchId);
    error InvalidState(uint16 matchId, CupRegistry.MatchState state);
    error StartAlreadySubmitted(uint16 matchId);
    error EndAlreadySubmitted(uint16 matchId);
    error StartNotSubmitted(uint16 matchId);
    error MatchNotStarted(uint16 matchId);
    error MatchNotEnded(uint16 matchId);
    error InvalidPrice();
    error TeamsNotSet(uint16 matchId);
    error TeamNotInMatch(uint16 matchId, uint16 teamId);

    modifier onlyOperator() {
        if (msg.sender != operator) revert OnlyOperator();
        _;
    }

    modifier onlyDisputeBallot() {
        if (msg.sender != address(disputeBallot)) revert OnlyDisputeBallot();
        _;
    }

    constructor(address initialOwner, address _registry, address _operator) Ownable(initialOwner) {
        registry = CupRegistry(_registry);
        operator = _operator;
    }

    /// @notice One-time wiring to the cup's own ballot and pool.
    function setDisputeBallot(address _disputeBallot) external onlyOwner {
        if (disputeBallotSet) revert DisputeBallotAlreadySet();
        disputeBallot = IDisputeBallot(_disputeBallot);
        disputeBallotSet = true;
    }

    function setCupPool(address _cupPool) external onlyOwner {
        if (cupPoolSet) revert CupPoolAlreadySet();
        cupPool = ICupPool(_cupPool);
        cupPoolSet = true;
    }

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
        emit OperatorUpdated(_operator);
    }

    // ---------------------------------------------------------------------
    // Price snapshots (8-decimal fixed point, same standard as the league)
    // ---------------------------------------------------------------------

    /// @notice Submitted the moment a match's kickoff arrives.
    function submitStartPrice(uint16 matchId, uint256 priceA, uint256 priceB) external onlyOperator {
        CupRegistry.CupMatch memory m = registry.getMatch(matchId);
        if (m.state != CupRegistry.MatchState.Open) revert InvalidState(matchId, m.state);
        if (block.timestamp < m.kickoffTimestamp) revert MatchNotStarted(matchId);
        if (priceA == 0 || priceB == 0) revert InvalidPrice();

        Snapshot storage s = _snapshots[matchId];
        if (s.startSubmitted) revert StartAlreadySubmitted(matchId);
        s.startA = priceA;
        s.startB = priceB;
        s.startSubmitted = true;

        emit StartPriceSubmitted(matchId, priceA, priceB);
    }

    /// @notice Submitted at kickoff + match duration. Computes and emits the
    /// normalized scoreline; the winner is decided in settleMatch.
    function submitEndPrice(uint16 matchId, uint256 priceA, uint256 priceB) external onlyOperator {
        CupRegistry.CupMatch memory m = registry.getMatch(matchId);
        if (m.state != CupRegistry.MatchState.Open) revert InvalidState(matchId, m.state);
        if (priceA == 0 || priceB == 0) revert InvalidPrice();

        Snapshot storage s = _snapshots[matchId];
        if (!s.startSubmitted) revert StartNotSubmitted(matchId);
        if (s.endSubmitted) revert EndAlreadySubmitted(matchId);
        if (block.timestamp < m.endTimestamp) revert MatchNotEnded(matchId);

        s.endA = priceA;
        s.endB = priceB;
        s.endSubmitted = true;

        (int16 goalsA, int16 goalsB) = _scoreline(s);
        emit EndPriceSubmitted(matchId, priceA, priceB, goalsA, goalsB);
    }

    // ---------------------------------------------------------------------
    // Settlement & circuit breaker
    // ---------------------------------------------------------------------

    /// @notice Decides the match. If either team's raw price moved ±30% or
    /// more inside the match window, the breaker trips: the registry marks
    /// the match disputed and a DisputeBallot opens — no winner is set until
    /// the DAO resolves. The goal margin is deliberately ignored here: big
    /// scorelines print legitimately in volatile hours.
    /// Otherwise the winner is recorded, advanced, and the pool settles.
    function settleMatch(uint16 matchId) external onlyOperator {
        if (!disputeBallotSet || !cupPoolSet) revert WiringIncomplete();

        CupRegistry.CupMatch memory m = registry.getMatch(matchId);
        if (m.state != CupRegistry.MatchState.Open) revert InvalidState(matchId, m.state);
        if (m.teamA == TBD || m.teamB == TBD) revert TeamsNotSet(matchId);

        Snapshot storage s = _snapshots[matchId];
        if (!s.endSubmitted) revert StartNotSubmitted(matchId);

        (int16 goalsA, int16 goalsB) = _scoreline(s);

        if (_spikeTripped(s)) {
            registry.markDisputed(matchId);
            uint16 accused = _accusedTeam(m, s, goalsA, goalsB);
            disputeBallot.openBallot(matchId, accused);
            emit DisputeOpened(matchId, accused, goalsA, goalsB);
            return;
        }

        uint16 winner = _decideWinner(m, s);
        registry.recordResult(matchId, winner, goalsA, goalsB);
        cupPool.onMatchSettled(matchId, winner, goalsA, goalsB);
        emit MatchSettled(matchId, winner, goalsA, goalsB);
    }

    /// @notice Called by the DisputeBallot after the 24h vote resolves.
    /// manipulated=false -> settle as scored. manipulated=true -> DQ the
    /// accused team; its opponent advances.
    function resolveDispute(uint16 matchId, bool manipulated, uint16 accusedTeam) external onlyDisputeBallot {
        CupRegistry.CupMatch memory m = registry.getMatch(matchId);
        if (m.state != CupRegistry.MatchState.Disputed) revert InvalidState(matchId, m.state);

        Snapshot storage s = _snapshots[matchId];
        (int16 goalsA, int16 goalsB) = _scoreline(s);

        uint16 winner;
        if (manipulated) {
            if (accusedTeam != m.teamA && accusedTeam != m.teamB) {
                revert TeamNotInMatch(matchId, accusedTeam);
            }
            winner = accusedTeam == m.teamA ? m.teamB : m.teamA;
        } else {
            winner = _decideWinner(m, s);
        }

        registry.recordResult(matchId, winner, goalsA, goalsB);
        cupPool.onMatchSettled(matchId, winner, goalsA, goalsB);
        emit DisputeResolved(matchId, manipulated, winner);
    }

    /// @notice True when either team's raw price moved ±CIRCUIT_BREAKER_SPIKE_BPS
    /// or more inside the match window — up OR down. The scoreline is not
    /// consulted: a 30% spike is anomalous whatever the goals say.
    function _spikeTripped(Snapshot storage s) private view returns (bool) {
        return _absBps(s.startA, s.endA) >= CIRCUIT_BREAKER_SPIKE_BPS
            || _absBps(s.startB, s.endB) >= CIRCUIT_BREAKER_SPIKE_BPS;
    }

    /// @notice Absolute price move in basis points, e.g. 3000 = 30%.
    function _absBps(uint256 startPrice, uint256 endPrice) private pure returns (uint256) {
        uint256 absDelta = endPrice >= startPrice ? endPrice - startPrice : startPrice - endPrice;
        return (absDelta * 10_000) / startPrice;
    }

    /// @notice The accused team is the one whose RAW price move printed the
    /// anomaly (largest absolute raw goal move) — not the normalized-score
    /// leader, since normalization turns a crash by B into goals for A.
    function _accusedTeam(
        CupRegistry.CupMatch memory m,
        Snapshot storage s,
        int16 goalsA,
        int16 goalsB
    ) private view returns (uint16) {
        int16 rawA = _roundedPercentChange(s.startA, s.endA);
        int16 rawB = _roundedPercentChange(s.startB, s.endB);
        uint16 absA = rawA >= 0 ? uint16(rawA) : uint16(-rawA);
        uint16 absB = rawB >= 0 ? uint16(rawB) : uint16(-rawB);
        if (absA != absB) return absA > absB ? m.teamA : m.teamB;
        if (goalsA != goalsB) return goalsA > goalsB ? m.teamA : m.teamB;
        return m.teamA < m.teamB ? m.teamA : m.teamB;
    }

    /// @notice Winner on goals; ties break by best mover on full-precision
    /// prices (integer math, deterministic); exact ties fall to lower teamId.
    function _decideWinner(CupRegistry.CupMatch memory m, Snapshot storage s) private view returns (uint16) {
        (int16 goalsA, int16 goalsB) = _scoreline(s);
        if (goalsA > goalsB) return m.teamA;
        if (goalsB > goalsA) return m.teamB;

        int256 moveA = (int256(s.endA) - int256(s.startA)) * int256(s.startB);
        int256 moveB = (int256(s.endB) - int256(s.startB)) * int256(s.startA);
        if (moveA != moveB) return moveA > moveB ? m.teamA : m.teamB;
        return m.teamA < m.teamB ? m.teamA : m.teamB;
    }

    // ---------------------------------------------------------------------
    // Scoring math — identical standard to the league's PriceOracle
    // ---------------------------------------------------------------------

    function _scoreline(Snapshot storage s) private view returns (int16 goalsA, int16 goalsB) {
        int16 rawA = _roundedPercentChange(s.startA, s.endA);
        int16 rawB = _roundedPercentChange(s.startB, s.endB);
        return _normalizeScoreline(rawA, rawB);
    }

    function _roundedPercentChange(uint256 startPrice, uint256 endPrice) private pure returns (int16) {
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

    function _normalizeScoreline(int16 rawA, int16 rawB)
        private
        pure
        returns (int16 goalsA, int16 goalsB)
    {
        int16 gainsA = rawA > 0 ? rawA : int16(0);
        int16 gainsB = rawB > 0 ? rawB : int16(0);
        int16 lossesA = rawA < 0 ? -rawA : int16(0);
        int16 lossesB = rawB < 0 ? -rawB : int16(0);
        goalsA = gainsA + lossesB;
        goalsB = gainsB + lossesA;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getSnapshot(uint16 matchId) external view returns (Snapshot memory) {
        return _snapshots[matchId];
    }
}

interface IDisputeBallot {
    function openBallot(uint16 matchId, uint16 accusedTeam) external returns (uint256 ballotId);
}

interface ICupPool {
    function onMatchSettled(uint16 matchId, uint16 winner, int16 goalsA, int16 goalsB) external;
}

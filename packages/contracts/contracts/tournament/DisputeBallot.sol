// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DisputeBallot — CRYPTO PRICE WORLD CUP manipulation DAO
///
/// @notice Brand-new cup contract. The ONLY manipulation-adjudication path
/// in the cup. The CupEngine opens a ballot when its circuit breaker trips
/// (final margin >= 15 goals) or when the operator flags a match
/// pre-settlement. The DAO — any TICK holder willing to pay the anti-spam
/// fee — decides; the owner cannot decide, only trigger.
///
/// Mechanics (user-locked 2026-10-17):
/// - 24-hour vote, 100 TICK fee per ballot (straight to treasury).
/// - One vote per wallet — whales cannot buy verdicts.
/// - Quorum: 5 votes (beta-sized; revisit for mainnet).
/// - Simple majority; ties and no-quorum resolve to LEGITIMATE
///   (the score stands — the onus is on challengers to show up).
/// - Verdicts: LEGITIMATE -> settle as scored; MANIPULATED -> DQ the
///   accused team, its opponent advances.
contract DisputeBallot is Ownable {
    uint256 public constant VOTE_FEE = 100 * 1e18; // 100 TICK (18 decimals)
    uint256 public constant VOTE_DURATION = 24 hours;
    uint256 public constant QUORUM = 5;

    IERC20 public immutable tick;
    address public immutable treasury;
    address public engine;

    struct Ballot {
        uint16 matchId;
        uint16 accusedTeam;
        uint64 deadline;
        uint32 votesLegitimate;
        uint32 votesManipulated;
        bool resolved;
    }

    uint256 public ballotCount;
    mapping(uint256 => Ballot) private _ballots;
    mapping(uint256 => mapping(address => bool)) private _voted;

    event BallotOpened(uint256 indexed ballotId, uint16 indexed matchId, uint16 indexed accusedTeam, uint64 deadline);
    event VoteCast(uint256 indexed ballotId, address indexed voter, bool manipulated);
    event BallotResolved(uint256 indexed ballotId, uint16 indexed matchId, bool manipulated);

    error OnlyEngine();
    error InvalidBallot(uint256 ballotId);
    error VotingClosed(uint256 ballotId);
    error AlreadyVoted(uint256 ballotId, address voter);
    error BallotAlreadyResolved(uint256 ballotId);
    error VotingStillOpen(uint256 ballotId);
    error FeeTransferFailed();

    modifier onlyEngine() {
        if (msg.sender != engine) revert OnlyEngine();
        _;
    }

    /// @notice The engine address is set at construction: ballots always
    /// trace to the cup's own engine, never to the league.
    constructor(address initialOwner, address _tick, address _treasury, address _engine) Ownable(initialOwner) {
        tick = IERC20(_tick);
        treasury = _treasury;
        engine = _engine;
    }

    /// @notice Opens a ballot. Only the cup's engine can open one — ballots
    /// always trace to a real circuit-breaker trip or operator flag.
    function openBallot(uint16 matchId, uint16 accusedTeam) external onlyEngine returns (uint256 ballotId) {
        ballotId = ballotCount++;
        _ballots[ballotId] = Ballot({
            matchId: matchId,
            accusedTeam: accusedTeam,
            deadline: uint64(block.timestamp + VOTE_DURATION),
            votesLegitimate: 0,
            votesManipulated: 0,
            resolved: false
        });
        emit BallotOpened(ballotId, matchId, accusedTeam, uint64(block.timestamp + VOTE_DURATION));
    }

    /// @notice Cast one vote. Pays the 100 TICK anti-spam fee to the
    /// treasury (voter must approve this contract first). One vote per
    /// wallet per ballot. `manipulated=true` votes to DQ the accused team.
    function vote(uint256 ballotId, bool manipulated) external {
        Ballot storage b = _ballots[ballotId];
        if (ballotId >= ballotCount) revert InvalidBallot(ballotId);
        if (b.resolved) revert BallotAlreadyResolved(ballotId);
        if (block.timestamp > b.deadline) revert VotingClosed(ballotId);
        if (_voted[ballotId][msg.sender]) revert AlreadyVoted(ballotId, msg.sender);

        _voted[ballotId][msg.sender] = true;
        if (manipulated) {
            b.votesManipulated += 1;
        } else {
            b.votesLegitimate += 1;
        }

        bool ok = tick.transferFrom(msg.sender, treasury, VOTE_FEE);
        if (!ok) revert FeeTransferFailed();

        emit VoteCast(ballotId, msg.sender, manipulated);
    }

    /// @notice Resolves a ballot after its 24h window. Permissionless.
    /// Below quorum or tied -> LEGITIMATE (score stands). Otherwise the
    /// majority decides. The verdict is pushed to the cup's engine, which
    /// finalizes the match.
    function resolve(uint256 ballotId) external {
        Ballot storage b = _ballots[ballotId];
        if (ballotId >= ballotCount) revert InvalidBallot(ballotId);
        if (b.resolved) revert BallotAlreadyResolved(ballotId);
        if (block.timestamp <= b.deadline) revert VotingStillOpen(ballotId);

        b.resolved = true;

        uint256 total = uint256(b.votesLegitimate) + uint256(b.votesManipulated);
        bool manipulated = total >= QUORUM && b.votesManipulated > b.votesLegitimate;

        ICupEngine(engine).resolveDispute(b.matchId, manipulated, b.accusedTeam);
        emit BallotResolved(ballotId, b.matchId, manipulated);
    }

    function getBallot(uint256 ballotId) external view returns (Ballot memory) {
        if (ballotId >= ballotCount) revert InvalidBallot(ballotId);
        return _ballots[ballotId];
    }

    function hasVoted(uint256 ballotId, address voter) external view returns (bool) {
        if (ballotId >= ballotCount) revert InvalidBallot(ballotId);
        return _voted[ballotId][voter];
    }
}

interface ICupEngine {
    function resolveDispute(uint16 matchId, bool manipulated, uint16 accusedTeam) external;
}

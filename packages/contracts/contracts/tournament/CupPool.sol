// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { CupConstants } from "./CupConstants.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { CupRegistry } from "./CupRegistry.sol";

/// @title CupPool — CRYPTO PRICE WORLD CUP TICK staking, settlement & claiming
///
/// @notice Brand-new cup contract. The league's PredictionPool is NEVER
/// touched. Three pool types, all parimutuel in TICK:
///
/// 1. Per-match pools — back teamA (side 0) or teamB (side 1). No draws in
///    a knockout: every match ends with a winner (best-mover tiebreak).
/// 2. Spread pools — e.g. "XRP beats LINK by 10+": back cover (side 0) or
///    not-cover (side 1). Created by the owner; multiple spreads per match
///    allowed as long as no two are identical (same match + favorite +
///    points). Evaluated on the final normalized scoreline.
/// 3. Outright champion pool — back one of the 64 teams to win the whole
///    tournament. Open from deployment until the final kicks off.
///    Resolves when the tournament completes.
///
/// Treasury rule (same as the league): if the winning side has zero
/// stakers, the ENTIRE pool goes to the Tickr treasury — no refunds. Swept
/// atomically at settlement.
///
/// Staking windows: the outright pool opens at deployment (closes at the
/// draw). Per-match and spread pools open the moment both teams are known —
/// right after the draw for R64, as soon as both winners advance for later
/// rounds — and close at kickoff. No staking on a later-round match until
/// its two teams are complete.
contract CupPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable tick;
    CupRegistry public immutable registry;

    address public treasury;
    address public engine;
    bool public engineSet;

    uint256 public constant MIN_STAKE = 10 * 10 ** 18; // 10 TICK minimum
    uint256 public platformFeeBps = 700; // 7%, owner-adjustable within a hard cap
    uint256 public constant MAX_FEE_BPS = 1_000; // 10% hard ceiling
    uint256 public constant FIXTURE_SEED = 250 * 10 ** 18; // protocol seed per pool

    // ---------------------------------------------------------------------
    // Per-match pools
    // ---------------------------------------------------------------------

    struct MatchPool {
        uint256 totalA; // staked on teamA (side 0)
        uint256 totalB; // staked on teamB (side 1)
        uint256 seed; // protocol seed liquidity; part of totalPool
        bool settled;
        uint16 winner; // winning team id
    }

    mapping(uint16 => MatchPool) private _matchPools; // matchId => pool
    mapping(uint16 => mapping(address => mapping(uint8 => uint256))) private _matchStakes; // matchId => player => side => amount
    mapping(uint16 => mapping(address => bool)) private _matchClaimed;

    // ---------------------------------------------------------------------
    // Spread pools
    // ---------------------------------------------------------------------

    struct Spread {
        uint16 matchId;
        uint16 favorite;
        int16 points; // favorite must win by >= points to "cover"
        uint256 totalCover; // side 0
        uint256 totalNotCover; // side 1
        uint256 seed;
        bool settled;
        bool covered;
    }

    Spread[] private _spreads; // spreadId = index
    mapping(bytes32 => bool) private _spreadExists; // keccak(matchId, favorite, points)
    mapping(uint16 => uint256[]) private _spreadsByMatch;
    mapping(uint256 => mapping(address => mapping(uint8 => uint256))) private _spreadStakes;
    mapping(uint256 => mapping(address => bool)) private _spreadClaimed;

    // ---------------------------------------------------------------------
    // Outright champion pool
    // ---------------------------------------------------------------------

    mapping(uint16 => uint256) private _outrightTotals; // teamId => total staked
    mapping(uint16 => mapping(address => uint256)) private _outrightStakes; // teamId => player => amount
    uint256 private _outrightSeed;
    bool private _outrightSeeded;
    bool public outrightSettled;
    uint16 public outrightChampion;

    mapping(address => bool) private _outrightClaimed;

    event EngineSet(address indexed engine);
    event TreasuryUpdated(address indexed newTreasury);
    event MatchPoolSeeded(uint16 indexed matchId, uint256 amount);
    event MatchStaked(uint16 indexed matchId, address indexed player, uint8 side, uint256 amount);
    event MatchPoolSettled(uint16 indexed matchId, uint16 indexed winner, uint256 totalPool);
    event SpreadCreated(uint256 indexed spreadId, uint16 indexed matchId, uint16 indexed favorite, int16 points);
    event SpreadStaked(uint256 indexed spreadId, address indexed player, uint8 side, uint256 amount);
    event SpreadSettled(uint256 indexed spreadId, bool covered, uint256 totalPool);
    event OutrightStaked(uint16 indexed teamId, address indexed player, uint256 amount);
    event OutrightSettled(uint16 indexed champion, uint256 totalPool);
    event Claimed(uint16 indexed matchId, address indexed player, uint256 payout);
    event SpreadClaimed(uint256 indexed spreadId, address indexed player, uint256 payout);
    event OutrightClaimed(address indexed player, uint256 payout);
    event TreasurySwept(uint16 indexed matchId, uint256 amount);
    event Forfeited(uint16 indexed matchId, address indexed player, uint256 amount);

    error OnlyEngine();
    error EngineAlreadySet();
    error StakeTooLow(uint256 provided, uint256 minimum);
    error BettingClosed(uint16 matchId);
    error InvalidSide(uint8 side);
    error AlreadySettled(uint16 matchId);
    error NotSettled(uint16 matchId);
    error AlreadyClaimed();
    error NothingToClaim();
    error FeeTooHigh(uint256 provided, uint256 max);
    error TreasuryNotSet();
    error InvalidTreasuryAddress();
    error InvalidSpread();
    error SpreadAlreadyExists(uint16 matchId, uint16 favorite, int16 points);
    error FavoriteNotInMatch(uint16 matchId, uint16 favorite);
    error OutrightClosed();
    error OutrightAlreadySettled();
    error TournamentNotComplete();
    error InvalidTeam(uint16 teamId);

    modifier onlyEngine() {
        if (msg.sender != engine) revert OnlyEngine();
        _;
    }

    constructor(address initialOwner, address tickAddress, address registryAddress, address treasuryAddress)
        Ownable(initialOwner)
    {
        if (treasuryAddress == address(0)) revert InvalidTreasuryAddress();
        tick = IERC20(tickAddress);
        registry = CupRegistry(registryAddress);
        treasury = treasuryAddress;
    }

    /// @notice One-time wiring to the cup's own engine. Never the league's.
    function setEngine(address _engine) external onlyOwner {
        if (engineSet) revert EngineAlreadySet();
        engine = _engine;
        engineSet = true;
        emit EngineSet(_engine);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidTreasuryAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setPlatformFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        platformFeeBps = newFeeBps;
    }

    // ---------------------------------------------------------------------
    // Per-match staking
    // ---------------------------------------------------------------------

    /// @notice Stake on side 0 (teamA) or side 1 (teamB). Open once both
    /// teams are known and until kickoff arrives.
    function stakeMatch(uint16 matchId, uint8 side, uint256 amount) external nonReentrant {
        if (amount < MIN_STAKE) revert StakeTooLow(amount, MIN_STAKE);
        if (side > 1) revert InvalidSide(side);
        if (!_bettingOpen(matchId)) revert BettingClosed(matchId);

        tick.safeTransferFrom(msg.sender, address(this), amount);

        MatchPool storage p = _matchPools[matchId];
        if (p.settled) revert AlreadySettled(matchId);
        if (side == 0) {
            p.totalA += amount;
        } else {
            p.totalB += amount;
        }
        _matchStakes[matchId][msg.sender][side] += amount;

        emit MatchStaked(matchId, msg.sender, side, amount);
    }

    /// @notice Seed match pools with FIXTURE_SEED each. Owner-only, batched,
    /// idempotent and resumable. Run after the draw, before staking opens.
    function seedMatchPools(uint16 startMatchId, uint16 count) external onlyOwner {
        uint256 seeded;
        for (uint16 i = 0; i < count; i++) {
            uint16 matchId = startMatchId + i;
            if (matchId >= CupConstants.MATCH_COUNT) break;
            MatchPool storage p = _matchPools[matchId];
            if (p.seed == 0 && !p.settled) {
                p.seed = FIXTURE_SEED;
                seeded++;
                emit MatchPoolSeeded(matchId, FIXTURE_SEED);
            }
        }
        if (seeded > 0) {
            tick.safeTransferFrom(msg.sender, address(this), FIXTURE_SEED * seeded);
        }
    }

    // ---------------------------------------------------------------------
    // Spread pools
    // ---------------------------------------------------------------------

    /// @notice Create a spread on a match, e.g. favorite=XRP, points=10 means
    /// "XRP beats its opponent by 10+ goals". The favorite must be one of the
    /// match's (already known) teams, and the exact (match, favorite, points)
    /// triple must not exist yet — multiple non-identical spreads per match
    /// are allowed.
    function createSpread(uint16 matchId, uint16 favorite, int16 points) external onlyOwner returns (uint256 spreadId) {
        CupRegistry.CupMatch memory m = registry.getMatch(matchId);
        if (m.teamA == CupConstants.TBD || m.teamB == CupConstants.TBD) revert InvalidSpread();
        if (favorite != m.teamA && favorite != m.teamB) revert FavoriteNotInMatch(matchId, favorite);
        if (m.state == CupRegistry.MatchState.Settled || m.state == CupRegistry.MatchState.Disputed) {
            revert AlreadySettled(matchId);
        }
        bytes32 key = keccak256(abi.encode(matchId, favorite, points));
        if (_spreadExists[key]) revert SpreadAlreadyExists(matchId, favorite, points);

        spreadId = _spreads.length;
        _spreads.push(
            Spread({
                matchId: matchId,
                favorite: favorite,
                points: points,
                totalCover: 0,
                totalNotCover: 0,
                seed: FIXTURE_SEED,
                settled: false,
                covered: false
            })
        );
        _spreadExists[key] = true;
        _spreadsByMatch[matchId].push(spreadId);

        // Seed is protocol liquidity, pulled once at creation.
        tick.safeTransferFrom(msg.sender, address(this), FIXTURE_SEED);

        emit SpreadCreated(spreadId, matchId, favorite, points);
    }

    /// @notice Stake on side 0 (cover) or side 1 (not cover). Same window
    /// as the underlying fixture: both teams known, before kickoff.
    function stakeSpread(uint256 spreadId, uint8 side, uint256 amount) external nonReentrant {
        if (amount < MIN_STAKE) revert StakeTooLow(amount, MIN_STAKE);
        if (side > 1) revert InvalidSide(side);
        if (spreadId >= _spreads.length) revert InvalidSpread();

        Spread storage sp = _spreads[spreadId];
        if (sp.settled) revert AlreadySettled(sp.matchId);
        if (!_bettingOpen(sp.matchId)) revert BettingClosed(sp.matchId);

        tick.safeTransferFrom(msg.sender, address(this), amount);

        if (side == 0) {
            sp.totalCover += amount;
        } else {
            sp.totalNotCover += amount;
        }
        _spreadStakes[spreadId][msg.sender][side] += amount;

        emit SpreadStaked(spreadId, msg.sender, side, amount);
    }

    // ---------------------------------------------------------------------
    // Outright champion pool
    // ---------------------------------------------------------------------

    /// @notice Back one of the 64 teams to win the whole tournament.
    /// Open from deployment until the final kicks off — the window stays
    /// open through the semifinals, so fans can back a finalist on the
    /// morning of the final. Resolves when the tournament completes.
    ///
    /// Later-round "road to" display (e.g. "Winner Match 3 vs Winner Match
    /// 7") is a frontend concern: the feeder match ids are on-chain via
    /// getMatch, and staking stays closed until both teams are known.
    function stakeOutright(uint16 teamId, uint256 amount) external nonReentrant {
        if (amount < MIN_STAKE) revert StakeTooLow(amount, MIN_STAKE);
        if (teamId >= CupConstants.TEAM_COUNT) revert InvalidTeam(teamId);
        if (!_outrightOpen()) revert OutrightClosed();

        tick.safeTransferFrom(msg.sender, address(this), amount);
        _outrightTotals[teamId] += amount;
        _outrightStakes[teamId][msg.sender] += amount;

        emit OutrightStaked(teamId, msg.sender, amount);
    }

    /// @notice One-time protocol seed for the outright pool.
    function seedOutright() external onlyOwner {
        if (_outrightSeeded) return;
        _outrightSeeded = true;
        _outrightSeed = FIXTURE_SEED;
        tick.safeTransferFrom(msg.sender, address(this), FIXTURE_SEED);
    }

    /// @notice Resolves the outright pool once the tournament completes.
    /// Permissionless. Winners share parimutuel minus fee; an unstaked
    /// champion sends the entire pool to the treasury.
    function settleOutright() external nonReentrant {
        if (outrightSettled) revert OutrightAlreadySettled();
        if (!registry.tournamentComplete()) revert TournamentNotComplete();

        outrightSettled = true;
        outrightChampion = registry.champion();

        uint256 winningTotal = _outrightTotals[outrightChampion];
        uint256 totalPool = _outrightSeed;
        for (uint16 t = 0; t < CupConstants.TEAM_COUNT; t++) {
            totalPool += _outrightTotals[t];
        }

        if (winningTotal == 0 && totalPool > 0) {
            if (treasury == address(0)) revert TreasuryNotSet();
            tick.safeTransfer(treasury, totalPool);
            emit TreasurySwept(type(uint16).max, totalPool);
        }

        emit OutrightSettled(outrightChampion, totalPool);
    }

    // ---------------------------------------------------------------------
    // Settlement (called by the cup's engine after the registry records)
    // ---------------------------------------------------------------------

    /// @notice Settles the per-match pool and every spread on the match.
    /// Called by CupEngine after CupRegistry.recordResult — including after
    /// a DAO dispute resolves (pools then settle on the corrected result).
    function onMatchSettled(uint16 matchId, uint16 winner, int16 goalsA, int16 goalsB) external onlyEngine {
        CupRegistry.CupMatch memory m = registry.getMatch(matchId);

        // Per-match pool.
        MatchPool storage p = _matchPools[matchId];
        if (!p.settled) {
            p.settled = true;
            p.winner = winner;
            uint8 winningSide = winner == m.teamA ? 0 : 1;
            uint256 winningTotal = winningSide == 0 ? p.totalA : p.totalB;
            uint256 totalPool = p.totalA + p.totalB + p.seed;
            if (winningTotal == 0 && totalPool > 0) {
                if (treasury == address(0)) revert TreasuryNotSet();
                tick.safeTransfer(treasury, totalPool);
                emit TreasurySwept(matchId, totalPool);
            }
            emit MatchPoolSettled(matchId, winner, totalPool);
        }

        // Spreads on this match.
        uint256[] storage ids = _spreadsByMatch[matchId];
        for (uint256 i = 0; i < ids.length; i++) {
            Spread storage sp = _spreads[ids[i]];
            if (sp.settled) continue;
            sp.settled = true;

            int16 favGoals = sp.favorite == m.teamA ? goalsA : goalsB;
            int16 dogGoals = sp.favorite == m.teamA ? goalsB : goalsA;
            sp.covered = (favGoals - dogGoals) >= sp.points;

            uint256 winningTotal = sp.covered ? sp.totalCover : sp.totalNotCover;
            uint256 totalPool = sp.totalCover + sp.totalNotCover + sp.seed;
            if (winningTotal == 0 && totalPool > 0) {
                if (treasury == address(0)) revert TreasuryNotSet();
                tick.safeTransfer(treasury, totalPool);
                emit TreasurySwept(matchId, totalPool);
            }
            emit SpreadSettled(ids[i], sp.covered, totalPool);
        }
    }

    // ---------------------------------------------------------------------
    // Claiming (parimutuel, minus platform fee)
    // ---------------------------------------------------------------------

    function claimMatch(uint16 matchId) external nonReentrant {
        MatchPool storage p = _matchPools[matchId];
        if (!p.settled) revert NotSettled(matchId);
        if (_matchClaimed[matchId][msg.sender]) revert AlreadyClaimed();

        CupRegistry.CupMatch memory m = registry.getMatch(matchId);
        uint8 winningSide = p.winner == m.teamA ? 0 : 1;
        uint256 winningTotal = winningSide == 0 ? p.totalA : p.totalB;
        uint256 totalPool = p.totalA + p.totalB + p.seed;
        uint256 userStake = _matchStakes[matchId][msg.sender][0] + _matchStakes[matchId][msg.sender][1];
        uint256 userWinning = _matchStakes[matchId][msg.sender][winningSide];

        _matchClaimed[matchId][msg.sender] = true;

        if (winningTotal == 0) {
            if (userStake == 0) revert NothingToClaim();
            emit Forfeited(matchId, msg.sender, userStake);
            return; // pool was swept to treasury at settlement
        }
        if (userWinning == 0) {
            if (userStake == 0) revert NothingToClaim();
            return;
        }

        uint256 payout = _payout(userWinning, winningTotal, totalPool);
        tick.safeTransfer(msg.sender, payout);
        emit Claimed(matchId, msg.sender, payout);
    }

    function claimSpread(uint256 spreadId) external nonReentrant {
        if (spreadId >= _spreads.length) revert InvalidSpread();
        Spread storage sp = _spreads[spreadId];
        if (!sp.settled) revert NotSettled(sp.matchId);
        if (_spreadClaimed[spreadId][msg.sender]) revert AlreadyClaimed();

        uint8 winningSide = sp.covered ? 0 : 1;
        uint256 winningTotal = winningSide == 0 ? sp.totalCover : sp.totalNotCover;
        uint256 totalPool = sp.totalCover + sp.totalNotCover + sp.seed;
        uint256 userStake = _spreadStakes[spreadId][msg.sender][0] + _spreadStakes[spreadId][msg.sender][1];
        uint256 userWinning = _spreadStakes[spreadId][msg.sender][winningSide];

        _spreadClaimed[spreadId][msg.sender] = true;

        if (winningTotal == 0) {
            if (userStake == 0) revert NothingToClaim();
            emit Forfeited(sp.matchId, msg.sender, userStake);
            return;
        }
        if (userWinning == 0) {
            if (userStake == 0) revert NothingToClaim();
            return;
        }

        uint256 payout = _payout(userWinning, winningTotal, totalPool);
        tick.safeTransfer(msg.sender, payout);
        emit SpreadClaimed(spreadId, msg.sender, payout);
    }

    function claimOutright() external nonReentrant {
        if (!outrightSettled) revert NotSettled(type(uint16).max);
        if (_outrightClaimed[msg.sender]) revert AlreadyClaimed();

        uint256 winningTotal = _outrightTotals[outrightChampion];
        uint256 totalPool = _outrightSeed;
        for (uint16 t = 0; t < CupConstants.TEAM_COUNT; t++) {
            totalPool += _outrightTotals[t];
        }
        uint256 userWinning = _outrightStakes[outrightChampion][msg.sender];

        _outrightClaimed[msg.sender] = true;

        if (winningTotal == 0) {
            // Pool was swept to treasury at settlement.
            return;
        }
        if (userWinning == 0) revert NothingToClaim();

        uint256 payout = _payout(userWinning, winningTotal, totalPool);
        tick.safeTransfer(msg.sender, payout);
        emit OutrightClaimed(msg.sender, payout);
    }

    function _payout(uint256 userWinning, uint256 winningTotal, uint256 totalPool) private view returns (uint256) {
        uint256 distributable = (totalPool * (10_000 - platformFeeBps)) / 10_000;
        return (userWinning * distributable) / winningTotal;
    }

    /// @notice A match is stakable once both teams are known (right after
    /// @notice The outright window: open until the final kicks off (and, of
    /// course, never after the tournament completes).
    function _outrightOpen() private view returns (bool) {
        if (registry.tournamentComplete()) return false;
        CupRegistry.CupMatch memory f = registry.getMatch(CupConstants.FINAL_MATCH_ID);
        if (f.kickoffTimestamp == 0) return true; // final not scheduled yet
        return block.timestamp < f.kickoffTimestamp;
    }

    /// @notice A match is stakable once both teams are known (right after
    /// the draw for R64; once both winners have advanced for later rounds)
    /// and before its kickoff arrives. Kickoff reveal is NOT required —
    /// this mirrors the league, where betting is open before reveal.
    function _bettingOpen(uint16 matchId) private view returns (bool) {
        if (!registry.drawExecuted()) return false;
        CupRegistry.CupMatch memory m = registry.getMatch(matchId);
        if (m.teamA == CupConstants.TBD || m.teamB == CupConstants.TBD) return false;
        if (m.state != CupRegistry.MatchState.Created && m.state != CupRegistry.MatchState.Open) {
            return false;
        }
        return m.kickoffTimestamp == 0 || block.timestamp < m.kickoffTimestamp;
    }

    // ---------------------------------------------------------------------
    // Views (explicit getters)
    // ---------------------------------------------------------------------

    function getMatchPool(uint16 matchId) external view returns (MatchPool memory) {
        return _matchPools[matchId];
    }

    function getMatchStake(uint16 matchId, address player, uint8 side) external view returns (uint256) {
        return _matchStakes[matchId][player][side];
    }

    function spreadCount() external view returns (uint256) {
        return _spreads.length;
    }

    function getSpread(uint256 spreadId) external view returns (Spread memory) {
        if (spreadId >= _spreads.length) revert InvalidSpread();
        return _spreads[spreadId];
    }

    function getSpreadsByMatch(uint16 matchId) external view returns (uint256[] memory) {
        return _spreadsByMatch[matchId];
    }

    function getOutrightTotal(uint16 teamId) external view returns (uint256) {
        return _outrightTotals[teamId];
    }

    /// @notice Sweep accumulated platform-fee revenue. Manual in v1, like
    /// the league.
    function withdrawFees(address to, uint256 amount) external onlyOwner {
        tick.safeTransfer(to, amount);
    }
}

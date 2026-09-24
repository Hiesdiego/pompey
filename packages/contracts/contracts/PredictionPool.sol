// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ISeasonRegistry, IMatchRegistry, IPlayerStats, Outcome, SeasonMath } from "./interfaces/ITickr.sol";

/// @title PredictionPool — TICKR open parimutuel staking, settlement & claiming
///
/// @notice Persists across every season (unlike TeamRegistry/MatchRegistry,
/// which are redeployed each season — see SeasonRegistry). Every function
/// takes an explicit seasonId so storage never collides between, say,
/// Season 1's fixture #5 and Season 2's fixture #5 — internally these are
/// combined into one storage key via SeasonMath.globalFixtureId.
///
/// v0.1 uses OPEN staking: pool sizes are visible on-chain the instant a
/// stake lands (no commit-reveal privacy layer — deferred to a later
/// version). Design simplification worth flagging: the originally-planned
/// separate RewardDistributor contract is merged directly into this one,
/// since claim() needs the same stake-mapping storage RewardDistributor
/// would have needed read access to anyway.
contract PredictionPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable tick;
    ISeasonRegistry public immutable seasonRegistry;
    IPlayerStats public immutable playerStats;

    uint256 public constant MIN_STAKE = 10 * 10 ** 18; // 10 TICK minimum
    uint256 public platformFeeBps = 700; // 7%, owner-adjustable within a hard cap
    uint256 public constant MAX_FEE_BPS = 1_000; // 10% hard ceiling

    address public resultEngine;
    bool public resultEngineSet;

    struct MatchPool {
        uint256 totalHome;
        uint256 totalDraw;
        uint256 totalAway;
        bool settled;
        Outcome winningOutcome;
    }

    mapping(uint256 => MatchPool) public pools; // globalFixtureId => pool
    mapping(uint256 => mapping(address => mapping(Outcome => uint256))) public stakes; // globalFixtureId => player => outcome => amount
    mapping(uint256 => mapping(address => bool)) public claimed; // globalFixtureId => player => claimed?

    event Staked(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, Outcome outcome, uint256 amount);
    event Settled(uint256 indexed seasonId, uint256 indexed fixtureId, Outcome winningOutcome, uint256 totalPool);
    event Claimed(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, uint256 payout);
    event Refunded(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, uint256 amount);

    error StakeTooLow(uint256 provided, uint256 minimum);
    error BettingClosed(uint256 seasonId, uint256 fixtureId);
    error OnlyResultEngine();
    error ResultEngineAlreadySet();
    error AlreadySettled(uint256 seasonId, uint256 fixtureId);
    error NotSettled(uint256 seasonId, uint256 fixtureId);
    error AlreadyClaimed(uint256 seasonId, uint256 fixtureId, address player);
    error NothingToClaim(uint256 seasonId, uint256 fixtureId, address player);
    error FeeTooHigh(uint256 provided, uint256 max);

    modifier onlyResultEngine() {
        if (msg.sender != resultEngine) revert OnlyResultEngine();
        _;
    }

    constructor(
        address initialOwner,
        address tickAddress,
        address seasonRegistryAddress,
        address playerStatsAddress
    ) Ownable(initialOwner) {
        tick = IERC20(tickAddress);
        seasonRegistry = ISeasonRegistry(seasonRegistryAddress);
        playerStats = IPlayerStats(playerStatsAddress);
    }

    function setResultEngine(address _resultEngine) external onlyOwner {
        if (resultEngineSet) revert ResultEngineAlreadySet();
        resultEngine = _resultEngine;
        resultEngineSet = true;
    }

    function setPlatformFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        platformFeeBps = newFeeBps;
    }

    // =========================================================================
    // STAKING
    // =========================================================================

    function stake(uint256 seasonId, uint256 fixtureId, Outcome outcome, uint256 amount) external nonReentrant {
        if (amount < MIN_STAKE) revert StakeTooLow(amount, MIN_STAKE);

        address matchRegistryAddr = seasonRegistry.getMatchRegistry(seasonId);
        if (!IMatchRegistry(matchRegistryAddr).isBettingOpen(fixtureId)) {
            revert BettingClosed(seasonId, fixtureId);
        }

        tick.safeTransferFrom(msg.sender, address(this), amount);

        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        MatchPool storage p = pools[gid];
        if (outcome == Outcome.WinHome) {
            p.totalHome += amount;
        } else if (outcome == Outcome.Draw) {
            p.totalDraw += amount;
        } else {
            p.totalAway += amount;
        }

        stakes[gid][msg.sender][outcome] += amount;

        emit Staked(seasonId, fixtureId, msg.sender, outcome, amount);
    }

    // =========================================================================
    // SETTLEMENT (called by ResultEngine after PriceOracle computes the result)
    // =========================================================================

    function settleFixture(uint256 seasonId, uint256 fixtureId, Outcome outcome) external onlyResultEngine {
        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        MatchPool storage p = pools[gid];
        if (p.settled) revert AlreadySettled(seasonId, fixtureId);

        p.settled = true;
        p.winningOutcome = outcome;

        uint256 totalPool = p.totalHome + p.totalDraw + p.totalAway;
        emit Settled(seasonId, fixtureId, outcome, totalPool);
    }

    // =========================================================================
    // CLAIMING
    // =========================================================================

    /// @notice Parimutuel payout: (yourStakeInWinningOutcome / totalWinningPool)
    /// * totalPool * (1 - fee). If nobody staked the winning outcome, everyone
    /// who staked at all is refunded their original stake with no fee taken.
    function claim(uint256 seasonId, uint256 fixtureId) external nonReentrant {
        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        MatchPool storage p = pools[gid];
        if (!p.settled) revert NotSettled(seasonId, fixtureId);
        if (claimed[gid][msg.sender]) revert AlreadyClaimed(seasonId, fixtureId, msg.sender);

        uint256 totalPool = p.totalHome + p.totalDraw + p.totalAway;
        uint256 winningPoolTotal = _poolFor(p, p.winningOutcome);

        claimed[gid][msg.sender] = true;

        if (winningPoolTotal == 0) {
            uint256 refund = stakes[gid][msg.sender][Outcome.WinHome]
                + stakes[gid][msg.sender][Outcome.Draw]
                + stakes[gid][msg.sender][Outcome.WinAway];

            if (refund == 0) revert NothingToClaim(seasonId, fixtureId, msg.sender);

            tick.safeTransfer(msg.sender, refund);
            playerStats.recordOutcome(msg.sender, seasonId, fixtureId, false, true, refund, 0);
            emit Refunded(seasonId, fixtureId, msg.sender, refund);
            return;
        }

        uint256 userWinningStake = stakes[gid][msg.sender][p.winningOutcome];
        uint256 userTotalStake = stakes[gid][msg.sender][Outcome.WinHome]
            + stakes[gid][msg.sender][Outcome.Draw]
            + stakes[gid][msg.sender][Outcome.WinAway];

        if (userWinningStake == 0) {
            if (userTotalStake == 0) revert NothingToClaim(seasonId, fixtureId, msg.sender);
            playerStats.recordOutcome(msg.sender, seasonId, fixtureId, false, false, userTotalStake, 0);
            return;
        }

        uint256 distributable = (totalPool * (10_000 - platformFeeBps)) / 10_000;
        uint256 payout = (userWinningStake * distributable) / winningPoolTotal;

        bool isDraw = p.winningOutcome == Outcome.Draw;
        playerStats.recordOutcome(msg.sender, seasonId, fixtureId, true, isDraw, userTotalStake, payout);

        tick.safeTransfer(msg.sender, payout);
        emit Claimed(seasonId, fixtureId, msg.sender, payout);
    }

    function _poolFor(MatchPool storage p, Outcome outcome) private view returns (uint256) {
        if (outcome == Outcome.WinHome) return p.totalHome;
        if (outcome == Outcome.Draw) return p.totalDraw;
        return p.totalAway;
    }

    // =========================================================================
    // VIEWS
    // =========================================================================

    function getPool(uint256 seasonId, uint256 fixtureId) external view returns (MatchPool memory) {
        return pools[SeasonMath.globalFixtureId(seasonId, fixtureId)];
    }

    function getStake(uint256 seasonId, uint256 fixtureId, address player, Outcome outcome)
        external
        view
        returns (uint256)
    {
        return stakes[SeasonMath.globalFixtureId(seasonId, fixtureId)][player][outcome];
    }

    /// @notice Sweep any platform fee revenue accumulated in this contract's
    /// TICK balance beyond what's owed to pending claims. v0.1 keeps this
    /// simple/manual; a more precise fee-accounting ledger is a v0.2 item.
    function withdrawFees(address to, uint256 amount) external onlyOwner {
        tick.safeTransfer(to, amount);
    }
}

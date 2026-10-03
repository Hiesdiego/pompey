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
///
/// VOID ESCAPE HATCH: if a fixture can never be played or settled (see
/// MatchRegistry.voidFixture), the owner can void it: the protocol seed
/// returns to the treasury and every staker reclaims their stake 1:1 via
/// claimVoid. A void is a refund, not a payout — no fee is taken, nothing
/// is forfeited, and PlayerStats records nothing (the match never happened).
contract PredictionPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable tick;
    ISeasonRegistry public immutable seasonRegistry;
    IPlayerStats public immutable playerStats;

    uint256 public constant MIN_STAKE = 10 * 10 ** 18; // 10 TICK minimum
    uint256 public platformFeeBps = 700; // 7%, owner-adjustable within a hard cap
    uint256 public constant MAX_FEE_BPS = 1_000; // 10% hard ceiling

    /// @notice Tickr treasury — receives the ENTIRE pool when a fixture
    /// settles with no stakers in the winning outcome (see settleFixture),
    /// and the protocol seed of every voided fixture (see voidFixture).
    address public treasury;

    address public resultEngine;
    bool public resultEngineSet;

    struct MatchPool {
        uint256 totalHome;
        uint256 totalDraw;
        uint256 totalAway;
        uint256 seed; // protocol seed liquidity (250 TICK); part of totalPool
        bool settled;
        Outcome winningOutcome;
        /// @notice True when the fixture was voided via the escape hatch —
        /// stakes are refundable 1:1 via claimVoid, never payable via claim.
        bool voided;
    }

    mapping(uint256 => MatchPool) public pools; // globalFixtureId => pool

    /// @notice Fixed protocol seed per fixture pool — every total pool starts
    /// with at least this much liquidity. Counted inside totalPool, so the
    /// treasury fee and winner pro-rata apply to it like any other liquidity.
    uint256 public constant FIXTURE_SEED = 250 * 10 ** 18;

    event FixtureSeeded(uint256 indexed seasonId, uint256 indexed fixtureId, uint256 amount);
    mapping(uint256 => mapping(address => mapping(Outcome => uint256))) public stakes; // globalFixtureId => player => outcome => amount
    mapping(uint256 => mapping(address => bool)) public claimed; // globalFixtureId => player => claimed?

    event Staked(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, Outcome outcome, uint256 amount);
    event Settled(uint256 indexed seasonId, uint256 indexed fixtureId, Outcome winningOutcome, uint256 totalPool);
    event Claimed(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, uint256 payout);
    event TreasurySwept(uint256 indexed seasonId, uint256 indexed fixtureId, uint256 amount);
    event TreasuryUpdated(address indexed newTreasury);
    event Forfeited(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, uint256 amount);
    event FixtureVoided(uint256 indexed seasonId, uint256 indexed fixtureId, uint256 seedToTreasury);
    event VoidClaimed(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, uint256 refund);

    error StakeTooLow(uint256 provided, uint256 minimum);
    error BettingClosed(uint256 seasonId, uint256 fixtureId);
    error OnlyResultEngine();
    error ResultEngineAlreadySet();
    error AlreadySettled(uint256 seasonId, uint256 fixtureId);
    error NotSettled(uint256 seasonId, uint256 fixtureId);
    error AlreadyClaimed(uint256 seasonId, uint256 fixtureId, address player);
    error NothingToClaim(uint256 seasonId, uint256 fixtureId, address player);
    error FeeTooHigh(uint256 provided, uint256 max);
    error TreasuryNotSet();
    error InvalidTreasuryAddress();
    error FixtureNotVoided(uint256 seasonId, uint256 fixtureId);
    error UseClaimVoid(uint256 seasonId, uint256 fixtureId);

    modifier onlyResultEngine() {
        if (msg.sender != resultEngine) revert OnlyResultEngine();
        _;
    }

    constructor(
        address initialOwner,
        address tickAddress,
        address seasonRegistryAddress,
        address playerStatsAddress,
        address treasuryAddress
    ) Ownable(initialOwner) {
        if (treasuryAddress == address(0)) revert InvalidTreasuryAddress();
        tick = IERC20(tickAddress);
        seasonRegistry = ISeasonRegistry(seasonRegistryAddress);
        playerStats = IPlayerStats(playerStatsAddress);
        treasury = treasuryAddress;
    }

    function setResultEngine(address _resultEngine) external onlyOwner {
        if (resultEngineSet) revert ResultEngineAlreadySet();
        resultEngine = _resultEngine;
        resultEngineSet = true;
    }

    /// @notice Point the treasury at a new address (e.g. a multisig once
    /// mainnet operations begin). Zero address is rejected — funds must
    /// always have somewhere to go.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidTreasuryAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
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

    /// @notice Seed fixture pools with FIXTURE_SEED each. Owner-only, batched.
    /// Pulls FIXTURE_SEED * (newly seeded count) TICK from the caller via
    /// transferFrom (approve once first). Skips already-seeded or settled
    /// fixtures so batches are idempotent and resumable. Run after the
    /// schedule is generated, before fixtures open for staking.
    function seedFixtures(uint256 seasonId, uint256 startFixtureId, uint256 count)
        external
        onlyOwner
    {
        uint256 seeded;
        for (uint256 i = 0; i < count; i++) {
            uint256 fixtureId = startFixtureId + i;
            uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
            MatchPool storage p = pools[gid];
            if (p.seed == 0 && !p.settled) {
                p.seed = FIXTURE_SEED;
                seeded++;
                emit FixtureSeeded(seasonId, fixtureId, FIXTURE_SEED);
            }
        }
        if (seeded > 0) {
            tick.safeTransferFrom(msg.sender, address(this), FIXTURE_SEED * seeded);
        }
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

        uint256 totalPool = p.totalHome + p.totalDraw + p.totalAway + p.seed;

        // Treasury rule: if nobody staked the winning outcome, the ENTIRE
        // pool goes to the Tickr treasury — no refunds. Swept here at
        // settlement (not lazily in claim) so the outcome is atomic and
        // doesn't depend on anyone calling claim().
        if (_poolFor(p, outcome) == 0 && totalPool > 0) {
            if (treasury == address(0)) revert TreasuryNotSet();
            tick.safeTransfer(treasury, totalPool);
            emit TreasurySwept(seasonId, fixtureId, totalPool);
        }

        emit Settled(seasonId, fixtureId, outcome, totalPool);
    }

    /// @notice Escape-hatch settlement for a fixture that can never be played
    /// (see MatchRegistry.voidFixture). Only callable by the ResultEngine as
    /// part of the owner-initiated void flow. Marks the pool settled-void
    /// and returns the protocol seed to the treasury; every staker's funds
    /// stay reclaimable 1:1 via claimVoid. There is no winner here, so
    /// nothing is forfeited and no fee is taken — a void is a refund, not
    /// a payout.
    function voidFixture(uint256 seasonId, uint256 fixtureId) external onlyResultEngine {
        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        MatchPool storage p = pools[gid];
        if (p.settled) revert AlreadySettled(seasonId, fixtureId);

        p.settled = true;
        p.voided = true;

        uint256 seedToTreasury = p.seed;
        if (seedToTreasury > 0) {
            p.seed = 0;
            if (treasury == address(0)) revert TreasuryNotSet();
            tick.safeTransfer(treasury, seedToTreasury);
        }

        emit FixtureVoided(seasonId, fixtureId, seedToTreasury);
    }

    // =========================================================================
    // CLAIMING
    // =========================================================================

    /// @notice Parimutuel payout: (yourStakeInWinningOutcome / totalWinningPool)
    /// * totalPool * (1 - fee). If nobody staked the winning outcome, the
    /// whole pool was swept to the Tickr treasury at settlement — stakers
    /// forfeit, and the forfeit is recorded as a LOSS in PlayerStats
    /// (they didn't win, and it wasn't a draw).
    ///
    /// Voided fixtures cannot be claimed here — their winningOutcome was
    /// never decided, so paying out "winners" would be arbitrary. Use
    /// claimVoid for a 1:1 refund instead.
    function claim(uint256 seasonId, uint256 fixtureId) external nonReentrant {
        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        MatchPool storage p = pools[gid];
        if (!p.settled) revert NotSettled(seasonId, fixtureId);
        if (p.voided) revert UseClaimVoid(seasonId, fixtureId);
        if (claimed[gid][msg.sender]) revert AlreadyClaimed(seasonId, fixtureId, msg.sender);

        uint256 totalPool = p.totalHome + p.totalDraw + p.totalAway + p.seed;
        uint256 winningPoolTotal = _poolFor(p, p.winningOutcome);

        claimed[gid][msg.sender] = true;

        uint256 userTotalStake = stakes[gid][msg.sender][Outcome.WinHome]
            + stakes[gid][msg.sender][Outcome.Draw]
            + stakes[gid][msg.sender][Outcome.WinAway];

        if (winningPoolTotal == 0) {
            if (userTotalStake == 0) revert NothingToClaim(seasonId, fixtureId, msg.sender);

            // Pool went to the treasury at settlement — nothing to pay out.
            playerStats.recordOutcome(msg.sender, seasonId, fixtureId, false, false, userTotalStake, 0);
            emit Forfeited(seasonId, fixtureId, msg.sender, userTotalStake);
            return;
        }

        uint256 userWinningStake = stakes[gid][msg.sender][p.winningOutcome];

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

    /// @notice Reclaims a staker's full stake (1:1, no fee) from a voided
    /// fixture's pool. The match never happened, so this is a refund, not a
    /// payout: PlayerStats records nothing (no win/loss/draw), and the
    /// treasury takes no cut. Each player claims once; per-outcome stakes
    /// are zeroed on claim so a refund can never be double-spent.
    function claimVoid(uint256 seasonId, uint256 fixtureId) external nonReentrant {
        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        MatchPool storage p = pools[gid];
        if (!p.voided) revert FixtureNotVoided(seasonId, fixtureId);
        if (claimed[gid][msg.sender]) revert AlreadyClaimed(seasonId, fixtureId, msg.sender);

        uint256 refund = stakes[gid][msg.sender][Outcome.WinHome]
            + stakes[gid][msg.sender][Outcome.Draw]
            + stakes[gid][msg.sender][Outcome.WinAway];
        if (refund == 0) revert NothingToClaim(seasonId, fixtureId, msg.sender);

        claimed[gid][msg.sender] = true;
        stakes[gid][msg.sender][Outcome.WinHome] = 0;
        stakes[gid][msg.sender][Outcome.Draw] = 0;
        stakes[gid][msg.sender][Outcome.WinAway] = 0;

        tick.safeTransfer(msg.sender, refund);
        emit VoidClaimed(seasonId, fixtureId, msg.sender, refund);
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

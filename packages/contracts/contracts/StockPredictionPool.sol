// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { StockConstants, StockOutcome, StockSeasonMath } from "./StockConstants.sol";

/// @notice Minimal interface of StockMatchRegistry used by this contract.
interface IStockMatchRegistryForPool {
    function isBettingOpen(uint256 fixtureId) external view returns (bool);
}

/// @title StockPredictionPool - TICKR Stock League parimutuel staking
///
/// @notice Open parimutuel staking, settlement and claiming for the stock
/// league, copied from crypto PredictionPool and adapted. Every function
/// takes an explicit seasonId (always StockConstants.SEASON_ID = 1 here)
/// so storage keys never collide with the crypto league's pools.
///
/// Economics, identical to crypto:
///   - 7% platform fee (owner-adjustable within a 10% hard cap).
///   - 250 TICK protocol seed per fixture pool, counted inside the pool.
///   - 10 TICK minimum stake.
///   - Parimutuel claim: (your winning stake / total winning pool) x
///     total pool x (1 - fee).
///   - TREASURY RULE: if nobody staked the winning outcome, the ENTIRE
///     pool goes to the Tickr treasury at settlement, no refunds.
///   - VOID: if a fixture is voided (both teams no performance), every
///     stake is refunded 1:1 through claim(). No fee is taken on refunds.
///
/// @dev STOCK DIFFERENCES FROM CRYPTO PredictionPool:
///   - NO PlayerStats writes. The crypto PlayerStats.setPredictionPool
///     is one-time and already set to the crypto pool, so this stock pool
///     CANNOT be wired to it on-chain, and writing to it would revert.
///     No StockPlayerStats is created either: there is no on-chain
///     consumer that needs per-player stock stats, and TickrPoints (TP)
///     are aggregated OFF-CHAIN by the backend from the Staked / Claimed
///     / Refunded events plus the crypto PlayerStats, into one unified
///     leaderboard (per the Nov 16 decision: shared PlayerStats concept,
///     no separate stock leaderboard). If a future version needs on-chain
///     stock stats, add a fresh StockPlayerStats then, do not touch the
///     crypto one.
///   - voidFixture() plus void refunds in claim(). Crypto has no void path.
///   - UUPS upgradeable, owner-only upgrades. initialize() replaces the
///     constructor; setResultEngine is a one-time setter, as in crypto.
///   - MatchRegistry is wired directly (one address), not resolved via a
///     SeasonRegistry: this stack has exactly one season and one registry.
contract StockPredictionPool is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    IERC20 public tick;
    IStockMatchRegistryForPool public matchRegistry;

    uint256 public platformFeeBps; // 7%, owner-adjustable within hard cap

    /// @notice Tickr treasury, receives the ENTIRE pool when a fixture
    /// settles with no stakers in the winning outcome (see settleFixture).
    address public treasury;

    address public resultEngine;
    bool public resultEngineSet;

    struct MatchPool {
        uint256 totalHome;
        uint256 totalDraw;
        uint256 totalAway;
        uint256 seed; // protocol seed liquidity (250 TICK), part of totalPool
        bool settled;
        bool voided;
        StockOutcome winningOutcome;
    }

    mapping(uint256 => MatchPool) public pools; // globalFixtureId => pool

    mapping(uint256 => mapping(address => mapping(StockOutcome => uint256))) public stakes; // globalFixtureId => player => outcome => amount
    mapping(uint256 => mapping(address => bool)) public claimed; // globalFixtureId => player => claimed?

    /// @notice Reserved storage for future upgrades. Never remove or reorder.
    uint256[48] private __gap;

    event FixtureSeeded(uint256 indexed seasonId, uint256 indexed fixtureId, uint256 amount);
    event Staked(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, StockOutcome outcome, uint256 amount);
    event Settled(uint256 indexed seasonId, uint256 indexed fixtureId, StockOutcome winningOutcome, uint256 totalPool);
    event Claimed(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, uint256 payout);
    event Refunded(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, uint256 amount);
    event FixtureVoided(uint256 indexed seasonId, uint256 indexed fixtureId);
    event TreasurySwept(uint256 indexed seasonId, uint256 indexed fixtureId, uint256 amount);
    event TreasuryUpdated(address indexed newTreasury);
    event Forfeited(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, uint256 amount);

    error StakeTooLow(uint256 provided, uint256 minimum);
    error BettingClosed(uint256 seasonId, uint256 fixtureId);
    error OnlyResultEngine();
    error ResultEngineAlreadySet();
    error AlreadySettled(uint256 seasonId, uint256 fixtureId);
    error AlreadyVoided(uint256 seasonId, uint256 fixtureId);
    error NotSettled(uint256 seasonId, uint256 fixtureId);
    error AlreadyClaimed(uint256 seasonId, uint256 fixtureId, address player);
    error NothingToClaim(uint256 seasonId, uint256 fixtureId, address player);
    error FeeTooHigh(uint256 provided, uint256 max);
    error TreasuryNotSet();
    error InvalidTreasuryAddress();

    modifier onlyResultEngine() {
        if (msg.sender != resultEngine) revert OnlyResultEngine();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer, called through the proxy by the deploy
    /// script. tick must be the reused TICK
    /// (0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b), never a fresh token.
    function initialize(
        address initialOwner,
        address tickAddress,
        address matchRegistryAddress,
        address treasuryAddress
    ) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        if (treasuryAddress == address(0)) revert InvalidTreasuryAddress();
        tick = IERC20(tickAddress);
        matchRegistry = IStockMatchRegistryForPool(matchRegistryAddress);
        treasury = treasuryAddress;
        platformFeeBps = StockConstants.PLATFORM_FEE_BPS;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function setResultEngine(address _resultEngine) external onlyOwner {
        if (resultEngineSet) revert ResultEngineAlreadySet();
        resultEngine = _resultEngine;
        resultEngineSet = true;
    }

    /// @notice Point the treasury at a new address (e.g. a multisig once
    /// mainnet operations begin). Zero address is rejected.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidTreasuryAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setPlatformFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > StockConstants.MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, StockConstants.MAX_FEE_BPS);
        platformFeeBps = newFeeBps;
    }

    // =========================================================================
    // STAKING
    // =========================================================================

    function stake(uint256 seasonId, uint256 fixtureId, StockOutcome outcome, uint256 amount) external nonReentrant {
        if (amount < StockConstants.MIN_STAKE) revert StakeTooLow(amount, StockConstants.MIN_STAKE);

        if (!matchRegistry.isBettingOpen(fixtureId)) {
            revert BettingClosed(seasonId, fixtureId);
        }

        tick.safeTransferFrom(msg.sender, address(this), amount);

        uint256 gid = StockSeasonMath.globalFixtureId(seasonId, fixtureId);
        MatchPool storage p = pools[gid];
        if (outcome == StockOutcome.WinHome) {
            p.totalHome += amount;
        } else if (outcome == StockOutcome.Draw) {
            p.totalDraw += amount;
        } else {
            p.totalAway += amount;
        }

        stakes[gid][msg.sender][outcome] += amount;

        emit Staked(seasonId, fixtureId, msg.sender, outcome, amount);
    }

    /// @notice Seed fixture pools with 250 TICK each. Owner-only, batched.
    /// Pulls FIXTURE_SEED * (newly seeded count) TICK from the caller via
    /// transferFrom (approve once first). Skips already-seeded, settled or
    /// voided fixtures so batches are idempotent and resumable. Run after
    /// the schedule is generated, before fixtures open for staking.
    function seedFixtures(uint256 seasonId, uint256 startFixtureId, uint256 count)
        external
        onlyOwner
    {
        uint256 seeded;
        for (uint256 i = 0; i < count; i++) {
            uint256 fixtureId = startFixtureId + i;
            uint256 gid = StockSeasonMath.globalFixtureId(seasonId, fixtureId);
            MatchPool storage p = pools[gid];
            if (p.seed == 0 && !p.settled && !p.voided) {
                p.seed = StockConstants.FIXTURE_SEED;
                seeded++;
                emit FixtureSeeded(seasonId, fixtureId, StockConstants.FIXTURE_SEED);
            }
        }
        if (seeded > 0) {
            tick.safeTransferFrom(msg.sender, address(this), StockConstants.FIXTURE_SEED * seeded);
        }
    }

    // =========================================================================
    // SETTLEMENT AND VOID (called by StockResultEngine only)
    // =========================================================================

    function settleFixture(uint256 seasonId, uint256 fixtureId, StockOutcome outcome) external onlyResultEngine {
        uint256 gid = StockSeasonMath.globalFixtureId(seasonId, fixtureId);
        MatchPool storage p = pools[gid];
        if (p.settled) revert AlreadySettled(seasonId, fixtureId);
        if (p.voided) revert AlreadyVoided(seasonId, fixtureId);

        p.settled = true;
        p.winningOutcome = outcome;

        uint256 totalPool = p.totalHome + p.totalDraw + p.totalAway + p.seed;

        // Treasury rule: if nobody staked the winning outcome, the ENTIRE
        // pool goes to the Tickr treasury, no refunds. Swept here at
        // settlement (not lazily in claim) so the outcome is atomic.
        if (_poolFor(p, outcome) == 0 && totalPool > 0) {
            if (treasury == address(0)) revert TreasuryNotSet();
            tick.safeTransfer(treasury, totalPool);
            emit TreasurySwept(seasonId, fixtureId, totalPool);
        }

        emit Settled(seasonId, fixtureId, outcome, totalPool);
    }

    /// @notice Voids a fixture's pool: both teams had no performance, so
    /// every stake is refunded 1:1 through claim(). No fee is taken on
    /// refunds, and the seed stays in the contract to be reclaimed by the
    /// owner via withdrawFees. Called only by StockResultEngine.recordVoid.
    function voidFixture(uint256 seasonId, uint256 fixtureId) external onlyResultEngine {
        uint256 gid = StockSeasonMath.globalFixtureId(seasonId, fixtureId);
        MatchPool storage p = pools[gid];
        if (p.settled) revert AlreadySettled(seasonId, fixtureId);
        if (p.voided) revert AlreadyVoided(seasonId, fixtureId);

        p.voided = true;
        emit FixtureVoided(seasonId, fixtureId);
    }

    // =========================================================================
    // CLAIMING
    // =========================================================================

    /// @notice Parimutuel payout: (your stake in the winning outcome /
    /// total winning pool) x total pool x (1 - fee). If the fixture was
    /// voided, refunds your full stake 1:1 instead (no fee). If nobody
    /// staked the winning outcome, the whole pool was swept to the
    /// treasury at settlement, and claiming records a forfeit (no payout).
    /// NOTE: unlike crypto, this does NOT write to PlayerStats (see the
    /// contract header). The backend indexes Claimed / Forfeited /
    /// Refunded events to aggregate unified TickrPoints off-chain.
    function claim(uint256 seasonId, uint256 fixtureId) external nonReentrant {
        uint256 gid = StockSeasonMath.globalFixtureId(seasonId, fixtureId);
        MatchPool storage p = pools[gid];
        if (!p.settled && !p.voided) revert NotSettled(seasonId, fixtureId);
        if (claimed[gid][msg.sender]) revert AlreadyClaimed(seasonId, fixtureId, msg.sender);

        uint256 userTotalStake = stakes[gid][msg.sender][StockOutcome.WinHome]
            + stakes[gid][msg.sender][StockOutcome.Draw]
            + stakes[gid][msg.sender][StockOutcome.WinAway];
        if (userTotalStake == 0) revert NothingToClaim(seasonId, fixtureId, msg.sender);

        claimed[gid][msg.sender] = true;

        // Void path: full 1:1 refund, no fee.
        if (p.voided) {
            tick.safeTransfer(msg.sender, userTotalStake);
            emit Refunded(seasonId, fixtureId, msg.sender, userTotalStake);
            return;
        }

        uint256 totalPool = p.totalHome + p.totalDraw + p.totalAway + p.seed;
        uint256 winningPoolTotal = _poolFor(p, p.winningOutcome);

        if (winningPoolTotal == 0) {
            // Pool went to the treasury at settlement, nothing to pay out.
            emit Forfeited(seasonId, fixtureId, msg.sender, userTotalStake);
            return;
        }

        uint256 userWinningStake = stakes[gid][msg.sender][p.winningOutcome];

        if (userWinningStake == 0) {
            return;
        }

        uint256 distributable = (totalPool * (10_000 - platformFeeBps)) / 10_000;
        uint256 payout = (userWinningStake * distributable) / winningPoolTotal;

        tick.safeTransfer(msg.sender, payout);
        emit Claimed(seasonId, fixtureId, msg.sender, payout);
    }

    function _poolFor(MatchPool storage p, StockOutcome outcome) private view returns (uint256) {
        if (outcome == StockOutcome.WinHome) return p.totalHome;
        if (outcome == StockOutcome.Draw) return p.totalDraw;
        return p.totalAway;
    }

    // =========================================================================
    // VIEWS
    // =========================================================================

    function getPool(uint256 seasonId, uint256 fixtureId) external view returns (MatchPool memory) {
        return pools[StockSeasonMath.globalFixtureId(seasonId, fixtureId)];
    }

    function getStake(uint256 seasonId, uint256 fixtureId, address player, StockOutcome outcome)
        external
        view
        returns (uint256)
    {
        return stakes[StockSeasonMath.globalFixtureId(seasonId, fixtureId)][player][outcome];
    }

    /// @notice Sweep platform fee revenue accumulated in this contract's
    /// TICK balance beyond what is owed to pending claims (including voided
    /// fixture seeds). Owner-only, manual in Season 1.
    function withdrawFees(address to, uint256 amount) external onlyOwner {
        tick.safeTransfer(to, amount);
    }
}

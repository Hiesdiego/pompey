// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MemeClashConstants, OpponentKind } from "./MemeClashConstants.sol";

/// @title MemeClashFactory - permissionless TICKR Stock Meme Arena outperform clashes.
///
/// @notice Anyone can create a Yes/No outperform clash for any BaseStonk
/// memecoin: "Will [MEME] outperform [OPPONENT]?" The opponent is either
/// the stock the meme is paired with on BaseStonk (OpponentKind.Stock)
/// or another memecoin paired with the same stock (OpponentKind.Meme, a
/// derby). Yes wins only if the meme's percent move over the window is
/// strictly greater than the opponent's. The registry is dynamic: the
/// meme and the opponent are named by token address plus symbol string
/// at creation, there is no fixed roster in this contract.
///
/// This contract is a sibling of StockMarketFactory, NOT a modification
/// of it. The lifecycle, economics and event shapes mirror
/// StockMarketFactory so the backend keeper and frontend patterns carry
/// over:
///
/// Economics (all in TICK, identical to StockMarketFactory):
/// - Creation costs CREATION_SEED (250 TICK), paid into the clash's pool
///   as UNALLOCATED seed liquidity, pulled from the creator via
///   transferFrom at creation. It is not staked on any outcome. At
///   settlement it is added whole to the winners' payout pool.
/// - Fees apply to STAKED volume only (never to the seed): treasuryFeeBps
///   (default 300, 3 percent) to treasury, creatorFeeBps (default 200,
///   2 percent) to the clash creator, resolverFeeBps (default 100,
///   1 percent) to the resolver who calls resolve() or resolveCupTie().
/// - Winners share (staked * (1 - totalFees) + seed) pro-rata by stake,
///   via payoutPerShare fixed point exactly as StockMarketFactory
///   computes it.
/// - Every clash terminates in exactly one of: RESOLVED (payouts) or
///   VOIDED (full stake refunds plus seed back to creator). Funds can
///   never be stuck.
/// - A clash that resolves with zero stakes sends its seed to the
///   treasury (spam deterrent); a clash whose winning outcome has zero
///   stakes sweeps everything (stakes plus seed) to the treasury. Both
///   rules are copied from StockMarketFactory.
///
/// @dev ARENA DIFFERENCES FROM StockMarketFactory (kept minimal):
///   - QUESTION SHAPE: a stock target market asks about one asset
///     against a fixed target price by a deadline. A clash asks about
///     two assets against each other over a fixed window: the window
///     starts WINDOW_LEAD (1 hour) after creation and runs for
///     BLITZ_WINDOW (1 hour) or STANDARD_WINDOW (24 hours), nothing
///     else. Staking is open from creation until the window starts and
///     closes exactly at windowStart (there is no betting close buffer:
///     nobody may stake once the moves being predicted have begun).
///   - RESOLUTION: the winner is decided by percent moves computed by
///     the factory itself from four resolver-submitted snapshot prices
///     (meme start and end, opponent start and end, all at the 1e8
///     PRICE_SCALE). Only the authorized `resolver` (the backend
///     signer) may submit them, exactly as only the resolver submits
///     the final NAV to StockMarketFactory, and for the same reason:
///     the prices live off chain (BaseStonk for memes, Coinbase NAV
///     for stocks) with no on-chain checkpoint feed in this stack.
///     Every price must be non-zero: a missing price is the void path
///     (voidClash), never a fabricated price. The four prices are
///     stored on the clash at settlement so anyone can recompute both
///     moves and audit the outcome after the fact.
///   - CIRCUIT BREAKER: if either side's raw move inside the window is
///     at least SPIKE_BREAKER_MOVE (30 percent) in absolute value,
///     resolve() and resolveCupTie() void the clash instead of
///     settling it: the seed returns to the creator at once and stakes
///     refund 1:1 through claim(), exactly as a manual void settles.
///     A spiked window proves nothing about outperformance, so its
///     scoreline is ignored.
///   - TIES: percent moves are compared exactly. If the moves are
///     exactly equal on an open (non-cup) clash, No wins: Yes needed a
///     strictly greater move. A Weekly Meme Cup tie cannot end level,
///     because the bracket needs a winner, and the cup tiebreak (higher
///     window volume, then higher seed) lives off chain where the
///     volume data is. So for a cupTie clash, resolve() reverts with
///     CupTieRequiresExplicitWinner on an exact tie and the resolver
///     settles it through resolveCupTie() with the tiebreak winner.
///   - DUPLICATES: StockMarketFactory forbids the same terms forever.
///     Clashes are recurring fixtures, so the guard is narrower: a
///     NON-cup clash reverts only while an identical clash (same meme
///     token, opponent token and window duration) is still Open. Once
///     it settles, the same pairing can clash again. Cup ties skip the
///     guard entirely (the cup seeder creates its bracket on its own
///     schedule, and several cup ties can share terms), and cup ties
///     are not recorded in the active/created indexes, which track the
///     open catalogue only.
///   - VOID: voidClash() is callable by the resolver or the owner at
///     any time before resolution, following StockMarketFactory's
///     voidMarket convention: stakes refund 1:1 through claim() with
///     no fee taken, and the seed returns to the creator immediately.
///     voidAfter is still recorded on every clash for shape parity.
///   - UUPS UPGRADEABLE: initialize() replaces the constructor,
///     upgrades are owner-only, and the deploy script wraps the factory
///     in StockERC1967Proxy like every stock stack contract.
contract MemeClashFactory is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    enum ClashState {
        Open,
        Resolved,
        Voided
    }

    struct Clash {
        address memeToken; // BaseStonk memecoin contract for the meme side
        string memeSymbol; // display symbol, e.g. "BLUECHIP"
        OpponentKind opponentKind; // Stock or Meme (derby)
        address opponentToken; // stock B20 token or rival memecoin contract
        string opponentSymbol; // display symbol, e.g. "NVDAc"
        address creator;
        string creatorName;
        uint64 createdAt;
        uint64 windowStart; // createdAt + WINDOW_LEAD, staking closes here
        uint64 windowEnd; // windowStart + windowDuration, resolve allowed at or after
        uint64 windowDuration; // BLITZ_WINDOW or STANDARD_WINDOW
        uint64 voidAfter; // windowEnd + VOID_WINDOW, recorded for parity
        bool cupTie; // Weekly Meme Cup tie: no duplicate guard, explicit tiebreak
        uint8 outcomeCount; // always 2 (0 = Yes, 1 = No)
        uint256 seedAmount; // CREATION_SEED, unallocated until settlement
        uint256 totalStaked;
        ClashState state;
        uint256 winnerBitmap; // bit o set => outcome o wins
        uint256 payoutPerShare; // 1e18 fixed point, set at resolution
        uint256 memeStartPrice; // resolver-submitted snapshots, 1e8 scale
        uint256 memeEndPrice;
        uint256 oppStartPrice;
        uint256 oppEndPrice;
    }

    IERC20 public tick;
    address public treasury;
    /// @notice The only address allowed to resolve clashes, by submitting
    /// the four window snapshot prices. Set at initialize, rotatable by
    /// the owner via setResolver. In production this is the backend signer.
    address public resolver;

    uint16 public treasuryFeeBps;
    uint16 public creatorFeeBps;
    uint16 public resolverFeeBps;

    uint256 public clashCount;

    mapping(uint256 => Clash) internal _clashes;
    // Stores clashId + 1 because clash id zero is valid. Non-cup clashes
    // only: cup ties skip the duplicate guard and are not indexed (see
    // the contract header). The active index tracks the currently Open
    // clash per exact set of terms, the created index the latest clash
    // ever created with those terms, mirroring StockMarketFactory's
    // activeMarket / createdMarket pair.
    mapping(bytes32 => uint256) internal _activeClashByKey;
    mapping(bytes32 => uint256) internal _createdClashByKey;

    mapping(uint256 => mapping(uint256 => uint256)) public outcomeTotals; // clashId => outcome => total staked
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) public stakes; // clashId => user => outcome => amount
    mapping(uint256 => mapping(address => bool)) public claimed; // clashId => user => claimed/refunded

    /// @notice Reserved storage for future upgrades. Never remove or reorder.
    uint256[48] private __gap;

    event ClashCreated(
        uint256 indexed clashId,
        address indexed memeToken,
        address indexed creator,
        address opponentToken,
        string memeSymbol,
        OpponentKind opponentKind,
        string opponentSymbol,
        string creatorName,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 windowDuration,
        bool cupTie
    );
    event ClashStaked(uint256 indexed clashId, address indexed user, uint256 outcome, uint256 amount);
    event ClashResolved(uint256 indexed clashId, uint256 winnerBitmap, uint256 payoutPerShare, address resolver);
    event ClashVoided(uint256 indexed clashId, address voider, string reason);
    event Claimed(uint256 indexed clashId, address indexed user, uint256 payout);
    event FeesUpdated(uint16 treasuryFeeBps, uint16 creatorFeeBps, uint16 resolverFeeBps);
    event TreasuryUpdated(address treasury);
    event ResolverUpdated(address resolver);

    error InvalidParams();
    error CreatorNameTooLong(uint256 length, uint256 max);
    error SymbolTooLong(uint256 length, uint256 max);
    error ClashNotOpen(uint256 clashId);
    error BettingClosed(uint256 clashId);
    error StakeTooLow(uint256 amount, uint256 min);
    error InvalidOutcome(uint256 clashId, uint256 outcome);
    error NotResolvableYet(uint256 clashId);
    error AlreadySettled(uint256 clashId);
    error AlreadyClaimed(uint256 clashId, address user);
    error NothingToClaim(uint256 clashId, address user);
    error FeeTooHigh(uint16 treasuryFeeBps, uint16 creatorFeeBps, uint16 resolverFeeBps);
    error DuplicateOpenClash(bytes32 clashKey, uint256 existingClashId);
    error OnlyResolver();
    error OnlyResolverOrOwner();
    error InvalidPrice();
    error ZeroAddress();
    error InvalidWindowDuration(uint64 windowDuration);
    error SameToken(address token);
    error CupTieRequiresExplicitWinner(uint256 clashId);
    error NotCupTie(uint256 clashId);
    error MovesNotEqual(uint256 clashId, int256 memeMove, int256 oppMove);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer, called through the proxy by the deploy
    /// script. tickToken must be the reused TICK
    /// (0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b), never a fresh token.
    /// resolverAddress is the backend signer that submits snapshot prices.
    function initialize(
        address initialOwner,
        address tickToken,
        address treasuryAddress,
        address resolverAddress
    ) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        if (tickToken == address(0) || treasuryAddress == address(0) || resolverAddress == address(0)) {
            revert ZeroAddress();
        }
        tick = IERC20(tickToken);
        treasury = treasuryAddress;
        resolver = resolverAddress;
        treasuryFeeBps = MemeClashConstants.TREASURY_FEE_BPS;
        creatorFeeBps = MemeClashConstants.CREATOR_FEE_BPS;
        resolverFeeBps = MemeClashConstants.RESOLVER_FEE_BPS;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // =========================================================================
    // VIEWS (split into two tuples like StockMarketFactory, for compiler parity)
    // =========================================================================

    /// @notice Clash identity and schedule.
    function clashInfo(uint256 clashId)
        external
        view
        returns (
            address memeToken,
            string memory memeSymbol,
            OpponentKind opponentKind,
            address opponentToken,
            string memory opponentSymbol,
            address creator,
            string memory creatorName,
            uint64 createdAt,
            uint64 windowStart,
            uint64 windowEnd,
            bool cupTie,
            uint8 outcomeCount
        )
    {
        Clash storage c = _clashes[clashId];
        return (
            c.memeToken,
            c.memeSymbol,
            c.opponentKind,
            c.opponentToken,
            c.opponentSymbol,
            c.creator,
            c.creatorName,
            c.createdAt,
            c.windowStart,
            c.windowEnd,
            c.cupTie,
            c.outcomeCount
        );
    }

    /// @notice Clash accounting and settlement state, with the four
    /// resolver-submitted snapshot prices appended after
    /// StockMarketFactory.marketSettlement's six fields, in the same
    /// order, so anyone can recompute both moves and audit the outcome.
    function clashSettlement(uint256 clashId)
        external
        view
        returns (
            uint256 seedAmount,
            uint256 totalStaked,
            ClashState state,
            uint256 winnerBitmap,
            uint256 payoutPerShare,
            uint256 memeStartPrice,
            uint256 memeEndPrice,
            uint256 oppStartPrice,
            uint256 oppEndPrice
        )
    {
        Clash storage c = _clashes[clashId];
        return (
            c.seedAmount,
            c.totalStaked,
            c.state,
            c.winnerBitmap,
            c.payoutPerShare,
            c.memeStartPrice,
            c.memeEndPrice,
            c.oppStartPrice,
            c.oppEndPrice
        );
    }

    /// @notice Returns the currently open non-cup clash with these exact
    /// terms. Cup ties are never indexed (see the contract header).
    function activeClash(
        address memeToken,
        address opponentToken,
        uint64 windowDuration
    ) external view returns (bool exists, uint256 clashId) {
        uint256 stored = _activeClashByKey[_clashKey(memeToken, opponentToken, windowDuration)];
        if (stored == 0) return (false, 0);
        return (true, stored - 1);
    }

    /// @notice Returns the latest non-cup clash ever created with these
    /// exact terms, even if it has since resolved or been voided. Powers
    /// the create flow's already-created detection, same as
    /// StockMarketFactory.createdMarket.
    function createdClash(
        address memeToken,
        address opponentToken,
        uint64 windowDuration
    ) external view returns (bool created, uint256 clashId) {
        uint256 stored = _createdClashByKey[_clashKey(memeToken, opponentToken, windowDuration)];
        if (stored == 0) return (false, 0);
        return (true, stored - 1);
    }

    // =========================================================================
    // ADMIN
    // =========================================================================

    function setFees(uint16 _treasuryFeeBps, uint16 _creatorFeeBps, uint16 _resolverFeeBps)
        external
        onlyOwner
    {
        if (
            uint256(_treasuryFeeBps) + uint256(_creatorFeeBps) + uint256(_resolverFeeBps)
                > MemeClashConstants.MAX_FEE_BPS
        ) {
            revert FeeTooHigh(_treasuryFeeBps, _creatorFeeBps, _resolverFeeBps);
        }
        treasuryFeeBps = _treasuryFeeBps;
        creatorFeeBps = _creatorFeeBps;
        resolverFeeBps = _resolverFeeBps;
        emit FeesUpdated(_treasuryFeeBps, _creatorFeeBps, _resolverFeeBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /// @notice Rotate the authorized resolver (for example if the backend
    /// signer key rotates). Only the new resolver can resolve afterwards.
    function setResolver(address _resolver) external onlyOwner {
        if (_resolver == address(0)) revert ZeroAddress();
        resolver = _resolver;
        emit ResolverUpdated(_resolver);
    }

    // =========================================================================
    // CLASH LIFECYCLE
    // =========================================================================

    /// @notice Create an outperform clash. Pulls CREATION_SEED (250 TICK)
    /// from the caller into the pool as unallocated seed liquidity,
    /// exactly as StockMarketFactory.createMarket does. The window
    /// starts WINDOW_LEAD (1 hour) after creation and staking closes
    /// when it starts.
    /// @param memeToken BaseStonk memecoin contract address of the meme.
    /// @param memeSymbol Display symbol of the meme, e.g. "BLUECHIP"
    /// (max 16 bytes). Display only: identity is the token address.
    /// @param opponentKind Stock for the paired stock, Meme for a derby
    /// against another memecoin on the same stock.
    /// @param opponentToken Contract address of the opponent: the B20
    /// stock token for Stock, the rival memecoin for Meme. Must differ
    /// from memeToken.
    /// @param opponentSymbol Display symbol of the opponent (max 16 bytes).
    /// @param windowDuration BLITZ_WINDOW (1 hour) or STANDARD_WINDOW
    /// (24 hours), nothing else.
    /// @param cupTie True only for Weekly Meme Cup ties created by the
    /// cup seeder: skips the duplicate guard and requires an explicit
    /// tiebreak winner on an exact move tie (see resolveCupTie).
    /// @param creatorName Display name attached to the clash
    /// (self-attested, max 32 bytes), shown in the UI as "created by".
    function createClash(
        address memeToken,
        string calldata memeSymbol,
        OpponentKind opponentKind,
        address opponentToken,
        string calldata opponentSymbol,
        uint64 windowDuration,
        bool cupTie,
        string calldata creatorName
    ) external nonReentrant returns (uint256 clashId) {
        // Validation and duplicate checks live in their own scope so their
        // locals are gone before the storage writes and the emit below
        // (solc stack-too-deep guard, same reason StockMarketFactory
        // splits its helpers).
        bytes32 clashKey;
        uint64 windowStart;
        uint64 windowEnd;
        {
            if (memeToken == address(0) || opponentToken == address(0)) revert InvalidParams();
            if (memeToken == opponentToken) revert SameToken(memeToken);
            if (bytes(memeSymbol).length == 0 || bytes(opponentSymbol).length == 0) {
                revert InvalidParams();
            }
            if (bytes(memeSymbol).length > MemeClashConstants.MAX_SYMBOL_BYTES) {
                revert SymbolTooLong(bytes(memeSymbol).length, MemeClashConstants.MAX_SYMBOL_BYTES);
            }
            if (bytes(opponentSymbol).length > MemeClashConstants.MAX_SYMBOL_BYTES) {
                revert SymbolTooLong(bytes(opponentSymbol).length, MemeClashConstants.MAX_SYMBOL_BYTES);
            }
            if (bytes(creatorName).length > MemeClashConstants.MAX_CREATOR_NAME_BYTES) {
                revert CreatorNameTooLong(
                    bytes(creatorName).length, MemeClashConstants.MAX_CREATOR_NAME_BYTES
                );
            }
            if (
                uint256(windowDuration) != MemeClashConstants.BLITZ_WINDOW
                    && uint256(windowDuration) != MemeClashConstants.STANDARD_WINDOW
            ) {
                revert InvalidWindowDuration(windowDuration);
            }

            windowStart = uint64(block.timestamp) + uint64(MemeClashConstants.WINDOW_LEAD);
            windowEnd = windowStart + windowDuration;

            clashKey = _clashKey(memeToken, opponentToken, windowDuration);
            if (!cupTie) {
                uint256 existingClashId = _activeClashByKey[clashKey];
                if (existingClashId != 0) {
                    revert DuplicateOpenClash(clashKey, existingClashId - 1);
                }
            }
        }

        tick.safeTransferFrom(msg.sender, address(this), MemeClashConstants.CREATION_SEED);

        clashId = clashCount++;
        if (!cupTie) {
            _activeClashByKey[clashKey] = clashId + 1;
            _createdClashByKey[clashKey] = clashId + 1;
        }
        Clash storage c = _clashes[clashId];
        c.memeToken = memeToken;
        c.memeSymbol = memeSymbol;
        c.opponentKind = opponentKind;
        c.opponentToken = opponentToken;
        c.opponentSymbol = opponentSymbol;
        c.creator = msg.sender;
        c.creatorName = creatorName;
        c.createdAt = uint64(block.timestamp);
        c.windowStart = windowStart;
        c.windowEnd = windowEnd;
        c.windowDuration = windowDuration;
        c.voidAfter = windowEnd + uint64(MemeClashConstants.VOID_WINDOW);
        c.cupTie = cupTie;
        c.outcomeCount = MemeClashConstants.OUTCOME_COUNT;
        c.seedAmount = MemeClashConstants.CREATION_SEED;
        c.totalStaked = 0;
        c.state = ClashState.Open;

        _emitClashCreated(clashId, c);
    }

    /// @dev Emits ClashCreated from stored clash fields. Split out of
    /// createClash to keep its stack shallow (see the scope note there).
    function _emitClashCreated(uint256 clashId, Clash storage c) internal {
        emit ClashCreated(
            clashId,
            c.memeToken,
            c.creator,
            c.opponentToken,
            c.memeSymbol,
            c.opponentKind,
            c.opponentSymbol,
            c.creatorName,
            c.windowStart,
            c.windowEnd,
            c.windowDuration,
            c.cupTie
        );
    }

    /// @notice Stake TICK on an outcome: 0 = Yes (the meme outperforms),
    /// 1 = No. The creator may stake on their own clash like anyone
    /// else, any time before the window starts. Staking closes exactly
    /// at windowStart: once the moves being predicted have begun, no
    /// new stake is accepted.
    function stake(uint256 clashId, uint256 outcome, uint256 amount) external nonReentrant {
        Clash storage c = _clashes[clashId];
        if (c.state != ClashState.Open) revert ClashNotOpen(clashId);
        if (outcome >= c.outcomeCount) revert InvalidOutcome(clashId, outcome);
        if (amount < MemeClashConstants.MIN_STAKE) {
            revert StakeTooLow(amount, MemeClashConstants.MIN_STAKE);
        }
        if (block.timestamp >= c.windowStart) revert BettingClosed(clashId);

        tick.safeTransferFrom(msg.sender, address(this), amount);
        stakes[clashId][msg.sender][outcome] += amount;
        outcomeTotals[clashId][outcome] += amount;
        c.totalStaked += amount;

        emit ClashStaked(clashId, msg.sender, outcome, amount);
    }

    /// @notice Resolve a clash by submitting the four window snapshot
    /// prices. Only the authorized resolver may call this (see the
    /// contract header for why arena resolution is not permissionless),
    /// only at or after windowEnd, and the caller earns the resolver
    /// fee. The factory computes both percent moves itself from the
    /// submitted prices, so the resolver reports prices, never a winner.
    ///
    /// OUTCOME RULE, exact: Yes wins if and only if memeMove is strictly
    /// greater than oppMove. If the moves are exactly equal on a
    /// non-cup clash, No wins. On a cupTie clash an exact tie reverts
    /// with CupTieRequiresExplicitWinner: settle it via resolveCupTie.
    ///
    /// CIRCUIT BREAKER: if either move's absolute value is at least
    /// SPIKE_BREAKER_MOVE (30 percent), the clash voids inside this
    /// call instead of settling (seed back to the creator, stakes
    /// refundable 1:1 via claim(), ClashVoided with the breaker
    /// reason). The breaker is checked before the tie rule, so a tied
    /// cup clash inside a spiked window voids rather than reverting.
    ///
    /// @param memeStartPrice Meme price at windowStart, 1e8 scale.
    /// @param memeEndPrice Meme price at windowEnd, 1e8 scale.
    /// @param oppStartPrice Opponent price at windowStart, 1e8 scale.
    /// @param oppEndPrice Opponent price at windowEnd, 1e8 scale.
    /// Every price must be non-zero: a side with no price at a snapshot
    /// cannot be resolved with a fabricated price, void the clash
    /// instead so stakes refund 1:1.
    function resolve(
        uint256 clashId,
        uint256 memeStartPrice,
        uint256 memeEndPrice,
        uint256 oppStartPrice,
        uint256 oppEndPrice
    ) external nonReentrant {
        if (msg.sender != resolver) revert OnlyResolver();
        Clash storage c = _clashes[clashId];
        if (c.state != ClashState.Open) revert AlreadySettled(clashId);
        if (block.timestamp < c.windowEnd) revert NotResolvableYet(clashId);
        (int256 memeMove, int256 oppMove) =
            _moves(memeStartPrice, memeEndPrice, oppStartPrice, oppEndPrice);

        if (_breakerBreached(memeMove, oppMove)) {
            _voidForBreaker(clashId, c, memeStartPrice, memeEndPrice, oppStartPrice, oppEndPrice);
            return;
        }
        if (memeMove == oppMove) {
            if (c.cupTie) revert CupTieRequiresExplicitWinner(clashId);
            _settle(clashId, c, memeStartPrice, memeEndPrice, oppStartPrice, oppEndPrice, false);
            return;
        }
        _settle(clashId, c, memeStartPrice, memeEndPrice, oppStartPrice, oppEndPrice, memeMove > oppMove);
    }

    /// @notice Settle a Weekly Meme Cup tie whose two moves are exactly
    /// equal, with the winner decided by the off-chain cup tiebreak
    /// (higher window volume, then higher seed). Resolver only, cupTie
    /// clashes only, at or after windowEnd, with the same price and
    /// breaker rules as resolve(): the moves are recomputed here, a
    /// breached breaker voids the clash, and if the recomputed moves
    /// are not exactly equal this reverts with MovesNotEqual (a decisive
    /// clash settles through resolve(), never through here).
    /// @param memeWins True if the tiebreak advances the meme (Yes wins),
    /// false if it advances the opponent (No wins).
    function resolveCupTie(
        uint256 clashId,
        uint256 memeStartPrice,
        uint256 memeEndPrice,
        uint256 oppStartPrice,
        uint256 oppEndPrice,
        bool memeWins
    ) external nonReentrant {
        if (msg.sender != resolver) revert OnlyResolver();
        Clash storage c = _clashes[clashId];
        if (c.state != ClashState.Open) revert AlreadySettled(clashId);
        if (block.timestamp < c.windowEnd) revert NotResolvableYet(clashId);
        if (!c.cupTie) revert NotCupTie(clashId);
        (int256 memeMove, int256 oppMove) =
            _moves(memeStartPrice, memeEndPrice, oppStartPrice, oppEndPrice);

        if (_breakerBreached(memeMove, oppMove)) {
            _voidForBreaker(clashId, c, memeStartPrice, memeEndPrice, oppStartPrice, oppEndPrice);
            return;
        }
        if (memeMove != oppMove) revert MovesNotEqual(clashId, memeMove, oppMove);
        _settle(clashId, c, memeStartPrice, memeEndPrice, oppStartPrice, oppEndPrice, memeWins);
    }

    /// @notice Void a clash before resolution. Callable by the resolver
    /// or the owner only, at any time while the clash is Open (the
    /// intended use is a side whose price never arrives, so the clash
    /// can never be resolved honestly). Stakes are pull-refunded 1:1
    /// via claim() with no fee taken, and the seed returns to the
    /// creator immediately, exactly as StockMarketFactory.voidMarket.
    function voidClash(uint256 clashId) external nonReentrant {
        if (msg.sender != resolver && msg.sender != owner()) revert OnlyResolverOrOwner();
        Clash storage c = _clashes[clashId];
        if (c.state != ClashState.Open) revert AlreadySettled(clashId);

        c.state = ClashState.Voided;
        if (!c.cupTie) {
            delete _activeClashByKey[_clashKey(c.memeToken, c.opponentToken, c.windowDuration)];
        }
        uint256 seed = c.seedAmount;
        c.seedAmount = 0;
        if (seed > 0) tick.safeTransfer(c.creator, seed);

        emit ClashVoided(clashId, msg.sender, "manual void");
    }

    /// @notice Pull winnings (resolved clashes) or full refunds (voided
    /// clashes). One claim per user per clash, covering all their
    /// outcomes. Identical to StockMarketFactory.claim.
    function claim(uint256 clashId) external nonReentrant {
        Clash storage c = _clashes[clashId];
        if (c.state == ClashState.Open) revert ClashNotOpen(clashId);
        if (claimed[clashId][msg.sender]) revert AlreadyClaimed(clashId, msg.sender);
        claimed[clashId][msg.sender] = true;

        uint256 payout = 0;
        if (c.state == ClashState.Resolved) {
            for (uint256 o = 0; o < c.outcomeCount; o++) {
                if (((c.winnerBitmap >> o) & 1) == 1) {
                    uint256 s = stakes[clashId][msg.sender][o];
                    if (s > 0) payout += (s * c.payoutPerShare) / 1e18;
                }
            }
        } else {
            for (uint256 o = 0; o < c.outcomeCount; o++) {
                payout += stakes[clashId][msg.sender][o];
            }
        }

        if (payout == 0) revert NothingToClaim(clashId, msg.sender);
        tick.safeTransfer(msg.sender, payout);
        emit Claimed(clashId, msg.sender, payout);
    }

    // =========================================================================
    // INTERNAL
    // =========================================================================

    /// @dev Duplicate-prevention key over the clash's exact terms. The
    /// symbols are display only and deliberately excluded: the token
    /// addresses are the asset identity, so relabelling a symbol cannot
    /// be used to clone a clash.
    function _clashKey(
        address memeToken,
        address opponentToken,
        uint64 windowDuration
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(memeToken, opponentToken, windowDuration));
    }

    /// @dev Validates the four snapshot prices (every price non-zero,
    /// reverting InvalidPrice otherwise: a missing price is the void
    /// path, never a fabricated price) and computes both moves.
    function _moves(
        uint256 memeStartPrice,
        uint256 memeEndPrice,
        uint256 oppStartPrice,
        uint256 oppEndPrice
    ) internal pure returns (int256 memeMove, int256 oppMove) {
        if (
            memeStartPrice == 0 || memeEndPrice == 0 || oppStartPrice == 0 || oppEndPrice == 0
        ) {
            revert InvalidPrice();
        }
        memeMove = _computeMove(memeStartPrice, memeEndPrice);
        oppMove = _computeMove(oppStartPrice, oppEndPrice);
    }

    /// @dev Percent move in micro-percent units (1 percent = 1_000_000):
    /// (end - start) * 1e8 / start, where 1e8 is 100 * MOVE_SCALE and
    /// equals PRICE_SCALE (see MemeClashConstants). Signed: a price drop
    /// gives a negative move. Division truncates toward zero, exactly as
    /// integer division does for both signs in Solidity, so two moves
    /// tie only when the truncated micro-percent values are identical.
    function _computeMove(uint256 startPrice, uint256 endPrice) internal pure returns (int256) {
        return (int256(endPrice) - int256(startPrice)) * int256(MemeClashConstants.PRICE_SCALE)
            / int256(startPrice);
    }

    /// @dev True when either move breaches the 30 percent spike breaker.
    function _breakerBreached(int256 memeMove, int256 oppMove) internal pure returns (bool) {
        int256 breaker = int256(MemeClashConstants.SPIKE_BREAKER_MOVE);
        return _abs(memeMove) >= breaker || _abs(oppMove) >= breaker;
    }

    function _abs(int256 value) internal pure returns (int256) {
        return value >= 0 ? value : -value;
    }

    /// @dev Records the four snapshot prices on the clash at settlement
    /// (resolution or breaker void), so the outcome stays auditable.
    function _storePrices(
        Clash storage c,
        uint256 memeStartPrice,
        uint256 memeEndPrice,
        uint256 oppStartPrice,
        uint256 oppEndPrice
    ) internal {
        c.memeStartPrice = memeStartPrice;
        c.memeEndPrice = memeEndPrice;
        c.oppStartPrice = oppStartPrice;
        c.oppEndPrice = oppEndPrice;
    }

    /// @dev Breaker void inside resolve / resolveCupTie: identical
    /// settlement to voidClash (seed back to the creator at once, stakes
    /// refundable 1:1 via claim()), with the snapshot prices stored and
    /// the breaker named as the void reason.
    function _voidForBreaker(
        uint256 clashId,
        Clash storage c,
        uint256 memeStartPrice,
        uint256 memeEndPrice,
        uint256 oppStartPrice,
        uint256 oppEndPrice
    ) internal {
        _storePrices(c, memeStartPrice, memeEndPrice, oppStartPrice, oppEndPrice);
        c.state = ClashState.Voided;
        if (!c.cupTie) {
            delete _activeClashByKey[_clashKey(c.memeToken, c.opponentToken, c.windowDuration)];
        }
        uint256 seed = c.seedAmount;
        c.seedAmount = 0;
        if (seed > 0) tick.safeTransfer(c.creator, seed);

        emit ClashVoided(clashId, msg.sender, "spike breaker: 30 percent move");
    }

    /// @dev Resolution settlement, economics identical to
    /// StockMarketFactory.resolve: fees on staked volume only, paid at
    /// resolve time; winners share the post-fee stakes plus the whole
    /// seed; zero stakes sends the seed to the treasury; a winning side
    /// with zero stakers sweeps stakes plus seed entirely to the
    /// treasury with no separate fees taken.
    function _settle(
        uint256 clashId,
        Clash storage c,
        uint256 memeStartPrice,
        uint256 memeEndPrice,
        uint256 oppStartPrice,
        uint256 oppEndPrice,
        bool yesWins
    ) internal {
        uint256 winnerBitmap =
            yesWins ? uint256(1) << MemeClashConstants.OUTCOME_YES : uint256(1) << MemeClashConstants.OUTCOME_NO;

        _storePrices(c, memeStartPrice, memeEndPrice, oppStartPrice, oppEndPrice);
        c.state = ClashState.Resolved;
        c.winnerBitmap = winnerBitmap;
        if (!c.cupTie) {
            delete _activeClashByKey[_clashKey(c.memeToken, c.opponentToken, c.windowDuration)];
        }

        uint256 totalStaked = c.totalStaked;
        uint256 seed = c.seedAmount;
        c.seedAmount = 0;

        if (totalStaked == 0) {
            // No bettors: the seed goes to the treasury (spam deterrent).
            tick.safeTransfer(treasury, seed);
            emit ClashResolved(clashId, 0, 0, msg.sender);
            return;
        }

        uint256 treasuryFee = (totalStaked * treasuryFeeBps) / 10_000;
        uint256 creatorFee = (totalStaked * creatorFeeBps) / 10_000;
        uint256 resolverFee = (totalStaked * resolverFeeBps) / 10_000;

        // Winners share the post-fee stakes plus the entire seed subsidy.
        uint256 distributable = totalStaked - treasuryFee - creatorFee - resolverFee + seed;

        uint256 winningStakes =
            outcomeTotals[clashId][yesWins ? MemeClashConstants.OUTCOME_YES : MemeClashConstants.OUTCOME_NO];

        if (winningStakes == 0) {
            // Winning outcome has no stakers: sweep everything to the
            // treasury (mirrors StockMarketFactory's zero-staker rule).
            tick.safeTransfer(treasury, totalStaked + seed);
            emit ClashResolved(clashId, winnerBitmap, 0, msg.sender);
            return;
        }

        c.payoutPerShare = (distributable * 1e18) / winningStakes;

        if (treasuryFee > 0) tick.safeTransfer(treasury, treasuryFee);
        if (creatorFee > 0) tick.safeTransfer(c.creator, creatorFee);
        if (resolverFee > 0) tick.safeTransfer(msg.sender, resolverFee);

        emit ClashResolved(clashId, winnerBitmap, c.payoutPerShare, msg.sender);
    }
}

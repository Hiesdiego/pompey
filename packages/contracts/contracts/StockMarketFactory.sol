// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { StockMarketConstants, StockDirection } from "./StockMarketConstants.sol";

/// @title StockMarketFactory - permissionless TICKR stock price target markets.
///
/// @notice Anyone can create a Yes/No price target market on any Base B20
/// tokenized stock: "Will [STOCK] be above or below $X by [date]?" The
/// stock is identified by its B20 token contract address plus its symbol
/// string (for example the NVDAc token at 0xB200... with symbol "NVDAc").
/// The list of stocks is dynamic: any token address with a live NAV can
/// be named at creation, there is no fixed roster in this contract.
///
/// This contract is a sibling of the crypto MarketFactory, NOT a
/// modification of it. The lifecycle, economics and event shapes mirror
/// MarketFactory so the backend keeper and frontend patterns carry over:
///
/// Economics (all in TICK, identical to MarketFactory):
/// - Creation costs CREATION_SEED (250 TICK), paid into the market's pool
///   as UNALLOCATED seed liquidity, pulled from the creator via
///   transferFrom at creation. It is not staked on any outcome. At
///   settlement it is added whole to the winners' payout pool.
/// - Fees apply to STAKED volume only (never to the seed): treasuryFeeBps
///   (default 300, 3 percent) to treasury, creatorFeeBps (default 200,
///   2 percent) to the market creator, resolverFeeBps (default 100,
///   1 percent) to the resolver who calls resolve().
/// - Winners share (staked * (1 - totalFees) + seed) pro-rata by stake,
///   via payoutPerShare fixed point exactly as MarketFactory computes it.
/// - Every market terminates in exactly one of: RESOLVED (payouts) or
///   VOIDED (full stake refunds plus seed back to creator). Funds can
///   never be stuck.
/// - A market that resolves with zero stakes sends its seed to the
///   treasury (spam deterrent); a market whose winning outcome has zero
///   stakes sweeps everything (stakes plus seed) to the treasury. Both
///   rules are copied from MarketFactory, which mirrors PredictionPool.
///
/// @dev STOCK DIFFERENCES FROM CRYPTO MarketFactory (kept minimal):
///   - ASSET IDENTITY: a crypto TARGET market names a teamId resolved
///     through SeasonRegistry and PriceOracle checkpoints. A stock market
///     instead stores the B20 token address, the symbol string, a
///     direction (Above or Below), a target price and a deadline
///     directly on the market. There is exactly one market type here, so
///     createMarket takes those fields explicitly instead of a template
///     id plus abi-encoded params.
///   - RESOLUTION SOURCE: crypto resolution is permissionless because
///     anyone can recompute the winner from on-chain oracle checkpoints.
///     A stock NAV at the deadline lives off chain (Coinbase API,
///     Chainlink NAV) and there is no on-chain checkpoint feed for it in
///     this stack, so the final price must be submitted. Only the
///     authorized `resolver` (the backend signer) may call resolve(),
///     and it submits the final NAV price with the call. The resolver
///     earns the same 1 percent resolver fee MarketFactory pays its
///     resolve() caller. The submitted price is stored on the market as
///     finalPrice so anyone can audit the outcome after the fact.
///   - PRICE SCALE: crypto checkpoint prices use the oracle's own scale.
///     Stock target and resolution prices are uint256 at a fixed 1e8
///     scale (StockMarketConstants.PRICE_SCALE): a NAV of 53.339875 USD
///     is submitted as 5333987500. See StockMarketConstants.
///   - VOID: MarketFactory has no admin void. Its void is optimistic and
///     permissionless: initiateVoid after endTime + 7 days, gated on the
///     market being unresolvable from on-chain data, then a 2 day
///     challenge, then finalizeVoid. That gate cannot be ported here
///     because resolvability depends on an off-chain NAV only the
///     resolver can submit, so there is no on-chain data whose absence
///     proves a market unresolvable. Instead, voidMarket() is callable
///     by the resolver or the owner at any time before resolution,
///     following the stock stack's own void convention
///     (StockPredictionPool.voidFixture: an authorized caller voids,
///     stakes refund 1:1 through claim(), no fee on refunds). The seed
///     returns to the creator at void time, exactly as MarketFactory's
///     finalizeVoid returns it. voidAfter is still recorded on every
///     market for shape parity with MarketFactory.
///   - UUPS UPGRADEABLE: MarketFactory is a plain Ownable deployment.
///     The stock stack is UUPS upgradeable (StockPriceOracle,
///     StockPredictionPool), so this factory is too: initialize()
///     replaces the constructor, upgrades are owner-only, and the deploy
///     script wraps it in StockERC1967Proxy like every stock contract.
contract StockMarketFactory is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    enum MarketState {
        Open,
        Resolved,
        Voided
    }

    struct Market {
        address stockToken; // Base B20 token contract for the stock
        string stockSymbol; // display symbol, e.g. "NVDAc"
        StockDirection direction; // Above or Below the target
        uint256 targetPrice; // 1e8 scale, see StockMarketConstants
        address creator;
        string creatorName;
        uint64 createdAt;
        uint64 bettingCloseTime; // no stakes at or after this
        uint64 endTime; // the deadline: resolve() allowed at or after this
        uint64 voidAfter; // endTime + VOID_WINDOW, recorded for parity
        uint8 outcomeCount; // always 2 (0 = Yes, 1 = No)
        uint256 seedAmount; // CREATION_SEED, unallocated until settlement
        uint256 totalStaked;
        MarketState state;
        uint256 winnerBitmap; // bit o set => outcome o wins
        uint256 payoutPerShare; // 1e18 fixed point, set at resolution
        uint256 finalPrice; // resolver-submitted NAV at resolution, 1e8 scale
    }

    IERC20 public tick;
    address public treasury;
    /// @notice The only address allowed to resolve markets, by submitting
    /// the final NAV price. Set at initialize, rotatable by the owner via
    /// setResolver. In production this is the backend signer.
    address public resolver;

    uint16 public treasuryFeeBps;
    uint16 public creatorFeeBps;
    uint16 public resolverFeeBps;

    uint256 public marketCount;

    mapping(uint256 => Market) internal _markets;
    // Stores marketId + 1 because market id zero is valid. Same duplicate
    // prevention as MarketFactory: one market per exact set of terms,
    // ever, so the permissionless catalogue stays one-to-one with the
    // underlying question and liquidity never splits across clones.
    mapping(bytes32 => uint256) internal _activeMarketByKey;
    mapping(bytes32 => uint256) internal _createdMarketByKey;

    mapping(uint256 => mapping(uint256 => uint256)) public outcomeTotals; // marketId => outcome => total staked
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) public stakes; // marketId => user => outcome => amount
    mapping(uint256 => mapping(address => bool)) public claimed; // marketId => user => claimed/refunded

    /// @notice Reserved storage for future upgrades. Never remove or reorder.
    uint256[48] private __gap;

    event MarketCreated(
        uint256 indexed marketId,
        address indexed stockToken,
        address indexed creator,
        string stockSymbol,
        string creatorName,
        StockDirection direction,
        uint256 targetPrice,
        uint64 bettingCloseTime,
        uint64 endTime
    );
    event MarketStaked(uint256 indexed marketId, address indexed user, uint256 outcome, uint256 amount);
    event MarketResolved(uint256 indexed marketId, uint256 winnerBitmap, uint256 payoutPerShare, address resolver);
    event MarketVoided(uint256 indexed marketId, address voider);
    event Claimed(uint256 indexed marketId, address indexed user, uint256 payout);
    event FeesUpdated(uint16 treasuryFeeBps, uint16 creatorFeeBps, uint16 resolverFeeBps);
    event TreasuryUpdated(address treasury);
    event ResolverUpdated(address resolver);

    error InvalidParams();
    error CreatorNameTooLong(uint256 length, uint256 max);
    error SymbolTooLong(uint256 length, uint256 max);
    error MarketNotOpen(uint256 marketId);
    error BettingClosed(uint256 marketId);
    error StakeTooLow(uint256 amount, uint256 min);
    error InvalidOutcome(uint256 marketId, uint256 outcome);
    error NotResolvableYet(uint256 marketId);
    error AlreadySettled(uint256 marketId);
    error AlreadyClaimed(uint256 marketId, address user);
    error NothingToClaim(uint256 marketId, address user);
    error FeeTooHigh(uint16 treasuryFeeBps, uint16 creatorFeeBps, uint16 resolverFeeBps);
    error DuplicateOpenMarket(bytes32 marketKey, uint256 existingMarketId);
    error OnlyResolver();
    error OnlyResolverOrOwner();
    error InvalidPrice();
    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer, called through the proxy by the deploy
    /// script. tickToken must be the reused TICK
    /// (0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b), never a fresh token.
    /// resolverAddress is the backend signer that submits final NAV prices.
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
        treasuryFeeBps = StockMarketConstants.TREASURY_FEE_BPS;
        creatorFeeBps = StockMarketConstants.CREATOR_FEE_BPS;
        resolverFeeBps = StockMarketConstants.RESOLVER_FEE_BPS;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // =========================================================================
    // VIEWS (split into two tuples like MarketFactory, for compiler parity)
    // =========================================================================

    /// @notice Market identity and schedule.
    function marketInfo(uint256 marketId)
        external
        view
        returns (
            address stockToken,
            string memory stockSymbol,
            StockDirection direction,
            uint256 targetPrice,
            address creator,
            string memory creatorName,
            uint64 createdAt,
            uint64 bettingCloseTime,
            uint64 endTime,
            uint64 voidAfter,
            uint8 outcomeCount
        )
    {
        Market storage m = _markets[marketId];
        return (
            m.stockToken,
            m.stockSymbol,
            m.direction,
            m.targetPrice,
            m.creator,
            m.creatorName,
            m.createdAt,
            m.bettingCloseTime,
            m.endTime,
            m.voidAfter,
            m.outcomeCount
        );
    }

    /// @notice Market accounting and settlement state.
    function marketSettlement(uint256 marketId)
        external
        view
        returns (
            uint256 seedAmount,
            uint256 totalStaked,
            MarketState state,
            uint256 winnerBitmap,
            uint256 payoutPerShare,
            uint256 finalPrice
        )
    {
        Market storage m = _markets[marketId];
        return (m.seedAmount, m.totalStaked, m.state, m.winnerBitmap, m.payoutPerShare, m.finalPrice);
    }

    /// @notice Returns the currently open market with these exact terms.
    function activeMarket(
        address stockToken,
        StockDirection direction,
        uint256 targetPrice,
        uint64 deadline
    ) external view returns (bool exists, uint256 marketId) {
        uint256 stored = _activeMarketByKey[_marketKey(stockToken, direction, targetPrice, deadline)];
        if (stored == 0) return (false, 0);
        return (true, stored - 1);
    }

    /// @notice Returns the market ever created with these exact terms, even
    /// if it has since resolved or been voided. Powers the create-market
    /// UI's already-created detection, same as MarketFactory.createdMarket.
    function createdMarket(
        address stockToken,
        StockDirection direction,
        uint256 targetPrice,
        uint64 deadline
    ) external view returns (bool created, uint256 marketId) {
        uint256 stored = _createdMarketByKey[_marketKey(stockToken, direction, targetPrice, deadline)];
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
                > StockMarketConstants.MAX_FEE_BPS
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
    // MARKET LIFECYCLE
    // =========================================================================

    /// @notice Create a stock price target market. Pulls CREATION_SEED
    /// (250 TICK) from the caller into the pool as unallocated seed
    /// liquidity, exactly as MarketFactory.createMarket does.
    /// @param stockToken Base B20 token contract address of the stock.
    /// @param stockSymbol Display symbol of the stock, e.g. "NVDAc"
    /// (max 16 bytes). Display only: identity is the token address.
    /// @param direction Above or Below the target price.
    /// @param targetPrice Target in USD at the 1e8 scale, e.g. a $150.00
    /// target is 150 * 1e8 = 15000000000. Must be non-zero.
    /// @param deadline The "by [date]" of the question. Resolution is
    /// allowed at or after it. Must be more than MIN_MARKET_LEAD (1 hour)
    /// in the future and no later than MAX_TARGET_TIME
    /// (Dec 31, 2026, 23:59:59 UTC).
    /// @param creatorName Display name attached to the market
    /// (self-attested, max 32 bytes), shown in the UI as "created by".
    function createMarket(
        address stockToken,
        string calldata stockSymbol,
        StockDirection direction,
        uint256 targetPrice,
        uint64 deadline,
        string calldata creatorName
    ) external nonReentrant returns (uint256 marketId) {
        // Validation and duplicate checks live in their own scope so their
        // locals are gone before the storage writes and the emit below
        // (solc stack-too-deep guard, same reason MarketFactory splits
        // its helpers).
        bytes32 marketKey;
        {
            if (stockToken == address(0)) revert InvalidParams();
            if (bytes(stockSymbol).length == 0) revert InvalidParams();
            if (bytes(stockSymbol).length > StockMarketConstants.MAX_SYMBOL_BYTES) {
                revert SymbolTooLong(bytes(stockSymbol).length, StockMarketConstants.MAX_SYMBOL_BYTES);
            }
            if (bytes(creatorName).length > StockMarketConstants.MAX_CREATOR_NAME_BYTES) {
                revert CreatorNameTooLong(
                    bytes(creatorName).length, StockMarketConstants.MAX_CREATOR_NAME_BYTES
                );
            }
            if (targetPrice == 0) revert InvalidParams();
            if (deadline <= uint64(block.timestamp) + uint64(StockMarketConstants.MIN_MARKET_LEAD)) {
                revert InvalidParams();
            }
            if (deadline > StockMarketConstants.MAX_TARGET_TIME) revert InvalidParams();

            marketKey = _marketKey(stockToken, direction, targetPrice, deadline);
            uint256 existingMarketId = _activeMarketByKey[marketKey];
            if (existingMarketId != 0) {
                revert DuplicateOpenMarket(marketKey, existingMarketId - 1);
            }
            uint256 createdMarketId = _createdMarketByKey[marketKey];
            if (createdMarketId != 0) {
                revert DuplicateOpenMarket(marketKey, createdMarketId - 1);
            }
        }

        tick.safeTransferFrom(msg.sender, address(this), StockMarketConstants.CREATION_SEED);

        marketId = marketCount++;
        _activeMarketByKey[marketKey] = marketId + 1;
        _createdMarketByKey[marketKey] = marketId + 1;
        Market storage m = _markets[marketId];
        m.stockToken = stockToken;
        m.stockSymbol = stockSymbol;
        m.direction = direction;
        m.targetPrice = targetPrice;
        m.creator = msg.sender;
        m.creatorName = creatorName;
        m.createdAt = uint64(block.timestamp);
        m.bettingCloseTime = deadline - uint64(StockMarketConstants.BETTING_CLOSE_BUFFER);
        m.endTime = deadline;
        m.voidAfter = deadline + uint64(StockMarketConstants.VOID_WINDOW);
        m.outcomeCount = StockMarketConstants.OUTCOME_COUNT;
        m.seedAmount = StockMarketConstants.CREATION_SEED;
        m.totalStaked = 0;
        m.state = MarketState.Open;

        _emitMarketCreated(marketId, m);
    }

    /// @dev Emits MarketCreated from stored market fields. Split out of
    /// createMarket to keep its stack shallow (see the scope note there).
    function _emitMarketCreated(uint256 marketId, Market storage m) internal {
        emit MarketCreated(
            marketId,
            m.stockToken,
            m.creator,
            m.stockSymbol,
            m.creatorName,
            m.direction,
            m.targetPrice,
            m.bettingCloseTime,
            m.endTime
        );
    }

    /// @notice Stake TICK on an outcome: 0 = Yes, 1 = No. The creator may
    /// stake on their own market like anyone else, any time before betting
    /// closes (BETTING_CLOSE_BUFFER, 5 minutes, before the deadline).
    function stake(uint256 marketId, uint256 outcome, uint256 amount) external nonReentrant {
        Market storage m = _markets[marketId];
        if (m.state != MarketState.Open) revert MarketNotOpen(marketId);
        if (outcome >= m.outcomeCount) revert InvalidOutcome(marketId, outcome);
        if (amount < StockMarketConstants.MIN_STAKE) {
            revert StakeTooLow(amount, StockMarketConstants.MIN_STAKE);
        }
        if (block.timestamp >= m.bettingCloseTime) revert BettingClosed(marketId);

        tick.safeTransferFrom(msg.sender, address(this), amount);
        stakes[marketId][msg.sender][outcome] += amount;
        outcomeTotals[marketId][outcome] += amount;
        m.totalStaked += amount;

        emit MarketStaked(marketId, msg.sender, outcome, amount);
    }

    /// @notice Resolve a market by submitting the stock's final NAV price
    /// at the deadline. Only the authorized resolver may call this (see
    /// the contract header for why stock resolution is not permissionless
    /// like MarketFactory's), only at or after the deadline, and the
    /// caller earns the resolver fee. The submitted price is stored as
    /// finalPrice on the market.
    ///
    /// TIE RULE, exact: an Above market resolves Yes if and only if
    /// finalPrice > targetPrice (strictly greater). A Below market
    /// resolves Yes if and only if finalPrice <= targetPrice. So at
    /// exactly the target price, an Above market resolves No (No wins)
    /// and a Below market resolves Yes (Yes wins). There is no tie
    /// outcome and no split: every resolved market has exactly one
    /// winning outcome.
    ///
    /// @param finalPrice NAV at the deadline, USD at the 1e8 scale (the
    /// Coinbase decimal NAV multiplied by 1e8), e.g. 53.339875 becomes
    /// 5333987500. Must be non-zero: a stock with no NAV at the deadline
    /// cannot be resolved with a fabricated price, void the market
    /// instead so stakes refund 1:1.
    function resolve(uint256 marketId, uint256 finalPrice) external nonReentrant {
        if (msg.sender != resolver) revert OnlyResolver();
        Market storage m = _markets[marketId];
        if (m.state != MarketState.Open) revert AlreadySettled(marketId);
        if (block.timestamp < m.endTime) revert NotResolvableYet(marketId);
        if (finalPrice == 0) revert InvalidPrice();

        bool yesWins;
        if (m.direction == StockDirection.Above) {
            yesWins = finalPrice > m.targetPrice;
        } else {
            yesWins = finalPrice <= m.targetPrice;
        }
        uint256 winnerBitmap =
            yesWins ? uint256(1) << StockMarketConstants.OUTCOME_YES : uint256(1) << StockMarketConstants.OUTCOME_NO;

        m.state = MarketState.Resolved;
        m.winnerBitmap = winnerBitmap;
        m.finalPrice = finalPrice;
        delete _activeMarketByKey[_marketKey(m.stockToken, m.direction, m.targetPrice, m.endTime)];

        uint256 totalStaked = m.totalStaked;
        uint256 seed = m.seedAmount;
        m.seedAmount = 0;

        if (totalStaked == 0) {
            // No bettors: the seed goes to the treasury (spam deterrent).
            tick.safeTransfer(treasury, seed);
            emit MarketResolved(marketId, 0, 0, msg.sender);
            return;
        }

        uint256 treasuryFee = (totalStaked * treasuryFeeBps) / 10_000;
        uint256 creatorFee = (totalStaked * creatorFeeBps) / 10_000;
        uint256 resolverFee = (totalStaked * resolverFeeBps) / 10_000;

        // Winners share the post-fee stakes plus the entire seed subsidy.
        uint256 distributable = totalStaked - treasuryFee - creatorFee - resolverFee + seed;

        uint256 winningStakes =
            outcomeTotals[marketId][yesWins ? StockMarketConstants.OUTCOME_YES : StockMarketConstants.OUTCOME_NO];

        if (winningStakes == 0) {
            // Winning outcome has no stakers: sweep everything to the
            // treasury (mirrors PredictionPool's zero-staker rule).
            tick.safeTransfer(treasury, totalStaked + seed);
            emit MarketResolved(marketId, winnerBitmap, 0, msg.sender);
            return;
        }

        m.payoutPerShare = (distributable * 1e18) / winningStakes;

        if (treasuryFee > 0) tick.safeTransfer(treasury, treasuryFee);
        if (creatorFee > 0) tick.safeTransfer(m.creator, creatorFee);
        if (resolverFee > 0) tick.safeTransfer(msg.sender, resolverFee);

        emit MarketResolved(marketId, winnerBitmap, m.payoutPerShare, msg.sender);
    }

    /// @notice Void a market before resolution. Callable by the resolver
    /// or the owner only, at any time while the market is Open (the
    /// intended use is a stock whose NAV never arrives, so the market can
    /// never be resolved honestly). Stakes are pull-refunded 1:1 via
    /// claim() with no fee taken, and the seed returns to the creator
    /// immediately, exactly as MarketFactory's finalizeVoid returns it.
    /// See the contract header for why this replaces MarketFactory's
    /// optimistic two-step void.
    function voidMarket(uint256 marketId) external nonReentrant {
        if (msg.sender != resolver && msg.sender != owner()) revert OnlyResolverOrOwner();
        Market storage m = _markets[marketId];
        if (m.state != MarketState.Open) revert AlreadySettled(marketId);

        m.state = MarketState.Voided;
        delete _activeMarketByKey[_marketKey(m.stockToken, m.direction, m.targetPrice, m.endTime)];
        uint256 seed = m.seedAmount;
        m.seedAmount = 0;
        if (seed > 0) tick.safeTransfer(m.creator, seed);

        emit MarketVoided(marketId, msg.sender);
    }

    /// @notice Pull winnings (resolved markets) or full refunds (voided
    /// markets). One claim per user per market, covering all their
    /// outcomes. Identical to MarketFactory.claim.
    function claim(uint256 marketId) external nonReentrant {
        Market storage m = _markets[marketId];
        if (m.state == MarketState.Open) revert MarketNotOpen(marketId);
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed(marketId, msg.sender);
        claimed[marketId][msg.sender] = true;

        uint256 payout = 0;
        if (m.state == MarketState.Resolved) {
            for (uint256 o = 0; o < m.outcomeCount; o++) {
                if (((m.winnerBitmap >> o) & 1) == 1) {
                    uint256 s = stakes[marketId][msg.sender][o];
                    if (s > 0) payout += (s * m.payoutPerShare) / 1e18;
                }
            }
        } else {
            for (uint256 o = 0; o < m.outcomeCount; o++) {
                payout += stakes[marketId][msg.sender][o];
            }
        }

        if (payout == 0) revert NothingToClaim(marketId, msg.sender);
        tick.safeTransfer(msg.sender, payout);
        emit Claimed(marketId, msg.sender, payout);
    }

    // =========================================================================
    // INTERNAL
    // =========================================================================

    /// @dev Duplicate-prevention key over the market's exact terms. The
    /// symbol is display only and deliberately excluded: the token
    /// address is the asset identity, so relabelling a symbol cannot be
    /// used to clone a market.
    function _marketKey(
        address stockToken,
        StockDirection direction,
        uint256 targetPrice,
        uint64 deadline
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(stockToken, direction, targetPrice, deadline));
    }
}

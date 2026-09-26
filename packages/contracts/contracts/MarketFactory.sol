// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ISeasonRegistry,
    IMatchRegistry,
    ITeamRegistry,
    IResultEngine,
    IPriceOracle,
    Fixture
} from "./interfaces/ITickr.sol";

/// @title MarketFactory — permissionless TICKR outright prediction markets.
///
/// @notice Anyone can create a prediction market from a fixed menu of
/// templates. Every template resolves trustlessly from on-chain data
/// (PriceOracle checkpoints / fixture snapshots / the ResultEngine table) —
/// never by admin vote or subjective judgment. Resolution rules are frozen
/// at creation and visible to everyone: see the template docs below and the
/// getTopGainerTable transparency view.
///
/// Templates (params are abi-encoded):
///  0 TOP_GAINER — which team gains the most over matchday X.
///    params: (uint256 seasonId, uint8 matchdayIndex). Outcomes: one per
///    team. Gain = (p_end - p_start) * 10000 / p_start in bps, where prices
///    are the oracle checkpoints at the matchday window edges. Ties split.
///  1 CHAMPION — which team wins the season (most points, then
///    goalDifferenceSum, then split). params: (uint256 seasonId).
///    Resolves only once ResultEngine.isSeasonComplete(seasonId).
///  2 H2H — which of two teams gains more over [startTime, endTime].
///    params: (uint16 teamA, uint16 teamB, uint64 startTime, uint64 endTime).
///    Outcomes: 0 = A, 1 = B. Exact tie splits.
///  3 TARGET — is the team's checkpoint price >= (or <=) target at time T?
///    params: (uint16 teamId, uint256 targetPrice, uint64 atTime, bool above).
///    Outcomes: 0 = Yes, 1 = No.
///  4 SPREAD — does the home team cover the spread in a fixture?
///    params: (uint256 seasonId, uint256 fixtureId, int16 spreadPoints).
///    Home covers iff (homeRoundedPct - awayRoundedPct) > spreadPoints,
///    reusing the oracle's rounded scoring. Outcomes: 0 = covers, 1 = not.
///
/// Economics (all in TICK):
/// - Creation costs CREATION_SEED (250 TICK), paid into the market's pool as
///   UNALLOCATED seed liquidity — it is not staked on any outcome. At
///   settlement it is added whole to the winners' payout pool, subsidizing
///   winner payouts and attracting bettors. The creator may also stake on
///   their own market like anyone else, any time before betting closes.
/// - Fees apply to STAKED volume only (never to the seed): treasuryFeeBps
///   (default 300) -> treasury, creatorFeeBps (default 200) -> market
///   creator, resolverFeeBps (default 100) -> whoever calls resolve().
/// - Winners share (staked * (1 - totalFees) + seed) pro-rata by stake.
/// - Every market terminates in exactly one of: RESOLVED (payouts) or VOIDED
///   (full stake refunds + seed back to creator). Funds can never be stuck.
/// - A market that resolves with zero stakes sends its seed to the treasury
///   (spam deterrent); a market whose winning outcomes have zero stakes
///   sweeps everything to the treasury (mirrors PredictionPool's rule).
contract MarketFactory is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Templates ---
    uint8 public constant T_TOP_GAINER = 0;
    uint8 public constant T_CHAMPION = 1;
    uint8 public constant T_H2H = 2;
    uint8 public constant T_TARGET = 3;
    uint8 public constant T_SPREAD = 4;
    uint8 public constant TEMPLATE_COUNT = 5;

    // --- Economics ---
    /// @notice Creation fee, paid as unallocated seed liquidity into the pool.
    uint256 public constant CREATION_SEED = 250 * 10 ** 18;
    uint256 public constant MIN_STAKE = 10 * 10 ** 18; // mirrors PredictionPool
    uint256 public constant MAX_FEE_BPS = 1_000; // 10% hard ceiling on total fees

    uint16 public treasuryFeeBps = 300;
    uint16 public creatorFeeBps = 200;
    uint16 public resolverFeeBps = 100;

    // --- Timing ---
    /// @notice Betting closes this far before a market's resolution
    /// reference time (uniform across templates, except SPREAD which
    /// follows its fixture's in-play window).
    uint256 public constant BETTING_CLOSE_BUFFER = 5 minutes;
    /// @notice Markets must be created with at least this much lead time
    /// before their endTime.
    uint256 public constant MIN_MARKET_LEAD = 1 hours;
    /// @notice After endTime + VOID_WINDOW, anyone may void a market whose
    /// resolution data never arrived (full refunds).
    uint256 public constant VOID_WINDOW = 7 days;
    /// @notice Max H2H window / lookback, bounded by checkpoint retention.
    uint64 public constant MAX_MARKET_WINDOW = 30 days;

    uint256 public constant MAX_CREATOR_NAME_BYTES = 32;

    IERC20 public immutable tick;
    ISeasonRegistry public immutable seasonRegistry;
    IPriceOracle public immutable priceOracle;
    IResultEngine public immutable resultEngine;
    address public treasury;

    enum MarketState {
        Open,
        Resolved,
        Voided
    }

    struct Market {
        uint8 templateId;
        address creator;
        string creatorName;
        uint64 createdAt;
        uint64 bettingCloseTime; // no stakes after this (SPREAD: governed by fixture instead)
        uint64 endTime; // resolve() allowed at/after this
        uint64 voidAfter; // voidMarket() allowed after this
        bytes params; // abi-encoded template params (see template docs)
        uint8 outcomeCount;
        uint256 seedAmount; // CREATION_SEED, unallocated until settlement
        uint256 totalStaked;
        MarketState state;
        uint256 winnerBitmap; // bit o set => outcome o wins (ties split)
        uint256 payoutPerShare; // 1e18 fixed point, set at resolution
    }

    mapping(uint256 => Market) internal _markets;

    /// @notice Market metadata split into a small ABI tuple for production
    /// compiler compatibility.
    function marketInfo(uint256 marketId)
        external
        view
        returns (
            uint8 templateId,
            address creator,
            string memory creatorName,
            uint64 createdAt,
            uint64 bettingCloseTime,
            uint64 endTime,
            uint64 voidAfter,
            bytes memory params,
            uint8 outcomeCount
        )
    {
        Market storage m = _markets[marketId];
        return (
            m.templateId,
            m.creator,
            m.creatorName,
            m.createdAt,
            m.bettingCloseTime,
            m.endTime,
            m.voidAfter,
            m.params,
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
            uint256 payoutPerShare
        )
    {
        Market storage m = _markets[marketId];
        return (m.seedAmount, m.totalStaked, m.state, m.winnerBitmap, m.payoutPerShare);
    }
    uint256 public marketCount;

    mapping(uint256 => mapping(uint256 => uint256)) public outcomeTotals; // marketId => outcome => total staked
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) public stakes; // marketId => user => outcome => amount
    mapping(uint256 => mapping(address => bool)) public claimed; // marketId => user => claimed/refunded

    event MarketCreated(
        uint256 indexed marketId,
        uint8 indexed templateId,
        address indexed creator,
        string creatorName,
        bytes params,
        uint64 bettingCloseTime,
        uint64 endTime
    );
    event MarketStaked(uint256 indexed marketId, address indexed user, uint256 outcome, uint256 amount);
    event MarketResolved(uint256 indexed marketId, uint256 winnerBitmap, uint256 payoutPerShare, address resolver);
    event MarketVoided(uint256 indexed marketId, address voider);
    event Claimed(uint256 indexed marketId, address indexed user, uint256 payout);
    event FeesUpdated(uint16 treasuryFeeBps, uint16 creatorFeeBps, uint16 resolverFeeBps);
    event TreasuryUpdated(address treasury);

    error UnknownTemplate(uint8 templateId);
    error InvalidParams();
    error CreatorNameTooLong(uint256 length, uint256 max);
    error MarketNotOpen(uint256 marketId);
    error BettingClosed(uint256 marketId);
    error StakeTooLow(uint256 amount, uint256 min);
    error InvalidOutcome(uint256 marketId, uint256 outcome);
    error NotResolvableYet(uint256 marketId);
    error NotVoidable(uint256 marketId);
    error AlreadySettled(uint256 marketId);
    error AlreadyClaimed(uint256 marketId, address user);
    error NothingToClaim(uint256 marketId, address user);
    error FeeTooHigh(uint16 treasuryFeeBps, uint16 creatorFeeBps, uint16 resolverFeeBps);

    constructor(
        address initialOwner,
        address tickToken,
        address seasonRegistry_,
        address priceOracle_,
        address resultEngine_,
        address treasury_
    ) Ownable(initialOwner) {
        tick = IERC20(tickToken);
        seasonRegistry = ISeasonRegistry(seasonRegistry_);
        priceOracle = IPriceOracle(priceOracle_);
        resultEngine = IResultEngine(resultEngine_);
        treasury = treasury_;
    }

    // =========================================================================
    // ADMIN
    // =========================================================================

    function setFees(uint16 _treasuryFeeBps, uint16 _creatorFeeBps, uint16 _resolverFeeBps)
        external
        onlyOwner
    {
        if (
            uint256(_treasuryFeeBps) + uint256(_creatorFeeBps) + uint256(_resolverFeeBps) > MAX_FEE_BPS
        ) {
            revert FeeTooHigh(_treasuryFeeBps, _creatorFeeBps, _resolverFeeBps);
        }
        treasuryFeeBps = _treasuryFeeBps;
        creatorFeeBps = _creatorFeeBps;
        resolverFeeBps = _resolverFeeBps;
        emit FeesUpdated(_treasuryFeeBps, _creatorFeeBps, _resolverFeeBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    // =========================================================================
    // MARKET LIFECYCLE
    // =========================================================================

    /// @notice Create a market from a template. Pulls CREATION_SEED TICK
    /// from the caller into the pool as unallocated seed liquidity.
    /// @param templateId One of T_TOP_GAINER..T_SPREAD.
    /// @param params ABI-encoded template params (see template docs above).
    /// @param creatorName Display name attached to the market (self-attested,
    /// max 32 bytes), shown in the UI as "created by".
    function createMarket(uint8 templateId, bytes calldata params, string calldata creatorName)
        external
        nonReentrant
        returns (uint256 marketId)
    {
        if (templateId >= TEMPLATE_COUNT) revert UnknownTemplate(templateId);
        if (bytes(creatorName).length > MAX_CREATOR_NAME_BYTES) {
            revert CreatorNameTooLong(bytes(creatorName).length, MAX_CREATOR_NAME_BYTES);
        }

        (uint64 bettingCloseTime, uint64 endTime, uint8 outcomeCount) =
            _validateAndSchedule(templateId, params);

        tick.safeTransferFrom(msg.sender, address(this), CREATION_SEED);

        marketId = marketCount++;
        Market storage m = _markets[marketId];
        m.templateId = templateId;
        m.creator = msg.sender;
        m.creatorName = creatorName;
        m.createdAt = uint64(block.timestamp);
        m.bettingCloseTime = bettingCloseTime;
        m.endTime = endTime;
        m.voidAfter = endTime + uint64(VOID_WINDOW);
        m.params = params;
        m.outcomeCount = outcomeCount;
        m.seedAmount = CREATION_SEED;
        m.totalStaked = 0;
        m.state = MarketState.Open;

        emit MarketCreated(marketId, templateId, msg.sender, creatorName, params, bettingCloseTime, endTime);
    }

    /// @notice Stake TICK on an outcome. The creator may stake on their own
    /// market like anyone else, any time before betting closes.
    function stake(uint256 marketId, uint256 outcome, uint256 amount) external nonReentrant {
        Market storage m = _markets[marketId];
        if (m.state != MarketState.Open) revert MarketNotOpen(marketId);
        if (outcome >= m.outcomeCount) revert InvalidOutcome(marketId, outcome);
        if (amount < MIN_STAKE) revert StakeTooLow(amount, MIN_STAKE);
        if (!_isBettingOpen(m)) revert BettingClosed(marketId);

        tick.safeTransferFrom(msg.sender, address(this), amount);
        stakes[marketId][msg.sender][outcome] += amount;
        outcomeTotals[marketId][outcome] += amount;
        m.totalStaked += amount;

        emit MarketStaked(marketId, msg.sender, outcome, amount);
    }

    /// @notice Permissionless resolution. Anyone may call once endTime has
    /// passed and the template's data is available; the caller earns the
    /// resolver fee. If the data is not (yet) available the call reverts —
    /// retry later, or voidMarket() after the void deadline.
    function resolve(uint256 marketId) external nonReentrant {
        Market storage m = _markets[marketId];
        if (m.state != MarketState.Open) revert AlreadySettled(marketId);
        // SPREAD markets resolve off the fixture's endPrice, which lands
        // before the window-based endTime — they skip the time gate.
        if (m.templateId != T_SPREAD && block.timestamp < m.endTime) {
            revert NotResolvableYet(marketId);
        }

        (bool resolvable, uint256 winnerBitmap) = _computeWinners(marketId);
        if (!resolvable) revert NotResolvableYet(marketId);

        m.state = MarketState.Resolved;
        m.winnerBitmap = winnerBitmap;

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

        uint256 winningStakes = 0;
        for (uint256 o = 0; o < m.outcomeCount; o++) {
            if (((winnerBitmap >> o) & 1) == 1) {
                winningStakes += outcomeTotals[marketId][o];
            }
        }

        if (winningStakes == 0) {
            // Winning outcomes have no stakers: sweep everything to the
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

    /// @notice Permissionless void. Allowed only after the void deadline AND
    /// only when the market is genuinely unresolvable (resolution data never
    /// arrived). Stakes are pull-refunded via claim(); the seed returns to
    /// the creator. A market whose data exists can never be voided — resolve
    /// it instead.
    function voidMarket(uint256 marketId) external nonReentrant {
        Market storage m = _markets[marketId];
        if (m.state != MarketState.Open) revert AlreadySettled(marketId);
        if (block.timestamp < m.voidAfter) revert NotVoidable(marketId);
        (bool resolvable,) = _computeWinners(marketId);
        if (resolvable) revert NotVoidable(marketId);

        m.state = MarketState.Voided;
        uint256 seed = m.seedAmount;
        m.seedAmount = 0;
        if (seed > 0) tick.safeTransfer(m.creator, seed);

        emit MarketVoided(marketId, msg.sender);
    }

    /// @notice Pull winnings (resolved markets) or full refunds (voided
    /// markets). One claim per user per market, covering all their outcomes.
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
    // TRANSPARENCY VIEWS
    // =========================================================================

    /// @notice The live resolving data for a TOP_GAINER market: every team's
    /// checkpoint prices at the matchday window edges and the resulting
    /// gain in bps. Powers the UI's "how this resolves" panel — anyone can
    /// recompute the winner from this output.
    function getTopGainerTable(uint256 marketId)
        external
        view
        returns (
            uint16[] memory teams,
            uint256[] memory priceStart,
            uint256[] memory priceEnd,
            int256[] memory gainBps,
            bool[] memory valid
        )
    {
        Market storage m = _markets[marketId];
        if (m.templateId != T_TOP_GAINER) revert InvalidParams();
        (uint256 seasonId, uint8 matchdayIndex) = abi.decode(m.params, (uint256, uint8));

        (uint64 windowStart, uint64 windowEnd, uint16 n) = _topGainerWindow(seasonId, matchdayIndex);

        teams = new uint16[](n);
        priceStart = new uint256[](n);
        priceEnd = new uint256[](n);
        gainBps = new int256[](n);
        valid = new bool[](n);

        for (uint16 team = 0; team < n; team++) {
            teams[team] = team;
            (bool ok, uint256 p1, uint256 p2) = _topGainerPrices(team, windowStart, windowEnd);
            if (ok) {
                valid[team] = true;
                priceStart[team] = p1;
                priceEnd[team] = p2;
                gainBps[team] = (int256(p2) - int256(p1)) * 10_000 / int256(p1);
            }
        }
    }

    /// @dev Resolves the TopGainer checkpoint window + team count for a
    /// season/matchday. Split out of getTopGainerTable to keep the stack
    /// shallow (solc "stack too deep" guard).
    function _topGainerWindow(uint256 seasonId, uint8 matchdayIndex)
        internal
        view
        returns (uint64 windowStart, uint64 windowEnd, uint16 n)
    {
        IMatchRegistry mr = IMatchRegistry(seasonRegistry.getMatchRegistry(seasonId));
        windowStart = mr.seasonStartTimestamp() + uint64(matchdayIndex) * mr.matchdayIntervalSeconds();
        windowEnd = windowStart + mr.matchdayIntervalSeconds();
        n = ITeamRegistry(seasonRegistry.getTeamRegistry(seasonId)).teamCount();
    }

    /// @dev Window-edge checkpoint prices for one team. Split out of
    /// getTopGainerTable to keep the stack shallow.
    function _topGainerPrices(uint16 team, uint64 windowStart, uint64 windowEnd)
        internal
        view
        returns (bool ok, uint256 p1, uint256 p2)
    {
        (bool f1, uint256 a) = priceOracle.getPriceAt(team, windowStart);
        (bool f2, uint256 b) = priceOracle.getPriceAt(team, windowEnd);
        ok = f1 && f2;
        p1 = a;
        p2 = b;
    }

    // =========================================================================
    // INTERNAL — validation & scheduling
    // =========================================================================

    /// @dev Validates template params and derives (bettingCloseTime, endTime,
    /// outcomeCount). Reverts on anything that would make the market
    /// unresolvable by construction.
    function _validateAndSchedule(uint8 templateId, bytes calldata params)
        internal
        view
        returns (uint64 bettingCloseTime, uint64 endTime, uint8 outcomeCount)
    {
        uint64 now_ = uint64(block.timestamp);

        if (templateId == T_TOP_GAINER) {
            (uint256 seasonId, uint8 matchdayIndex) = abi.decode(params, (uint256, uint8));
            IMatchRegistry mr = _matchRegistry(seasonId);
            if (matchdayIndex >= mr.matchdaysGenerated()) revert InvalidParams();
            uint64 windowStart =
                mr.seasonStartTimestamp() + uint64(matchdayIndex) * mr.matchdayIntervalSeconds();
            uint64 windowEnd = windowStart + mr.matchdayIntervalSeconds();
            if (windowEnd <= now_) revert InvalidParams();
            uint16 n = _teamCount(seasonId);
            return (
                windowEnd - uint64(BETTING_CLOSE_BUFFER),
                windowEnd,
                uint8(n)
            );
        }

        if (templateId == T_CHAMPION) {
            (uint256 seasonId) = abi.decode(params, (uint256));
            IMatchRegistry mr = _matchRegistry(seasonId);
            if (!mr.scheduleGenerated()) revert InvalidParams();
            // seasonEnd = start + (all matchdays, now known complete) * interval
            uint64 seasonEnd =
                mr.seasonStartTimestamp() + uint64(mr.matchdaysGenerated()) * mr.matchdayIntervalSeconds();
            if (seasonEnd <= now_ + MIN_MARKET_LEAD) revert InvalidParams();
            uint16 n = _teamCount(seasonId);
            return (
                seasonEnd - uint64(BETTING_CLOSE_BUFFER),
                seasonEnd,
                uint8(n)
            );
        }

        if (templateId == T_H2H) {
            (uint16 teamA, uint16 teamB, uint64 startTime, uint64 endTime_) =
                abi.decode(params, (uint16, uint16, uint64, uint64));
            if (teamA == teamB) revert InvalidParams();
            uint16 n = _teamCount(seasonRegistry.currentSeasonId());
            if (teamA >= n || teamB >= n) revert InvalidParams();
            if (startTime >= endTime_) revert InvalidParams();
            if (endTime_ <= now_ + MIN_MARKET_LEAD) revert InvalidParams();
            if (endTime_ - startTime > MAX_MARKET_WINDOW) revert InvalidParams();
            // startTime older than retention => checkpoints pruned => guaranteed void
            if (startTime + MAX_MARKET_WINDOW < now_) revert InvalidParams();
            return (endTime_ - uint64(BETTING_CLOSE_BUFFER), endTime_, 2);
        }

        if (templateId == T_TARGET) {
            (uint16 teamId, uint256 targetPrice, uint64 atTime, bool above) =
                abi.decode(params, (uint16, uint256, uint64, bool));
            above; // silence unused warning (kept for signature clarity)
            uint16 n = _teamCount(seasonRegistry.currentSeasonId());
            if (teamId >= n) revert InvalidParams();
            if (targetPrice == 0) revert InvalidParams();
            if (atTime <= now_ + MIN_MARKET_LEAD) revert InvalidParams();
            if (atTime > now_ + MAX_MARKET_WINDOW) revert InvalidParams();
            return (atTime - uint64(BETTING_CLOSE_BUFFER), atTime, 2);
        }

        // T_SPREAD
        (uint256 seasonId, uint256 fixtureId, int16 spreadPoints) =
            abi.decode(params, (uint256, uint256, int16));
        spreadPoints; // silence unused warning (used at resolution)
        IMatchRegistry mr = _matchRegistry(seasonId);
        if (fixtureId >= mr.fixtureCount()) revert InvalidParams();
        Fixture memory f = mr.getFixture(fixtureId);
        if (f.settled) revert InvalidParams();
        // Betting follows the fixture's own in-play window (see
        // _isBettingOpen); endTime anchors the void deadline.
        return (f.windowEnd, f.windowEnd, 2);
    }

    function _matchRegistry(uint256 seasonId) internal view returns (IMatchRegistry) {
        address mrAddr = seasonRegistry.getMatchRegistry(seasonId);
        if (mrAddr == address(0)) revert InvalidParams();
        return IMatchRegistry(mrAddr);
    }

    function _teamCount(uint256 seasonId) internal view returns (uint16) {
        address trAddr = seasonRegistry.getTeamRegistry(seasonId);
        if (trAddr == address(0)) revert InvalidParams();
        uint16 n = ITeamRegistry(trAddr).teamCount();
        if (n == 0 || n > 64) revert InvalidParams();
        return n;
    }

    /// @dev Betting-open check. SPREAD markets mirror their fixture's
    /// in-play window (open before reveal, until 5 min before the pinned
    /// match end, closed once the result is knowable); all other templates
    /// use the market-level bettingCloseTime.
    function _isBettingOpen(Market storage m) internal view returns (bool) {
        if (m.templateId == T_SPREAD) {
            bytes memory params_ = m.params;
            (uint256 seasonId, uint256 fixtureId,) = abi.decode(params_, (uint256, uint256, int16));
            (bool endSubmitted,,,,) = priceOracle.getFixtureEndPrices(seasonId, fixtureId);
            if (endSubmitted) return false;
            Fixture memory f =
                IMatchRegistry(seasonRegistry.getMatchRegistry(seasonId)).getFixture(fixtureId);
            if (f.settled) return false;
            if (f.kickoffTimestamp == 0) return true;
            return block.timestamp + BETTING_CLOSE_BUFFER < f.matchEndTimestamp;
        }
        return block.timestamp < m.bettingCloseTime;
    }

    // =========================================================================
    // INTERNAL — resolution
    // =========================================================================

    /// @dev Computes (resolvable, winnerBitmap). Pure view of on-chain data:
    /// anyone can recompute any market's outcome from public state, which is
    /// what makes resolution transparent and trustless.
    function _computeWinners(uint256 marketId) internal view returns (bool, uint256) {
        Market storage m = _markets[marketId];
        bytes memory params_ = m.params;

        if (m.templateId == T_TOP_GAINER) return _computeTopGainer(params_);
        if (m.templateId == T_CHAMPION) return _computeChampion(params_);
        if (m.templateId == T_H2H) return _computeH2H(params_);
        if (m.templateId == T_TARGET) return _computeTarget(params_);
        return _computeSpread(params_);
    }

    function _computeTopGainer(bytes memory params_) internal view returns (bool, uint256) {
        (uint256 seasonId, uint8 matchdayIndex) = abi.decode(params_, (uint256, uint8));
        IMatchRegistry mr = IMatchRegistry(seasonRegistry.getMatchRegistry(seasonId));
        uint64 windowStart =
            mr.seasonStartTimestamp() + uint64(matchdayIndex) * mr.matchdayIntervalSeconds();
        uint64 windowEnd = windowStart + mr.matchdayIntervalSeconds();
        uint16 n = ITeamRegistry(seasonRegistry.getTeamRegistry(seasonId)).teamCount();

        int256 best = type(int256).min;
        uint256 valid;
        uint256 bitmap;
        for (uint16 team = 0; team < n; team++) {
            (bool f1, uint256 p1) = priceOracle.getPriceAt(team, windowStart);
            (bool f2, uint256 p2) = priceOracle.getPriceAt(team, windowEnd);
            if (!f1 || !f2) continue;
            valid++;
            int256 gain = (int256(p2) - int256(p1)) * 10_000 / int256(p1);
            if (gain > best) {
                best = gain;
                bitmap = uint256(1) << team;
            } else if (gain == best) {
                bitmap |= uint256(1) << team;
            }
        }
        if (valid < 2) return (false, 0);
        return (true, bitmap);
    }

    function _computeChampion(bytes memory params_) internal view returns (bool, uint256) {
        (uint256 seasonId) = abi.decode(params_, (uint256));
        if (!resultEngine.isSeasonComplete(seasonId)) return (false, 0);
        uint16 n = ITeamRegistry(seasonRegistry.getTeamRegistry(seasonId)).teamCount();

        uint32 bestPts;
        int32 bestGd = type(int32).min;
        uint256 bitmap;
        for (uint16 team = 0; team < n; team++) {
            (uint32 pts, int32 gd) = resultEngine.getTeamScore(seasonId, team);
            if (pts > bestPts || (pts == bestPts && gd > bestGd)) {
                bestPts = pts;
                bestGd = gd;
                bitmap = uint256(1) << team;
            } else if (pts == bestPts && gd == bestGd) {
                bitmap |= uint256(1) << team;
            }
        }
        return (true, bitmap);
    }

    function _computeH2H(bytes memory params_) internal view returns (bool, uint256) {
        (uint16 teamA, uint16 teamB, uint64 startTime, uint64 endTime_) =
            abi.decode(params_, (uint16, uint16, uint64, uint64));
        (bool f1a, uint256 pa1) = priceOracle.getPriceAt(teamA, startTime);
        (bool f2a, uint256 pa2) = priceOracle.getPriceAt(teamA, endTime_);
        (bool f1b, uint256 pb1) = priceOracle.getPriceAt(teamB, startTime);
        (bool f2b, uint256 pb2) = priceOracle.getPriceAt(teamB, endTime_);
        if (!f1a || !f2a || !f1b || !f2b) return (false, 0);
        int256 gainA = (int256(pa2) - int256(pa1)) * 10_000 / int256(pa1);
        int256 gainB = (int256(pb2) - int256(pb1)) * 10_000 / int256(pb1);
        if (gainA > gainB) return (true, 1);
        if (gainB > gainA) return (true, 2);
        return (true, 3);
    }

    function _computeTarget(bytes memory params_) internal view returns (bool, uint256) {
        (uint16 teamId, uint256 targetPrice, uint64 atTime, bool above) =
            abi.decode(params_, (uint16, uint256, uint64, bool));
        (bool found, uint256 p) = priceOracle.getPriceAt(teamId, atTime);
        if (!found) return (false, 0);
        bool yes = above ? p >= targetPrice : p <= targetPrice;
        return (true, yes ? 1 : 2);
    }

    function _computeSpread(bytes memory params_) internal view returns (bool, uint256) {
        (uint256 seasonId, uint256 fixtureId, int16 spreadPoints) =
            abi.decode(params_, (uint256, uint256, int16));
        (bool endSubmitted, uint256 homeStart, uint256 awayStart, uint256 homeEnd, uint256 awayEnd) =
            priceOracle.getFixtureEndPrices(seasonId, fixtureId);
        if (!endSubmitted) return (false, 0);
        int16 homePct = _roundedPercentChange(homeStart, homeEnd);
        int16 awayPct = _roundedPercentChange(awayStart, awayEnd);
        int16 margin = homePct - awayPct;
        return (true, margin > spreadPoints ? 1 : 2);
    }

    /// @notice Same rounding rule as PriceOracle._roundedPercentChange
    /// (duplicated here so the stable PriceOracle stays untouched): % change
    /// in bps rounded to the nearest whole percent, round-half-up.
    function _roundedPercentChange(uint256 startPrice, uint256 endPrice) internal pure returns (int16) {
        int256 delta = int256(endPrice) - int256(startPrice);
        int256 bps = (delta * 10_000) / int256(startPrice);

        int256 roundedPct;
        if (bps >= 0) {
            roundedPct = (bps + 50) / 100;
        } else {
            roundedPct = (bps - 50) / 100;
        }

        return int16(roundedPct);
    }
}

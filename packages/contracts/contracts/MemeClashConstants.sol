// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MemeClashConstants - shared constants for TICKR Stock Meme Arena clashes
///
/// @notice Single source of truth for every number the meme clash factory
/// shares with its tests, its deploy script and any future sibling
/// contracts. Solidity does not allow accessing a contract's constants via
/// `ContractName.CONSTANT` (verified against solc 0.8.28), only types
/// (structs, enums) work that way. Library constants ARE accessible via
/// `LibraryName.CONSTANT`, so shared numbers live here, following the
/// StockMarketConstants.sol pattern this file mirrors.
///
/// @dev Every economic number here mirrors StockMarketFactory exactly,
/// so the backend keeper and the frontend carry over unchanged:
///   - CREATION_SEED 250 TICK, pulled from the creator at creation as
///     unallocated seed liquidity (never staked on an outcome).
///   - MIN_STAKE 10 TICK.
///   - Fees on STAKED volume only, never on the seed: 300 bps (3 percent)
///     treasury, 200 bps (2 percent) creator, 100 bps (1 percent)
///     resolver, with a 1000 bps (10 percent) hard ceiling on the total.
///
/// @dev PRICE SCALE: prices arrive from the data layer as decimal USD
/// prices (the meme price from BaseStonk, the stock NAV from Coinbase).
/// On chain, snapshot prices are uint256 at a fixed scale of
/// PRICE_SCALE = 1e8, exactly as in StockMarketConstants: a price of
/// 53.339875 USD is stored as 53.339875 * 1e8 = 5333987500. The backend
/// multiplies the decimal price by 1e8 (rounding to the nearest integer)
/// before submitting it, so the factory compares integers directly.
///
/// @dev MOVE SCALE: a clash is decided by percent moves, not prices.
/// Moves are stored and compared as signed micro-percent integers:
/// 1 percent = 1_000_000 units (MOVE_SCALE), so 100 percent is
/// 100_000_000 units. The factory computes a move from a snapshot pair
/// as (end - start) * 1e8 / start, because percent * MOVE_SCALE equals
/// (end - start) / start * 100 * 1_000_000, and 100 * MOVE_SCALE is 1e8.
/// The 1e8 multiplier is PRICE_SCALE, which is why the two scales share
/// one number. SPIKE_BREAKER_MOVE is 30 percent in the same units:
/// 30 * MOVE_SCALE = 30_000_000.
library MemeClashConstants {
    // --- Price scale ---
    /// @notice Fixed scale for snapshot prices: 1 USD = 1e8.
    uint256 constant PRICE_SCALE = 100_000_000;

    // --- Economics (mirror StockMarketFactory exactly) ---
    /// @notice Creation seed, paid as unallocated seed liquidity into the pool.
    uint256 constant CREATION_SEED = 250 * 10 ** 18;
    /// @notice Minimum stake per stake() call, mirrors StockMarketFactory.
    uint256 constant MIN_STAKE = 10 * 10 ** 18;
    /// @notice Default fee split on staked volume: 3 percent treasury.
    uint16 constant TREASURY_FEE_BPS = 300;
    /// @notice Default fee split on staked volume: 2 percent creator.
    uint16 constant CREATOR_FEE_BPS = 200;
    /// @notice Default fee split on staked volume: 1 percent resolver.
    uint16 constant RESOLVER_FEE_BPS = 100;
    /// @notice 10 percent hard ceiling on total fees, mirrors StockMarketFactory.
    uint16 constant MAX_FEE_BPS = 1_000;

    // --- Clash windows ---
    /// @notice Staking opens at creation and the clash window starts this
    /// long after creation. Staking closes exactly when the window
    /// starts: stake() is allowed only while block.timestamp is before
    /// windowStart, and windowStart is createdAt + WINDOW_LEAD.
    uint256 constant WINDOW_LEAD = 1 hours;
    /// @notice The standard clash window: 24 hours.
    uint256 constant STANDARD_WINDOW = 24 hours;
    /// @notice The blitz clash window: 1 hour.
    uint256 constant BLITZ_WINDOW = 1 hours;
    /// @notice Recorded on every clash as voidAfter = windowEnd +
    /// VOID_WINDOW, for parity with StockMarketFactory's market shape.
    /// The clash void path itself does not wait for it: see
    /// MemeClashFactory.voidClash.
    uint256 constant VOID_WINDOW = 7 days;

    // --- Moves (percent x 1e6, see the library header) ---
    /// @notice One percent of move, in move units.
    uint256 constant MOVE_SCALE = 1_000_000;
    /// @notice Circuit breaker: a raw move of this magnitude or more on
    /// either side inside the window voids the clash (30 percent).
    uint256 constant SPIKE_BREAKER_MOVE = 30_000_000;

    // --- Creation bounds ---
    uint256 constant MAX_SYMBOL_BYTES = 16;
    uint256 constant MAX_CREATOR_NAME_BYTES = 32;

    // --- Outcomes: 0 = Yes (the meme outperforms), 1 = No ---
    uint256 constant OUTCOME_YES = 0;
    uint256 constant OUTCOME_NO = 1;
    uint8 constant OUTCOME_COUNT = 2;

    // --- Reused token (never redeployed) ---
    /// @notice TICK on Base Sepolia, reused by the arena stack exactly as
    /// the crypto league, the cup and StockMarketFactory reuse it.
    address constant TICK_TOKEN = 0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b;
}

/// @notice What the meme is clashing against, stored on the clash at
/// creation and frozen for its whole life. Mirrors how StockDirection
/// lives beside StockMarketConstants.
/// Stock: the opponent is the BaseStonk paired stock (or any other
/// tokenized stock), priced by its NAV snapshots.
/// Meme: the opponent is another memecoin on the same paired stock (a
/// derby), priced by its BaseStonk price snapshots like the meme side.
enum OpponentKind {
    Stock,
    Meme
}

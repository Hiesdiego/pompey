// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title StockMarketConstants - shared constants for TICKR Stock Price Target Markets
///
/// @notice Single source of truth for every number the stock price target
/// factory shares with its tests, its deploy script and any future sibling
/// contracts. Solidity does not allow accessing a contract's constants via
/// `ContractName.CONSTANT` (verified against solc 0.8.28), only types
/// (structs, enums) work that way. Library constants ARE accessible via
/// `LibraryName.CONSTANT`, so shared numbers live here, following the
/// StockConstants.sol and tournament/CupConstants.sol pattern.
///
/// @dev Every economic number here mirrors the crypto MarketFactory
/// exactly, so the backend keeper and the frontend carry over unchanged:
///   - CREATION_SEED 250 TICK, pulled from the creator at creation as
///     unallocated seed liquidity (never staked on an outcome).
///   - MIN_STAKE 10 TICK.
///   - Fees on STAKED volume only, never on the seed: 300 bps (3 percent)
///     treasury, 200 bps (2 percent) creator, 100 bps (1 percent)
///     resolver, with a 1000 bps (10 percent) hard ceiling on the total.
///   - Deadline cap MAX_TARGET_TIME, copied verbatim from MarketFactory:
///     1798761599 is Dec 31, 2026, 23:59:59 UTC. No stock target market
///     may set a deadline after it.
///
/// @dev PRICE SCALE: NAV arrives from the Coinbase API as a decimal USD
/// price (for example 53.339875). On chain, target prices and resolution
/// prices are uint256 at a fixed scale of PRICE_SCALE = 1e8, so the
/// example is stored as 53.339875 * 1e8 = 5333987500. The backend
/// multiplies the decimal NAV by 1e8 (rounding to the nearest integer)
/// before submitting it, and creators quote targets in the same scale,
/// so resolution is a direct integer comparison with no decimals
/// handling inside the contract. 1e8 also matches the 8 decimals of the
/// Base B20 tokenized stocks themselves (see StockConstants.PRICE_DECIMALS).
library StockMarketConstants {
    // --- Price scale ---
    /// @notice Fixed scale for target and resolution prices: 1 USD = 1e8.
    uint256 constant PRICE_SCALE = 100_000_000;

    // --- Economics (mirror MarketFactory exactly) ---
    /// @notice Creation seed, paid as unallocated seed liquidity into the pool.
    uint256 constant CREATION_SEED = 250 * 10 ** 18;
    /// @notice Minimum stake per stake() call, mirrors PredictionPool.
    uint256 constant MIN_STAKE = 10 * 10 ** 18;
    /// @notice Default fee split on staked volume: 3 percent treasury.
    uint16 constant TREASURY_FEE_BPS = 300;
    /// @notice Default fee split on staked volume: 2 percent creator.
    uint16 constant CREATOR_FEE_BPS = 200;
    /// @notice Default fee split on staked volume: 1 percent resolver.
    uint16 constant RESOLVER_FEE_BPS = 100;
    /// @notice 10 percent hard ceiling on total fees, mirrors MarketFactory.
    uint16 constant MAX_FEE_BPS = 1_000;

    // --- Timing (mirror MarketFactory exactly) ---
    /// @notice Betting closes this far before the market deadline.
    uint256 constant BETTING_CLOSE_BUFFER = 5 minutes;
    /// @notice Markets must be created with at least this much lead time
    /// before their deadline.
    uint256 constant MIN_MARKET_LEAD = 1 hours;
    /// @notice Recorded on every market as voidAfter = deadline + VOID_WINDOW,
    /// for parity with MarketFactory's market shape. The stock void path
    /// itself does not wait for it: see StockMarketFactory.voidMarket.
    uint256 constant VOID_WINDOW = 7 days;
    /// @notice No market deadline may exceed this timestamp:
    /// Dec 31, 2026, 23:59:59 UTC. Copied verbatim from MarketFactory.
    uint64 constant MAX_TARGET_TIME = 1798761599;

    // --- Creation bounds ---
    uint256 constant MAX_CREATOR_NAME_BYTES = 32;
    uint256 constant MAX_SYMBOL_BYTES = 16;

    // --- Outcomes: 0 = Yes, 1 = No, identical to MarketFactory TARGET ---
    uint256 constant OUTCOME_YES = 0;
    uint256 constant OUTCOME_NO = 1;
    uint8 constant OUTCOME_COUNT = 2;

    // --- Reused token (never redeployed) ---
    /// @notice TICK on Base Sepolia, reused by the stock stack exactly as
    /// the crypto league, the cup and MarketFactory reuse it.
    address constant TICK_TOKEN = 0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b;
}

/// @notice Direction of a stock price target market, stored on the market
/// at creation and frozen for its whole life.
/// Above: "Will [STOCK] be above $X by [date]?"
/// Below: "Will [STOCK] be below $X by [date]?"
/// The exact tie behaviour for each direction is defined on
/// StockMarketFactory.resolve: at exactly the target price, Above
/// resolves No and Below resolves Yes.
enum StockDirection {
    Above,
    Below
}

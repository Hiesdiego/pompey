// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Shared constants for the CRYPTO PRICE WORLD CUP contracts.
///
/// Solidity does not allow accessing a contract's constants via
/// `ContractName.CONSTANT` — only types (structs, enums). Library
/// constants ARE accessible that way, so the cup's shared numbers live
/// here instead of being duplicated across contracts.
library CupConstants {
    uint16 constant TEAM_COUNT = 64;
    uint16 constant MATCH_COUNT = 63;
    uint16 constant FINAL_MATCH_ID = 62;
    uint16 constant TBD = type(uint16).max;

    /// @notice Rounds: 0=R64, 1=R32, 2=R16, 3=QF, 4=SF, 5=Final.
    uint16 constant R32_START = 32;
    uint16 constant R16_START = 48;
    uint16 constant QF_START = 56;
    uint16 constant SF_START = 60;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Locally compiled ERC1967Proxy artifact for the stock deploy script.
/// @dev The inherited constructor delegates initialization atomically, while
///      using the standard ERC1967 storage slots required by UUPSUpgradeable.
contract StockERC1967Proxy is ERC1967Proxy {
    constructor(address implementation, bytes memory initializationData)
        ERC1967Proxy(implementation, initializationData)
    {}
}

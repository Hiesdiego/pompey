// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IResultEngine, Outcome, SeasonMath } from "./interfaces/ITickr.sol";

/// @title PriceOracle — TICKR price-battle result computation
///
/// @notice Persists across every season. The backend (a single authorized
/// signer for v0.1 — a multi-sig or decentralized oracle committee is a
/// v0.2 hardening item) submits the start price (at kickoff) and end price
/// (at kickoff + match duration) for both teams in a fixture. This contract
/// computes each team's % change, rounds to the nearest whole integer (the
/// "score"), and determines the outcome: higher rounded score wins, equal
/// rounded scores = draw.
///
/// Prices are submitted as fixed-point integers with PRICE_DECIMALS decimal
/// places. Snapshots are stored keyed by (seasonId, fixtureId) via
/// SeasonMath, same pattern as PredictionPool.
contract PriceOracle is Ownable {
    uint8 public constant PRICE_DECIMALS = 8;

    IResultEngine public resultEngine;
    bool public resultEngineSet;

    address public backendSigner;

    struct Snapshot {
        uint256 homeStart;
        uint256 awayStart;
        uint256 homeEnd;
        uint256 awayEnd;
        bool startSubmitted;
        bool endSubmitted;
    }

    mapping(uint256 => Snapshot) public snapshots; // globalFixtureId => snapshot

    event StartPriceSubmitted(uint256 indexed seasonId, uint256 indexed fixtureId, uint256 homeStart, uint256 awayStart);
    event EndPriceSubmitted(
        uint256 indexed seasonId,
        uint256 indexed fixtureId,
        uint256 homeEnd,
        uint256 awayEnd,
        int16 homeRoundedPct,
        int16 awayRoundedPct,
        Outcome outcome
    );
    event BackendSignerUpdated(address indexed newSigner);

    error OnlyBackendSigner();
    error ResultEngineAlreadySet();
    error StartAlreadySubmitted(uint256 seasonId, uint256 fixtureId);
    error EndAlreadySubmitted(uint256 seasonId, uint256 fixtureId);
    error StartNotSubmitted(uint256 seasonId, uint256 fixtureId);
    error InvalidPrice();

    modifier onlyBackend() {
        if (msg.sender != backendSigner) revert OnlyBackendSigner();
        _;
    }

    constructor(address initialOwner, address _backendSigner) Ownable(initialOwner) {
        backendSigner = _backendSigner;
    }

    function setResultEngine(address _resultEngine) external onlyOwner {
        if (resultEngineSet) revert ResultEngineAlreadySet();
        resultEngine = IResultEngine(_resultEngine);
        resultEngineSet = true;
    }

    function setBackendSigner(address newSigner) external onlyOwner {
        backendSigner = newSigner;
        emit BackendSignerUpdated(newSigner);
    }

    /// @notice Submitted the moment a fixture's kickoff arrives.
    function submitStartPrice(uint256 seasonId, uint256 fixtureId, uint256 homePrice, uint256 awayPrice)
        external
        onlyBackend
    {
        if (homePrice == 0 || awayPrice == 0) revert InvalidPrice();
        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        Snapshot storage s = snapshots[gid];
        if (s.startSubmitted) revert StartAlreadySubmitted(seasonId, fixtureId);

        s.homeStart = homePrice;
        s.awayStart = awayPrice;
        s.startSubmitted = true;

        emit StartPriceSubmitted(seasonId, fixtureId, homePrice, awayPrice);
    }

    /// @notice Submitted at kickoff + match duration. Computes the rounded
    /// % change for both teams, determines the outcome, and pushes the
    /// result onward to ResultEngine in the same transaction.
    function submitEndPrice(uint256 seasonId, uint256 fixtureId, uint256 homePrice, uint256 awayPrice)
        external
        onlyBackend
    {
        if (homePrice == 0 || awayPrice == 0) revert InvalidPrice();
        uint256 gid = SeasonMath.globalFixtureId(seasonId, fixtureId);
        Snapshot storage s = snapshots[gid];
        if (!s.startSubmitted) revert StartNotSubmitted(seasonId, fixtureId);
        if (s.endSubmitted) revert EndAlreadySubmitted(seasonId, fixtureId);

        s.homeEnd = homePrice;
        s.awayEnd = awayPrice;
        s.endSubmitted = true;

        int16 homeRoundedPct = _roundedPercentChange(s.homeStart, homePrice);
        int16 awayRoundedPct = _roundedPercentChange(s.awayStart, awayPrice);

        Outcome outcome;
        if (homeRoundedPct > awayRoundedPct) {
            outcome = Outcome.WinHome;
        } else if (awayRoundedPct > homeRoundedPct) {
            outcome = Outcome.WinAway;
        } else {
            outcome = Outcome.Draw;
        }

        emit EndPriceSubmitted(seasonId, fixtureId, homePrice, awayPrice, homeRoundedPct, awayRoundedPct, outcome);

        resultEngine.recordResult(seasonId, fixtureId, outcome, homeRoundedPct, awayRoundedPct);
    }

    /// @notice % change from `startPrice` to `endPrice`, in basis points,
    /// rounded to the nearest whole integer percent using round-half-up.
    /// Handles negative changes (price drops) via signed arithmetic.
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

    function getSnapshot(uint256 seasonId, uint256 fixtureId) external view returns (Snapshot memory) {
        return snapshots[SeasonMath.globalFixtureId(seasonId, fixtureId)];
    }
}

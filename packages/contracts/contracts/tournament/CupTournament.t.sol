// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { TickToken } from "../TickToken.sol";
import { CupRegistry } from "./CupRegistry.sol";
import { CupEngine } from "./CupEngine.sol";
import { CupPool } from "./CupPool.sol";
import { DisputeBallot } from "./DisputeBallot.sol";

/// @notice Foundry test suite for the CRYPTO PRICE WORLD CUP contracts.
/// Covers: team registration, the two-phase draw (pot constraints, full
/// 63-fixture tree), kickoff gating, scoring math (normalization, best-mover
/// tiebreak), the ±30% spike circuit breaker, the DAO ballot (fee, quorum,
/// both verdicts), and all three pool types end-to-end — including a full
/// 63-match tournament that crowns a champion and settles the outright pool.
contract CupTournamentTest is Test {
    TickToken tick;
    CupRegistry registry;
    CupEngine engine;
    CupPool pool;
    DisputeBallot ballot;

    address owner = address(0xA11CE);
    address operator = address(0xB0B);
    address treasury = address(0x7EA5);
    address alice = address(0xA1);
    address bob = address(0xB2);
    address v1 = address(0xC1);
    address v2 = address(0xC2);
    address v3 = address(0xC3);
    address v4 = address(0xC4);
    address v5 = address(0xC5);

    uint256 constant START_PRICE = 100 * 1e8; // 8-decimal fixed point

    function setUp() public {
        vm.startPrank(owner);
        tick = new TickToken(owner, 10_000_000 * 1e18);
        registry = new CupRegistry(owner, operator);
        engine = new CupEngine(owner, address(registry), operator);
        ballot = new DisputeBallot(owner, address(tick), treasury, address(engine));
        pool = new CupPool(owner, address(tick), address(registry), treasury);

        registry.setEngine(address(engine));
        engine.setDisputeBallot(address(ballot));
        engine.setCupPool(address(pool));
        pool.setEngine(address(engine));

        address[7] memory funded = [alice, bob, v1, v2, v3, v4, v5];
        for (uint256 i = 0; i < funded.length; i++) {
            tick.mint(funded[i], 100_000 * 1e18);
        }
        // Seeding pulls TICK from the owner via transferFrom.
        tick.approve(address(pool), type(uint256).max);

        // 64 teams, 16 per pot (synthetic symbols; pot structure is what matters).
        string[] memory symbols = new string[](64);
        uint8[] memory pots = new uint8[](64);
        for (uint16 i = 0; i < 64; i++) {
            symbols[i] = string(abi.encodePacked("COIN", _toString(i)));
            pots[i] = uint8(i / 16) + 1;
        }
        registry.registerTeams(symbols, pots);
        registry.requestDraw();
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _draw() internal {
        uint256 db = registry.drawBlock();
        vm.roll(db + 1);
        registry.executeDraw();
    }

    function _reveal(uint16 matchId) internal returns (uint64 kickoff) {
        kickoff = uint64(block.timestamp) + 2 hours;
        vm.prank(operator);
        registry.revealKickoff(matchId, kickoff);
    }

    /// @notice Warps through kickoff/end and submits prices, then settles.
    function _submitAndSettle(uint16 matchId, uint256 endA, uint256 endB) internal {
        CupRegistry.CupMatch memory m = registry.getMatch(matchId);
        vm.warp(m.kickoffTimestamp);
        vm.startPrank(operator);
        engine.submitStartPrice(matchId, START_PRICE, START_PRICE);
        vm.warp(m.kickoffTimestamp + 1 hours);
        engine.submitEndPrice(matchId, endA, endB);
        engine.settleMatch(matchId);
        vm.stopPrank();
    }

    /// @notice Plays a full match with the chosen winner (+1.2% vs +0.1%).
    function _playMatch(uint16 matchId, uint16 winnerTeam) internal {
        CupRegistry.CupMatch memory m = registry.getMatch(matchId);
        uint64 kickoff = uint64(block.timestamp) + 2 hours;
        vm.prank(operator);
        registry.revealKickoff(matchId, kickoff);
        vm.warp(kickoff);
        uint256 winEnd = 1012 * 1e7; // +1.2% -> 2 goals
        uint256 loseEnd = 1001 * 1e7; // +0.1% -> 0 goals
        (uint256 endA, uint256 endB) =
            winnerTeam == m.teamA ? (winEnd, loseEnd) : (loseEnd, winEnd);
        vm.startPrank(operator);
        engine.submitStartPrice(matchId, START_PRICE, START_PRICE);
        vm.warp(kickoff + 1 hours);
        engine.submitEndPrice(matchId, endA, endB);
        engine.settleMatch(matchId);
        vm.stopPrank();
    }

    function _voteAll(uint256 ballotId, bool manipulated, uint8 n) internal {
        address[5] memory voters = [v1, v2, v3, v4, v5];
        for (uint8 i = 0; i < n; i++) {
            vm.startPrank(voters[i]);
            tick.approve(address(ballot), 100 * 1e18);
            ballot.vote(ballotId, manipulated);
            vm.stopPrank();
        }
    }

    function _toString(uint16 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        bytes memory buf;
        while (v > 0) {
            buf = abi.encodePacked(bytes1(uint8(48 + (v % 10))), buf);
            v /= 10;
        }
        return string(buf);
    }

    // ---------------------------------------------------------------------
    // Registration & draw
    // ---------------------------------------------------------------------

    function test_TeamsRegisteredSixteenPerPot() public view {
        uint256[5] memory counts;
        for (uint16 i = 0; i < 64; i++) {
            CupRegistry.Team memory t = registry.getTeam(i);
            counts[t.pot] += 1;
        }
        for (uint8 p = 1; p <= 4; p++) {
            require(counts[p] == 16, "pot imbalance");
        }
    }

    function test_DrawPairsUpperVsLowerAllTeamsUnique() public {
        _draw();
        bool[64] memory seen;
        for (uint16 i = 0; i < 32; i++) {
            CupRegistry.CupMatch memory m = registry.getMatch(i);
            uint8 potA = registry.getTeam(m.teamA).pot;
            uint8 potB = registry.getTeam(m.teamB).pot;
            require(potA == 1 || potA == 2, "R64 teamA not from pots 1/2");
            require(potB == 3 || potB == 4, "R64 teamB not from pots 3/4");
            require(!seen[m.teamA] && !seen[m.teamB], "team drawn twice");
            seen[m.teamA] = true;
            seen[m.teamB] = true;
        }
    }

    function test_DrawBuildsFull63FixtureTree() public {
        _draw();
        // Spot-check feeder wiring across every round boundary.
        CupRegistry.CupMatch memory m32 = registry.getMatch(32);
        require(m32.feederA == 0 && m32.feederB == 1, "R32 feeder wiring");
        require(registry.childOf(0) == 32 && registry.childOf(1) == 32, "childOf R64");

        CupRegistry.CupMatch memory m48 = registry.getMatch(48);
        require(m48.feederA == 32 && m48.feederB == 33, "R16 feeder wiring");

        CupRegistry.CupMatch memory m62 = registry.getMatch(62);
        require(m62.feederA == 60 && m62.feederB == 61, "final feeder wiring");
        require(registry.childOf(60) == 62 && registry.childOf(61) == 62, "childOf SF");

        // Later-round teams start TBD.
        require(m32.teamA == type(uint16).max && m62.teamB == type(uint16).max, "teams not TBD");

        // Round mapping.
        require(registry.roundOf(0) == 0, "round R64");
        require(registry.roundOf(32) == 1, "round R32");
        require(registry.roundOf(48) == 2, "round R16");
        require(registry.roundOf(56) == 3, "round QF");
        require(registry.roundOf(60) == 4, "round SF");
        require(registry.roundOf(62) == 5, "round Final");
    }

    function test_DrawCannotExecuteTwice() public {
        _draw();
        vm.expectRevert();
        registry.executeDraw();
    }

    // ---------------------------------------------------------------------
    // Kickoff gating
    // ---------------------------------------------------------------------

    function test_KickoffGatedOnFeedersSettled() public {
        _draw();
        vm.prank(operator);
        vm.expectRevert();
        registry.revealKickoff(32, uint64(block.timestamp) + 2 hours);
    }

    function test_KickoffRequiresLeadTime() public {
        _draw();
        vm.prank(operator);
        vm.expectRevert();
        registry.revealKickoff(0, uint64(block.timestamp)); // no 1h lead
    }

    // ---------------------------------------------------------------------
    // Scoring math
    // ---------------------------------------------------------------------

    function test_ScoringTwoOneSettlesAndAdvances() public {
        _draw();
        _reveal(0);
        _submitAndSettle(0, 1012 * 1e7, 1006 * 1e7); // +1.2% vs +0.6% -> 2-1

        CupRegistry.CupMatch memory m = registry.getMatch(0);
        require(m.goalsA == 2 && m.goalsB == 1, "wrong scoreline");
        require(m.winner == m.teamA, "wrong winner");
        require(uint8(m.state) == uint8(CupRegistry.MatchState.Settled), "not settled");

        // Winner advanced into match 32 (feederA slot).
        CupRegistry.CupMatch memory child = registry.getMatch(32);
        require(child.teamA == m.winner, "winner not advanced");
    }

    function test_ScoringNormalizesNegativeScorelines() public {
        _draw();
        _reveal(5);
        // A: -1% -> -2 goals, B: +0.5% -> +1 goal => normalized 0-3.
        _submitAndSettle(5, 99 * 1e8, 1005 * 1e7);

        CupRegistry.CupMatch memory m = registry.getMatch(5);
        require(m.goalsA == 0 && m.goalsB == 3, "normalization wrong");
        require(m.winner == m.teamB, "winner wrong");
    }

    function test_BestMoverTiebreak() public {
        _draw();
        _reveal(6);
        // Both 1 goal (+0.6% vs +0.7%); B is the better mover.
        _submitAndSettle(6, 1006 * 1e7, 1007 * 1e7);

        CupRegistry.CupMatch memory m = registry.getMatch(6);
        require(m.goalsA == 1 && m.goalsB == 1, "not a 1-1 tie");
        require(m.winner == m.teamB, "best mover did not advance");
    }

    function test_SettleGuards() public {
        _draw();
        _reveal(7);
        // No end price submitted yet.
        vm.prank(operator);
        vm.expectRevert();
        engine.settleMatch(7);
    }

    // ---------------------------------------------------------------------
    // Circuit breaker + DAO ballot
    // ---------------------------------------------------------------------

    function test_CircuitBreakerTripsAndOpensBallot() public {
        _draw();
        _reveal(0);
        _submitAndSettle(0, 130 * 1e8, 100 * 1e8); // +30% -> 60-0, spike trips breaker

        CupRegistry.CupMatch memory m = registry.getMatch(0);
        require(uint8(m.state) == uint8(CupRegistry.MatchState.Disputed), "not disputed");
        require(m.winner == type(uint16).max, "winner set despite dispute");
        require(ballot.ballotCount() == 1, "ballot not opened");

        DisputeBallot.Ballot memory b = ballot.getBallot(0);
        require(b.matchId == 0, "wrong match");
        require(b.accusedTeam == m.teamA, "wrong accused team");
        require(!b.resolved, "resolved prematurely");

        // Pool must NOT settle while disputed.
        require(!pool.getMatchPool(0).settled, "pool settled during dispute");
    }

    function test_LargeMarginWithoutSpikeSettlesNormally() public {
        // The Polygon case: +8% vs flat prints 16-0 — a big scoreline, but
        // no ±30% spike, so it settles normally and no ballot opens.
        _draw();
        _reveal(1);
        _submitAndSettle(1, 108 * 1e8, 100 * 1e8);

        CupRegistry.CupMatch memory m = registry.getMatch(1);
        require(uint8(m.state) == uint8(CupRegistry.MatchState.Settled), "should settle");
        require(m.goalsA == 16 && m.goalsB == 0, "wrong scoreline");
        require(m.winner == m.teamA, "wrong winner");
        require(ballot.ballotCount() == 0, "ballot should not open");
        require(pool.getMatchPool(1).settled, "pool should settle");
    }

    function test_BallotManipulatedDQAdvancesOpponent() public {
        _draw();
        _reveal(0);
        CupRegistry.CupMatch memory before = registry.getMatch(0);

        // Bob backs the underdog (teamB) pre-match.
        vm.startPrank(bob);
        tick.approve(address(pool), 10_000 * 1e18);
        pool.stakeMatch(0, 1, 2_000 * 1e18);
        vm.stopPrank();

        _submitAndSettle(0, 130 * 1e8, 100 * 1e8); // 60-0, disputed

        _voteAll(0, true, 5); // unanimous MANIPULATED
        vm.warp(block.timestamp + 24 hours + 1);
        ballot.resolve(0);

        DisputeBallot.Ballot memory b = ballot.getBallot(0);
        require(b.resolved, "not resolved");

        CupRegistry.CupMatch memory m = registry.getMatch(0);
        require(uint8(m.state) == uint8(CupRegistry.MatchState.Settled), "not settled");
        require(m.winner == before.teamB, "opponent did not advance");

        // Pool settled on the corrected result: bob wins.
        require(pool.getMatchPool(0).settled, "pool not settled");
        uint256 balBefore = tick.balanceOf(bob);
        vm.prank(bob);
        pool.claimMatch(0);
        require(tick.balanceOf(bob) > balBefore, "no payout");
    }

    function test_BallotLegitimateSettlesAsScored() public {
        _draw();
        _reveal(0);
        CupRegistry.CupMatch memory before = registry.getMatch(0);

        vm.startPrank(alice);
        tick.approve(address(pool), 10_000 * 1e18);
        pool.stakeMatch(0, 0, 1_000 * 1e18); // backs teamA
        vm.stopPrank();

        _submitAndSettle(0, 130 * 1e8, 100 * 1e8); // 60-0, disputed

        _voteAll(0, false, 5); // unanimous LEGITIMATE
        vm.warp(block.timestamp + 24 hours + 1);
        ballot.resolve(0);

        CupRegistry.CupMatch memory m = registry.getMatch(0);
        require(m.winner == before.teamA, "score not honored");
        require(m.goalsA == 60 && m.goalsB == 0, "scoreline lost");

        uint256 balBefore = tick.balanceOf(alice);
        vm.prank(alice);
        pool.claimMatch(0);
        require(tick.balanceOf(alice) > balBefore, "no payout");
    }

    function test_BallotNoQuorumDefaultsToLegitimate() public {
        _draw();
        _reveal(0);
        CupRegistry.CupMatch memory before = registry.getMatch(0);

        _submitAndSettle(0, 130 * 1e8, 100 * 1e8); // disputed
        _voteAll(0, true, 3); // below quorum of 5

        vm.warp(block.timestamp + 24 hours + 1);
        ballot.resolve(0);

        CupRegistry.CupMatch memory m = registry.getMatch(0);
        require(m.winner == before.teamA, "no-quorum should stand as scored");
    }

    function test_VoteFeeAndOneVotePerWallet() public {
        _draw();
        _reveal(0);
        _submitAndSettle(0, 130 * 1e8, 100 * 1e8);

        uint256 balBefore = tick.balanceOf(v1);
        uint256 treasuryBefore = tick.balanceOf(treasury);

        vm.startPrank(v1);
        tick.approve(address(ballot), 200 * 1e18);
        ballot.vote(0, true);
        vm.expectRevert();
        ballot.vote(0, true); // second vote reverts
        vm.stopPrank();

        require(tick.balanceOf(v1) == balBefore - 100 * 1e18, "fee wrong");
        require(tick.balanceOf(treasury) == treasuryBefore + 100 * 1e18, "fee not to treasury");
        require(ballot.hasVoted(0, v1), "vote not recorded");
    }

    function test_ResolveBeforeDeadlineReverts() public {
        _draw();
        _reveal(0);
        _submitAndSettle(0, 130 * 1e8, 100 * 1e8);
        _voteAll(0, true, 5);
        vm.expectRevert();
        ballot.resolve(0);
    }

    // ---------------------------------------------------------------------
    // Pools
    // ---------------------------------------------------------------------

    function test_StakeOpenRightAfterDrawBeforeKickoffReveal() public {
        _draw();
        // No kickoff revealed yet — R64 is still stakable.
        vm.startPrank(alice);
        tick.approve(address(pool), 10_000 * 1e18);
        pool.stakeMatch(3, 0, 1_000 * 1e18);
        vm.stopPrank();
        require(pool.getMatchStake(3, alice, 0) == 1_000 * 1e18, "stake not recorded");
    }

    function test_CannotStakeLaterRoundUntilBothTeamsKnown() public {
        _draw();
        vm.startPrank(alice);
        tick.approve(address(pool), 10_000 * 1e18);
        vm.expectRevert();
        pool.stakeMatch(32, 0, 1_000 * 1e18); // teams TBD
        vm.stopPrank();

        // After both feeders settle, the winners are known and staking opens.
        _playMatch(0, registry.getMatch(0).teamA);
        _playMatch(1, registry.getMatch(1).teamA);
        vm.prank(alice);
        pool.stakeMatch(32, 0, 1_000 * 1e18);
        require(pool.getMatchStake(32, alice, 0) == 1_000 * 1e18, "stake not recorded");
    }

    function test_PoolStakeSettleClaimParimutuel() public {
        _draw();
        _reveal(0);
        vm.prank(owner);
        pool.seedMatchPools(0, 1);

        vm.startPrank(alice);
        tick.approve(address(pool), 20_000 * 1e18);
        pool.stakeMatch(0, 0, 1_000 * 1e18);
        vm.stopPrank();
        vm.startPrank(bob);
        tick.approve(address(pool), 20_000 * 1e18);
        pool.stakeMatch(0, 1, 3_000 * 1e18);
        vm.stopPrank();

        _submitAndSettle(0, 1012 * 1e7, 1001 * 1e7); // 2-0, teamA wins

        // totalPool = 1000 + 3000 + 250 seed = 4250; alice's share of the
        // 1000-strong winning side, minus 7% fee.
        uint256 balBefore = tick.balanceOf(alice);
        vm.prank(alice);
        pool.claimMatch(0);
        uint256 payout = tick.balanceOf(alice) - balBefore;
        require(payout == (4250 * 1e18 * 9300) / 10_000, "parimutuel payout wrong");

        // Double-claim reverts.
        vm.prank(alice);
        vm.expectRevert();
        pool.claimMatch(0);
    }

    function test_PoolTreasurySweepOnEmptyWinningSide() public {
        _draw();
        _reveal(0);
        vm.prank(owner);
        pool.seedMatchPools(0, 1);

        // Bob backs only the loser (teamB).
        vm.startPrank(bob);
        tick.approve(address(pool), 20_000 * 1e18);
        pool.stakeMatch(0, 1, 3_000 * 1e18);
        vm.stopPrank();

        _submitAndSettle(0, 1012 * 1e7, 1001 * 1e7); // teamA wins; side 0 empty

        // Entire pool (3000 + 250 seed) swept to treasury at settlement.
        require(tick.balanceOf(treasury) == 3250 * 1e18, "treasury sweep wrong");

        // Bob forfeits: no revert, no payout.
        uint256 balBefore = tick.balanceOf(bob);
        vm.prank(bob);
        pool.claimMatch(0);
        require(tick.balanceOf(bob) == balBefore, "forfeit paid out");
    }

    function test_SpreadCreateStakeSettleClaim() public {
        _draw();
        CupRegistry.CupMatch memory m0 = registry.getMatch(0);

        vm.prank(owner);
        uint256 sid = pool.createSpread(0, m0.teamA, 10);

        // Identical spread rejected.
        vm.prank(owner);
        vm.expectRevert();
        pool.createSpread(0, m0.teamA, 10);

        // A different spread on the same match is fine.
        vm.prank(owner);
        pool.createSpread(0, m0.teamA, 5);

        _reveal(0);
        vm.startPrank(alice);
        tick.approve(address(pool), 20_000 * 1e18);
        pool.stakeSpread(sid, 0, 1_000 * 1e18); // backs cover
        vm.stopPrank();

        _submitAndSettle(0, 106 * 1e8, 100 * 1e8); // +6% -> 12-0, margin 12 >= 10

        CupPool.Spread memory sp = pool.getSpread(sid);
        require(sp.settled && sp.covered, "spread should be covered");

        uint256 balBefore = tick.balanceOf(alice);
        vm.prank(alice);
        pool.claimSpread(sid);
        require(tick.balanceOf(alice) > balBefore, "no spread payout");
    }

    function test_SpreadNotCovered() public {
        _draw();
        CupRegistry.CupMatch memory m0 = registry.getMatch(0);

        vm.prank(owner);
        uint256 sid = pool.createSpread(0, m0.teamA, 10);

        _reveal(0);
        vm.startPrank(bob);
        tick.approve(address(pool), 20_000 * 1e18);
        pool.stakeSpread(sid, 1, 1_000 * 1e18); // backs not-cover
        vm.stopPrank();

        _submitAndSettle(0, 1012 * 1e7, 1001 * 1e7); // 2-0, margin 2 < 10

        CupPool.Spread memory sp = pool.getSpread(sid);
        require(sp.settled && !sp.covered, "spread should not be covered");

        uint256 balBefore = tick.balanceOf(bob);
        vm.prank(bob);
        pool.claimSpread(sid);
        require(tick.balanceOf(bob) > balBefore, "no spread payout");
    }

    // ---------------------------------------------------------------------
    // Full tournament + outright pool
    // ---------------------------------------------------------------------

    function test_FullTournamentCrownsChampionAndSettlesOutright() public {
        uint16 champPick = 7;

        // Outright staking opens at deployment...
        vm.startPrank(alice);
        tick.approve(address(pool), 20_000 * 1e18);
        pool.stakeOutright(champPick, 5_000 * 1e18);
        vm.stopPrank();
        vm.startPrank(bob);
        tick.approve(address(pool), 20_000 * 1e18);
        pool.stakeOutright(40, 1_000 * 1e18); // backs a loser
        vm.stopPrank();
        vm.prank(owner);
        pool.seedOutright();

        _draw();

        // ...and STAYS open after the draw (until the final kicks off).
        vm.prank(alice);
        pool.stakeOutright(champPick, 100 * 1e18);

        // Play everything except the final, rigging the pick to win.
        for (uint16 id = 0; id < 62; id++) {
            CupRegistry.CupMatch memory m = registry.getMatch(id);
            uint16 winner = (m.teamA == champPick || m.teamB == champPick) ? champPick : m.teamA;
            _playMatch(id, winner);
        }

        // Reveal the final's kickoff and warp to it: the outright closes.
        uint64 kf = uint64(block.timestamp) + 2 hours;
        vm.prank(operator);
        registry.revealKickoff(62, kf);
        vm.warp(kf);
        vm.prank(alice);
        vm.expectRevert();
        pool.stakeOutright(champPick, 100 * 1e18);

        // Play the final (pick wins it).
        CupRegistry.CupMatch memory fin = registry.getMatch(62);
        require(fin.teamA == champPick || fin.teamB == champPick, "pick must reach final");
        vm.startPrank(operator);
        engine.submitStartPrice(62, START_PRICE, START_PRICE);
        vm.warp(kf + 1 hours);
        if (fin.teamA == champPick) {
            engine.submitEndPrice(62, 1012 * 1e7, 1001 * 1e7);
        } else {
            engine.submitEndPrice(62, 1001 * 1e7, 1012 * 1e7);
        }
        engine.settleMatch(62);
        vm.stopPrank();

        require(registry.tournamentComplete(), "tournament not complete");
        require(registry.champion() == champPick, "wrong champion");

        pool.settleOutright();
        require(pool.outrightSettled(), "outright not settled");
        require(pool.outrightChampion() == champPick, "wrong outright champion");

        // Alice (winner) claims; bob (loser) gets nothing.
        uint256 balBefore = tick.balanceOf(alice);
        vm.prank(alice);
        pool.claimOutright();
        require(tick.balanceOf(alice) > balBefore, "no outright payout");

        vm.prank(bob);
        vm.expectRevert();
        pool.claimOutright();
    }
}

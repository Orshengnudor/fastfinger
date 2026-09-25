// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { FastFingerEliminationEscrow } from "../src/FastFingerEliminationEscrow.sol";
import { MockRF } from "../src/mocks/MockRF.sol";
import { MockRewards } from "../src/mocks/MockRewards.sol";

contract FastFingerEliminationEscrowTest is Test {
    FastFingerEliminationEscrow esc;
    MockRF rf;
    address oracle = makeAddr("oracle");
    address[10] p;
    bytes32 constant ID = keccak256("match-1");

    function setUp() public {
        vm.chainId(4663);
        rf = new MockRF();
        esc = new FastFingerEliminationEscrow(address(rf), oracle);
        for (uint256 i; i < 10; ++i) {
            p[i] = address(uint160(0x9000 + i));
            rf.mint(p[i], 100_000 ether);
            vm.prank(p[i]);
            rf.approve(address(esc), type(uint256).max);
        }
    }

    function _createAndFillFive(uint8 tier) internal {
        vm.prank(p[0]);
        esc.createMatch(ID, tier, 5);
        for (uint256 i = 1; i < 5; ++i) {
            vm.prank(p[i]);
            esc.joinMatch(ID);
        }
    }

    // ─── deployment ─────────────────────────────────────────────────────────
    function test_RevertsOnOtherChain() public {
        vm.chainId(8453);
        vm.expectRevert(FastFingerEliminationEscrow.WrongChain.selector);
        new FastFingerEliminationEscrow(address(rf), oracle);
    }

    function test_MinPlayersIsFive() public {
        vm.prank(p[0]);
        vm.expectRevert(FastFingerEliminationEscrow.BadPlayerCount.selector);
        esc.createMatch(ID, 0, 4);

        vm.prank(p[0]);
        esc.createMatch(ID, 0, 5); // should succeed
        assertEq(uint8(esc.getMatch(ID).status), uint8(FastFingerEliminationEscrow.Status.Open));
    }

    function test_MaxPlayersIsTen() public {
        vm.prank(p[0]);
        vm.expectRevert(FastFingerEliminationEscrow.BadPlayerCount.selector);
        esc.createMatch(ID, 0, 11);
    }

    // ─── full flow ──────────────────────────────────────────────────────────
    function test_FullFiveMatch_SixtyTwentyFiveFifteen() public {
        _createAndFillFive(0); // Bronze, 5 players, pot = 50
        assertEq(uint8(esc.getMatch(ID).status), uint8(FastFingerEliminationEscrow.Status.Locked));

        uint256 supplyBefore = rf.totalSupply();
        vm.prank(oracle);
        esc.declareResults(ID, p[2], p[0], p[4]); // arbitrary distinct placements

        FastFingerEliminationEscrow.Match memory m = esc.getMatch(ID);
        // distributable = 50 * 0.9 = 45; 60/25/15 -> 27 / 11.25 / 6.75
        assertEq(m.firstAmount, 27 ether);
        assertEq(m.secondAmount, 11.25 ether);
        assertEq(m.thirdAmount, 6.75 ether);
        assertEq(m.firstAmount + m.secondAmount + m.thirdAmount, 45 ether); // no dust lost

        vm.prank(p[2]);
        esc.claimPrize(ID);
        assertEq(rf.balanceOf(p[2]), 100_000 ether - 10 ether + 27 ether);

        vm.prank(p[0]);
        esc.claimPrize(ID);
        assertEq(rf.balanceOf(p[0]), 100_000 ether - 10 ether + 11.25 ether);

        vm.prank(p[4]);
        esc.claimPrize(ID);
        assertEq(rf.balanceOf(p[4]), 100_000 ether - 10 ether + 6.75 ether);

        assertEq(supplyBefore - rf.totalSupply(), 5 ether); // whole 10% rake burned
        assertEq(rf.balanceOf(address(esc)), 0);
    }

    function test_ClaimOrderDoesNotMatter() public {
        _createAndFillFive(0);
        vm.prank(oracle);
        esc.declareResults(ID, p[4], p[3], p[2]);

        // 3rd claims before 1st or 2nd — must still work and pay the right amount
        vm.prank(p[2]);
        esc.claimPrize(ID);
        assertEq(rf.balanceOf(p[2]), 100_000 ether - 10 ether + 6.75 ether);

        vm.prank(p[4]);
        esc.claimPrize(ID);
        assertEq(rf.balanceOf(p[4]), 100_000 ether - 10 ether + 27 ether);
    }

    function test_DeclareResultsValidation() public {
        _createAndFillFive(0);
        vm.startPrank(oracle);
        vm.expectRevert(FastFingerEliminationEscrow.NotAPlayer.selector);
        esc.declareResults(ID, p[0], p[1], address(0x999)); // not a player

        vm.expectRevert(FastFingerEliminationEscrow.DuplicatePlacement.selector);
        esc.declareResults(ID, p[0], p[0], p[1]);
        vm.stopPrank();

        vm.prank(p[0]);
        vm.expectRevert(FastFingerEliminationEscrow.NotOracle.selector);
        esc.declareResults(ID, p[0], p[1], p[2]);
    }

    function test_OnlyPlacersCanClaim() public {
        _createAndFillFive(0);
        vm.prank(oracle);
        esc.declareResults(ID, p[0], p[1], p[2]);

        vm.prank(p[3]); // not placed
        vm.expectRevert(FastFingerEliminationEscrow.NotAPlacer.selector);
        esc.claimPrize(ID);
    }

    function test_CannotClaimTwice() public {
        _createAndFillFive(0);
        vm.prank(oracle);
        esc.declareResults(ID, p[0], p[1], p[2]);

        vm.prank(p[0]);
        esc.claimPrize(ID);
        vm.prank(p[0]);
        vm.expectRevert(FastFingerEliminationEscrow.AlreadyClaimed.selector);
        esc.claimPrize(ID);
    }

    function test_CancelSoloRefunds() public {
        uint256 before = rf.balanceOf(p[0]);
        vm.prank(p[0]);
        esc.createMatch(ID, 2, 5);
        vm.prank(p[0]);
        esc.cancelMatch(ID);
        assertEq(rf.balanceOf(p[0]), before);
    }

    function test_HostStartsEarlyAtFive() public {
        vm.prank(p[0]);
        esc.createMatch(ID, 0, 8);
        for (uint256 i = 1; i < 5; ++i) {
            vm.prank(p[i]);
            esc.joinMatch(ID);
        }
        vm.prank(p[1]);
        vm.expectRevert(FastFingerEliminationEscrow.NotHost.selector);
        esc.startMatch(ID);

        vm.prank(p[0]);
        esc.startMatch(ID);
        assertEq(uint8(esc.getMatch(ID).status), uint8(FastFingerEliminationEscrow.Status.Locked));
    }

    // ─── sweep / stale ──────────────────────────────────────────────────────
    function test_SweepUnclaimed_OnlySweepsWhatsLeft() public {
        _createAndFillFive(0);
        vm.prank(oracle);
        esc.declareResults(ID, p[0], p[1], p[2]); // burns the 5 RF rake immediately

        vm.prank(p[0]); // 1st claims for real, others don't
        esc.claimPrize(ID);

        vm.warp(block.timestamp + 7 days + 1);
        uint256 supplyBeforeSweep = rf.totalSupply();
        esc.sweepUnclaimed(ID);

        // only 2nd + 3rd's shares get burned by the sweep itself (11.25 + 6.75 = 18)
        assertEq(supplyBeforeSweep - rf.totalSupply(), 18 ether);
        assertEq(rf.balanceOf(address(esc)), 0);

        // 1st already claimed, can't claim again, and can't be swept again
        vm.prank(p[0]);
        vm.expectRevert(FastFingerEliminationEscrow.NotDeclared.selector); // status is now Swept
        esc.claimPrize(ID);
    }

    function test_SweepWithRewardsConfigured() public {
        MockRewards rewards = new MockRewards();
        esc.setRewards(address(rewards));
        _createAndFillFive(0);
        vm.prank(oracle);
        esc.declareResults(ID, p[0], p[1], p[2]);
        vm.warp(block.timestamp + 7 days + 1);
        esc.sweepUnclaimed(ID);
        // 2.5 from the rake at declare (half of 5) + 22.5 from sweeping all
        // three unclaimed shares (half of the full 45 distributable) = 25
        assertEq(rf.balanceOf(address(rewards)), 25 ether);
    }

    function test_RefundStaleLocked() public {
        _createAndFillFive(0);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(oracle);
        vm.expectRevert(FastFingerEliminationEscrow.SettleWindowClosed.selector);
        esc.declareResults(ID, p[0], p[1], p[2]);

        esc.refundStale(ID);
        for (uint256 i; i < 5; ++i) {
            assertEq(rf.balanceOf(p[i]), 100_000 ether);
        }
        assertEq(rf.balanceOf(address(esc)), 0);
    }

    // ─── fuzz ───────────────────────────────────────────────────────────────
    function testFuzz_FullMatchConserves(uint8 tier, uint8 numPlayers, uint8 f, uint8 s, uint8 t) public {
        tier = uint8(bound(tier, 0, 5));
        numPlayers = uint8(bound(numPlayers, 5, 10));
        f = uint8(bound(f, 0, numPlayers - 1));
        s = uint8(bound(s, 0, numPlayers - 1));
        t = uint8(bound(t, 0, numPlayers - 1));
        vm.assume(f != s && f != t && s != t);

        vm.prank(p[0]);
        esc.createMatch(ID, tier, numPlayers);
        for (uint256 i = 1; i < numPlayers; ++i) {
            vm.prank(p[i]);
            esc.joinMatch(ID);
        }

        uint256 supplyBefore = rf.totalSupply();
        vm.prank(oracle);
        esc.declareResults(ID, p[f], p[s], p[t]);

        vm.prank(p[f]);
        esc.claimPrize(ID);
        vm.prank(p[s]);
        esc.claimPrize(ID);
        vm.prank(p[t]);
        esc.claimPrize(ID);

        uint256 entry = esc.tierEntry(tier);
        uint256 pot = entry * numPlayers;
        uint256 distributable = (pot * 9000) / 10_000;
        assertEq(supplyBefore - rf.totalSupply(), pot - distributable);
        assertEq(rf.balanceOf(address(esc)), 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FastFingerSeasonPool} from "../src/FastFingerSeasonPool.sol";
import {MockRF} from "./mocks/MockRF.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract FastFingerSeasonPoolTest is Test {
    FastFingerSeasonPool pool;
    MockRF rf;

    address owner = makeAddr("owner");
    address winner1 = makeAddr("winner1");
    address winner2 = makeAddr("winner2");
    address winner3 = makeAddr("winner3");
    address stranger = makeAddr("stranger");
    address escrow = makeAddr("escrow"); // stands in for FastFingerEscrow sending rake

    function setUp() public {
        rf = new MockRF();
        pool = new FastFingerSeasonPool(address(rf), owner);
        rf.transfer(escrow, 100_000 ether);
        vm.prank(escrow);
        rf.transfer(address(pool), 10_000 ether);
    }

    function test_constructor_revertsOnZeroToken() public {
        vm.expectRevert(FastFingerSeasonPool.ZeroAddress.selector);
        new FastFingerSeasonPool(address(0), owner);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new FastFingerSeasonPool(address(rf), address(0));
    }

    function test_constructor_setsTokenAndOwner() public view {
        assertEq(address(pool.RF()), address(rf));
        assertEq(pool.owner(), owner);
    }

    function test_balance_reflectsRealHoldings() public view {
        assertEq(pool.balance(), 10_000 ether);
    }

    function test_balance_growsWithPlainTransfers() public {
        vm.prank(escrow);
        rf.transfer(address(pool), 5_000 ether);
        assertEq(pool.balance(), 15_000 ether);
    }

    function test_payout_happyPath() public {
        vm.prank(owner);
        pool.payout(winner1, 1_000 ether, "2026-W40 1st");
        assertEq(rf.balanceOf(winner1), 1_000 ether);
        assertEq(pool.balance(), 9_000 ether);
        assertEq(pool.totalPaidOut(), 1_000 ether);
    }

    function test_payout_emitsEvent() public {
        vm.expectEmit(true, false, false, true, address(pool));
        emit FastFingerSeasonPool.Payout(winner1, 1_000 ether, "note");
        vm.prank(owner);
        pool.payout(winner1, 1_000 ether, "note");
    }

    function test_payout_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pool.payout(winner1, 1_000 ether, "");
    }

    function test_payout_revertsOnZeroWinner() public {
        vm.prank(owner);
        vm.expectRevert(FastFingerSeasonPool.ZeroAddress.selector);
        pool.payout(address(0), 1_000 ether, "");
    }

    function test_payout_revertsOnZeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(FastFingerSeasonPool.ZeroAmount.selector);
        pool.payout(winner1, 0, "");
    }

    function test_payout_revertsIfExceedsBalance() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(FastFingerSeasonPool.InsufficientBalance.selector, 10_001 ether, 10_000 ether)
        );
        pool.payout(winner1, 10_001 ether, "");
    }

    function testFuzz_payout_neverExceedsBalance(uint256 amount) public {
        amount = bound(amount, 1, 10_000 ether);
        vm.prank(owner);
        pool.payout(winner1, amount, "");
        assertEq(rf.balanceOf(winner1), amount);
        assertEq(pool.balance(), 10_000 ether - amount);
    }

    function test_payoutBatch_happyPath() public {
        address[] memory winners = new address[](3);
        winners[0] = winner1;
        winners[1] = winner2;
        winners[2] = winner3;
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 1_000 ether;
        amounts[1] = 500 ether;
        amounts[2] = 250 ether;

        vm.prank(owner);
        pool.payoutBatch(winners, amounts, "2026-W40 top3");

        assertEq(rf.balanceOf(winner1), 1_000 ether);
        assertEq(rf.balanceOf(winner2), 500 ether);
        assertEq(rf.balanceOf(winner3), 250 ether);
        assertEq(pool.balance(), 10_000 ether - 1_750 ether);
        assertEq(pool.totalPaidOut(), 1_750 ether);
    }

    function test_payoutBatch_revertsForNonOwner() public {
        address[] memory winners = new address[](1);
        winners[0] = winner1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pool.payoutBatch(winners, amounts, "");
    }

    function test_payoutBatch_revertsOnLengthMismatch() public {
        address[] memory winners = new address[](2);
        winners[0] = winner1;
        winners[1] = winner2;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;
        vm.prank(owner);
        vm.expectRevert(FastFingerSeasonPool.LengthMismatch.selector);
        pool.payoutBatch(winners, amounts, "");
    }

    function test_payoutBatch_revertsOnEmptyArrays() public {
        address[] memory winners = new address[](0);
        uint256[] memory amounts = new uint256[](0);
        vm.prank(owner);
        vm.expectRevert(FastFingerSeasonPool.LengthMismatch.selector);
        pool.payoutBatch(winners, amounts, "");
    }

    function test_payoutBatch_isAtomicWhenExceedingBalance() public {
        address[] memory winners = new address[](2);
        winners[0] = winner1;
        winners[1] = winner2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 9_000 ether;
        amounts[1] = 2_000 ether;
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(FastFingerSeasonPool.InsufficientBalance.selector, 11_000 ether, 10_000 ether)
        );
        pool.payoutBatch(winners, amounts, "");
        assertEq(rf.balanceOf(winner1), 0);
        assertEq(rf.balanceOf(winner2), 0);
        assertEq(pool.balance(), 10_000 ether);
    }

    function test_payoutBatch_revertsOnZeroAddressInBatch() public {
        address[] memory winners = new address[](2);
        winners[0] = winner1;
        winners[1] = address(0);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1 ether;
        amounts[1] = 1 ether;
        vm.prank(owner);
        vm.expectRevert(FastFingerSeasonPool.ZeroAddress.selector);
        pool.payoutBatch(winners, amounts, "");
    }

    function test_payoutBatch_revertsOnZeroAmountInBatch() public {
        address[] memory winners = new address[](2);
        winners[0] = winner1;
        winners[1] = winner2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1 ether;
        amounts[1] = 0;
        vm.prank(owner);
        vm.expectRevert(FastFingerSeasonPool.ZeroAmount.selector);
        pool.payoutBatch(winners, amounts, "");
    }

    function test_sweep_happyPath() public {
        vm.prank(owner);
        pool.sweep(stranger);
        assertEq(rf.balanceOf(stranger), 10_000 ether);
        assertEq(pool.balance(), 0);
    }

    function test_sweep_emitsEvent() public {
        vm.expectEmit(true, false, false, true, address(pool));
        emit FastFingerSeasonPool.Swept(stranger, 10_000 ether);
        vm.prank(owner);
        pool.sweep(stranger);
    }

    function test_sweep_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pool.sweep(stranger);
    }

    function test_sweep_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(FastFingerSeasonPool.ZeroAddress.selector);
        pool.sweep(address(0));
    }

    function test_sweep_revertsOnZeroBalance() public {
        vm.prank(owner);
        pool.sweep(stranger);
        vm.prank(owner);
        vm.expectRevert(FastFingerSeasonPool.ZeroAmount.selector);
        pool.sweep(stranger);
    }

    // --- fund ------------------------------------------------------------

    function test_fund_happyPath() public {
        vm.prank(escrow);
        rf.transfer(stranger, 2_000 ether);

        vm.startPrank(stranger);
        rf.approve(address(pool), 2_000 ether);
        pool.fund(2_000 ether);
        vm.stopPrank();

        assertEq(pool.balance(), 12_000 ether);
    }

    function test_fund_emitsEvent() public {
        vm.prank(escrow);
        rf.transfer(stranger, 500 ether);

        vm.startPrank(stranger);
        rf.approve(address(pool), 500 ether);
        vm.expectEmit(true, false, false, true, address(pool));
        emit FastFingerSeasonPool.Funded(stranger, 500 ether);
        pool.fund(500 ether);
        vm.stopPrank();
    }

    function test_fund_revertsOnZeroAmount() public {
        vm.prank(stranger);
        vm.expectRevert(FastFingerSeasonPool.ZeroAmount.selector);
        pool.fund(0);
    }

    function test_fund_revertsWithoutApproval() public {
        vm.prank(escrow);
        rf.transfer(stranger, 100 ether);

        vm.prank(stranger);
        vm.expectRevert();
        pool.fund(100 ether);
    }

    function test_fund_anyoneCanCall_notOwnerOnly() public {
        vm.prank(escrow);
        rf.transfer(stranger, 1 ether);

        vm.startPrank(stranger);
        rf.approve(address(pool), 1 ether);
        pool.fund(1 ether);
        vm.stopPrank();
    }

    // --- seasons -----------------------------------------------------------

    function test_season_startsAtZero_waitingToStart() public view {
        assertEq(pool.seasonId(), 0);
        assertFalse(pool.seasonActive());
    }

    function test_startSeason_happyPath() public {
        vm.prank(owner);
        pool.startSeason();

        assertEq(pool.seasonId(), 1);
        assertEq(pool.seasonStartedAt(), block.timestamp);
        assertEq(pool.seasonEndedAt(), 0);
        assertTrue(pool.seasonActive());
    }

    function test_startSeason_emitsEvent() public {
        vm.expectEmit(true, false, false, true, address(pool));
        emit FastFingerSeasonPool.SeasonStarted(1, block.timestamp);
        vm.prank(owner);
        pool.startSeason();
    }

    function test_startSeason_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pool.startSeason();
    }

    function test_startSeason_revertsIfAlreadyActive() public {
        vm.prank(owner);
        pool.startSeason();

        vm.prank(owner);
        vm.expectRevert(FastFingerSeasonPool.SeasonAlreadyActive.selector);
        pool.startSeason();
    }

    function test_endSeason_happyPath() public {
        vm.prank(owner);
        pool.startSeason();

        vm.warp(block.timestamp + 7 days);
        vm.prank(owner);
        pool.endSeason();

        assertEq(pool.seasonEndedAt(), block.timestamp);
        assertFalse(pool.seasonActive());
        assertEq(pool.seasonId(), 1);
    }

    function test_endSeason_revertsIfNoneActive() public {
        vm.prank(owner);
        vm.expectRevert(FastFingerSeasonPool.NoActiveSeason.selector);
        pool.endSeason();
    }

    function test_endSeason_revertsForNonOwner() public {
        vm.prank(owner);
        pool.startSeason();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pool.endSeason();
    }

    function test_startSeason_canStartNextAfterEnding() public {
        vm.startPrank(owner);
        pool.startSeason();
        pool.endSeason();
        pool.startSeason();
        vm.stopPrank();

        assertEq(pool.seasonId(), 2);
        assertTrue(pool.seasonActive());
    }

    function test_ownership_transferRequiresAcceptance() public {
        vm.prank(owner);
        pool.transferOwnership(stranger);
        assertEq(pool.owner(), owner);
        vm.prank(owner);
        pool.payout(winner1, 1 ether, "");
        vm.prank(stranger);
        pool.acceptOwnership();
        assertEq(pool.owner(), stranger);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        pool.payout(winner1, 1 ether, "");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FastFingerFaucet} from "../src/FastFingerFaucet.sol";
import {MockRF} from "./mocks/MockRF.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract FastFingerFaucetTest is Test {
    FastFingerFaucet faucet;
    MockRF rf;

    address owner = makeAddr("owner");
    address funder = makeAddr("funder");
    uint256 constant CLAIM_AMOUNT = 20 ether;
    uint256 constant MAX_CLAIMS = 100;

    function setUp() public {
        rf = new MockRF();
        faucet = new FastFingerFaucet(address(rf), owner, CLAIM_AMOUNT, MAX_CLAIMS);
        rf.transfer(funder, 100_000 ether);
        vm.prank(funder);
        rf.transfer(address(faucet), 2_000 ether);
    }

    function test_constructor_revertsOnZeroToken() public {
        vm.expectRevert(FastFingerFaucet.ZeroAddress.selector);
        new FastFingerFaucet(address(0), owner, CLAIM_AMOUNT, MAX_CLAIMS);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new FastFingerFaucet(address(rf), address(0), CLAIM_AMOUNT, MAX_CLAIMS);
    }

    function test_constructor_revertsOnZeroClaimAmount() public {
        vm.expectRevert(FastFingerFaucet.ZeroAmount.selector);
        new FastFingerFaucet(address(rf), owner, 0, MAX_CLAIMS);
    }

    function test_constructor_revertsOnZeroMaxClaims() public {
        vm.expectRevert(FastFingerFaucet.ZeroAmount.selector);
        new FastFingerFaucet(address(rf), owner, CLAIM_AMOUNT, 0);
    }

    function test_constructor_setsParams() public view {
        assertEq(address(faucet.RF()), address(rf));
        assertEq(faucet.owner(), owner);
        assertEq(faucet.claimAmount(), CLAIM_AMOUNT);
        assertEq(faucet.maxClaims(), MAX_CLAIMS);
        assertTrue(faucet.claimOpen());
    }

    function test_balance_reflectsRealHoldings() public view {
        assertEq(faucet.balance(), 2_000 ether);
    }

    function test_remaining_startsAtMax() public view {
        assertEq(faucet.remaining(), MAX_CLAIMS);
    }

    function test_claim_happyPath() public {
        address alice = makeAddr("alice");
        vm.prank(alice);
        faucet.claim();

        assertEq(rf.balanceOf(alice), CLAIM_AMOUNT);
        assertEq(faucet.claimedCount(), 1);
        assertEq(faucet.remaining(), MAX_CLAIMS - 1);
        assertTrue(faucet.hasClaimed(alice));
    }

    function test_claim_emitsEvent() public {
        address alice = makeAddr("alice");
        vm.expectEmit(true, false, false, true, address(faucet));
        emit FastFingerFaucet.Claimed(alice, CLAIM_AMOUNT, 1);
        vm.prank(alice);
        faucet.claim();
    }

    function test_claim_revertsOnSecondAttempt() public {
        address alice = makeAddr("alice");
        vm.startPrank(alice);
        faucet.claim();
        vm.expectRevert(FastFingerFaucet.AlreadyClaimed.selector);
        faucet.claim();
        vm.stopPrank();
    }

    function test_claim_revertsWhenClosed() public {
        vm.prank(owner);
        faucet.setClaimOpen(false);

        address alice = makeAddr("alice");
        vm.prank(alice);
        vm.expectRevert(FastFingerFaucet.ClaimClosed.selector);
        faucet.claim();
    }

    function test_claim_revertsAtCap() public {
        for (uint256 i = 0; i < MAX_CLAIMS; i++) {
            vm.prank(makeAddr(string.concat("claimant", vm.toString(i))));
            faucet.claim();
        }
        assertEq(faucet.claimedCount(), MAX_CLAIMS);
        assertEq(faucet.remaining(), 0);

        address oneTooMany = makeAddr("oneTooMany");
        vm.prank(oneTooMany);
        vm.expectRevert(FastFingerFaucet.ClaimLimitReached.selector);
        faucet.claim();
    }

    function test_claim_revertsIfPoolUnderfunded() public {
        vm.prank(owner);
        faucet.sweep(owner);

        address alice = makeAddr("alice");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FastFingerFaucet.InsufficientBalance.selector, CLAIM_AMOUNT, 0));
        faucet.claim();
    }

    function testFuzz_claim_countNeverExceedsCap(uint8 numClaimants) public {
        uint256 n = bound(numClaimants, 1, 150);
        uint256 successCount = 0;
        for (uint256 i = 0; i < n; i++) {
            address claimant = makeAddr(string.concat("fuzzclaimant", vm.toString(i)));
            vm.prank(claimant);
            try faucet.claim() {
                successCount++;
            } catch {
            }
        }
        assertLe(faucet.claimedCount(), MAX_CLAIMS);
        assertEq(faucet.claimedCount(), successCount);
    }

    function test_fund_happyPath() public {
        address stranger = makeAddr("stranger");
        vm.prank(funder);
        rf.transfer(stranger, 500 ether);

        vm.startPrank(stranger);
        rf.approve(address(faucet), 500 ether);
        faucet.fund(500 ether);
        vm.stopPrank();

        assertEq(faucet.balance(), 2_500 ether);
    }

    function test_fund_revertsOnZeroAmount() public {
        vm.expectRevert(FastFingerFaucet.ZeroAmount.selector);
        faucet.fund(0);
    }

    function test_setClaimOpen_revertsForNonOwner() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        faucet.setClaimOpen(false);
    }

    function test_setClaimOpen_emitsEvent() public {
        vm.expectEmit(true, false, false, true, address(faucet));
        emit FastFingerFaucet.ClaimOpenSet(false);
        vm.prank(owner);
        faucet.setClaimOpen(false);
    }

    function test_setClaimOpen_reopenWorks() public {
        vm.startPrank(owner);
        faucet.setClaimOpen(false);
        faucet.setClaimOpen(true);
        vm.stopPrank();

        address alice = makeAddr("alice");
        vm.prank(alice);
        faucet.claim();
        assertEq(faucet.claimedCount(), 1);
    }

    function test_sweep_happyPath() public {
        address stranger = makeAddr("stranger");
        vm.prank(owner);
        faucet.sweep(stranger);

        assertEq(rf.balanceOf(stranger), 2_000 ether);
        assertEq(faucet.balance(), 0);
    }

    function test_sweep_revertsForNonOwner() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        faucet.sweep(stranger);
    }

    function test_sweep_revertsOnZeroBalance() public {
        vm.startPrank(owner);
        faucet.sweep(owner);
        vm.expectRevert(FastFingerFaucet.ZeroAmount.selector);
        faucet.sweep(owner);
        vm.stopPrank();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { FastFingerEscrow } from "../src/FastFingerEscrow.sol";
import { MockRF } from "../src/mocks/MockRF.sol";
import { MockGenerations } from "../src/mocks/MockGenerations.sol";
import { MockRewards } from "../src/mocks/MockRewards.sol";

/// @dev ERC20 without burn(): escrow must fall back to the dead address.
contract NoBurnRF is ERC20 {
    constructor() ERC20("NoBurn", "NB") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FastFingerEscrowTest is Test {
    FastFingerEscrow esc;
    MockRF rf;
    MockGenerations gens;
    address oracle = makeAddr("oracle");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");
    bytes32 constant ID = keccak256("match-1");
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        vm.chainId(4663); // Robinhood Chain mainnet - the only chain this contract runs on.
        rf = new MockRF();
        gens = new MockGenerations();
        esc = new FastFingerEscrow(address(rf), address(gens), oracle);
        address[4] memory users = [alice, bob, carol, dave];
        for (uint256 i; i < users.length; ++i) {
            rf.mint(users[i], 100_000 ether);
            vm.prank(users[i]);
            rf.approve(address(esc), type(uint256).max);
        }
    }

    // ─── helpers ──────────────────────────────────────────────────────────
    function _create(address host, uint8 tier, uint8 max) internal {
        vm.prank(host);
        esc.createMatch(ID, tier, max);
    }

    function _join(address p) internal {
        vm.prank(p);
        esc.joinMatch(ID);
    }

    function _declare(address w) internal {
        vm.prank(oracle);
        esc.declareWinner(ID, w);
    }

    function _status() internal view returns (FastFingerEscrow.Status) {
        return esc.getMatch(ID).status;
    }

    // ─── deployment guards ────────────────────────────────────────────────
    function test_RevertsOnOtherChain() public {
        vm.chainId(8453); // Base - or anything that isn't 4663
        vm.expectRevert(FastFingerEscrow.WrongChain.selector);
        new FastFingerEscrow(address(rf), address(gens), oracle);
    }

    function test_RevertsOnZeroAddresses() public {
        vm.expectRevert(FastFingerEscrow.ZeroAddress.selector);
        new FastFingerEscrow(address(0), address(gens), oracle);
        vm.expectRevert(FastFingerEscrow.ZeroAddress.selector);
        new FastFingerEscrow(address(rf), address(0), oracle);
        vm.expectRevert(FastFingerEscrow.ZeroAddress.selector);
        new FastFingerEscrow(address(rf), address(gens), address(0));
    }

    function test_RewardsStartsUnset() public view {
        assertEq(esc.rewards(), address(0));
    }

    function test_TierEntries() public view {
        assertEq(esc.tierEntry(0), 10 ether);
        assertEq(esc.tierEntry(1), 25 ether);
        assertEq(esc.tierEntry(2), 50 ether);
        assertEq(esc.tierEntry(3), 100 ether);
        assertEq(esc.tierEntry(4), 250 ether);
        assertEq(esc.tierEntry(5), 1000 ether);
    }

    // ─── create / join / lock ─────────────────────────────────────────────
    function test_CreatePullsStake() public {
        _create(alice, 2, 4);
        assertEq(rf.balanceOf(address(esc)), 50 ether);
        FastFingerEscrow.Match memory m = esc.getMatch(ID);
        assertEq(m.host, alice);
        assertEq(m.playerCount, 1);
        assertEq(uint8(m.status), uint8(FastFingerEscrow.Status.Open));
    }

    function test_CreateValidation() public {
        vm.startPrank(alice);
        vm.expectRevert(FastFingerEscrow.BadMatchId.selector);
        esc.createMatch(bytes32(0), 0, 2);
        vm.expectRevert(FastFingerEscrow.BadTier.selector);
        esc.createMatch(ID, 6, 2);
        vm.expectRevert(FastFingerEscrow.BadPlayerCount.selector);
        esc.createMatch(ID, 0, 1);
        vm.expectRevert(FastFingerEscrow.BadPlayerCount.selector);
        esc.createMatch(ID, 0, 11);
        esc.createMatch(ID, 0, 2);
        vm.expectRevert(FastFingerEscrow.MatchExists.selector);
        esc.createMatch(ID, 0, 2);
        vm.stopPrank();
    }

    function test_FullTableLocksAndBlocksJoins() public {
        _create(alice, 0, 2);
        _join(bob);
        assertEq(uint8(_status()), uint8(FastFingerEscrow.Status.Locked));
        vm.prank(carol);
        vm.expectRevert(FastFingerEscrow.NotOpen.selector);
        esc.joinMatch(ID);
    }

    function test_NoDoubleJoin() public {
        _create(alice, 0, 4);
        vm.prank(alice);
        vm.expectRevert(FastFingerEscrow.AlreadyJoined.selector);
        esc.joinMatch(ID);
    }

    function test_HostStartsEarly() public {
        _create(alice, 0, 4);
        vm.prank(alice);
        vm.expectRevert(FastFingerEscrow.NotEnoughPlayers.selector);
        esc.startMatch(ID);
        _join(bob);
        vm.prank(bob);
        vm.expectRevert(FastFingerEscrow.NotHost.selector);
        esc.startMatch(ID);
        vm.prank(alice);
        esc.startMatch(ID);
        assertEq(uint8(_status()), uint8(FastFingerEscrow.Status.Locked));
    }

    // ─── cancel ───────────────────────────────────────────────────────────
    function test_CancelRefundsFullStake() public {
        uint256 before = rf.balanceOf(alice);
        _create(alice, 5, 4);
        vm.prank(alice);
        esc.cancelMatch(ID);
        assertEq(rf.balanceOf(alice), before);
        assertEq(uint8(_status()), uint8(FastFingerEscrow.Status.Cancelled));
    }

    function test_CannotCancelOnceSecondPlayerJoins() public {
        _create(alice, 0, 4);
        _join(bob);
        vm.prank(alice);
        vm.expectRevert(FastFingerEscrow.BadPlayerCount.selector);
        esc.cancelMatch(ID);
    }

    // ─── claim: default (rewards unset) - full rake burns ────────────────
    function test_ClaimNoFriend_FullRakeBurns() public {
        _create(alice, 2, 4); // Gold, 4 players -> pot 200
        _join(bob);
        _join(carol);
        _join(dave);
        _declare(bob);

        uint256 supplyBefore = rf.totalSupply();
        uint256 bobBefore = rf.balanceOf(bob);
        vm.prank(bob);
        esc.claimPrize(ID, 0);

        assertEq(rf.balanceOf(bob) - bobBefore, 180 ether); // 90% of 200
        assertEq(supplyBefore - rf.totalSupply(), 20 ether); // whole 10% rake burned
        assertEq(rf.balanceOf(address(esc)), 0);
        assertEq(uint8(_status()), uint8(FastFingerEscrow.Status.Paid));
    }

    function test_ClaimWithFriend_FullRakeBurns_92Percent() public {
        vm.prank(bob);
        uint256 friendId = gens.mint(6);
        _create(alice, 2, 2); // Gold, 2 players -> pot 100
        _join(bob);
        _declare(bob);

        uint256 supplyBefore = rf.totalSupply();
        uint256 bobBefore = rf.balanceOf(bob);
        vm.prank(bob);
        esc.claimPrize(ID, friendId);
        assertEq(rf.balanceOf(bob) - bobBefore, 92 ether);
        assertEq(supplyBefore - rf.totalSupply(), 8 ether); // whole 8% rake burned
    }

    // ─── claim: once a rewards receiver is configured - 50/50 rake split ──
    function test_ClaimNoFriend_WithRewardsConfigured_50_50() public {
        MockRewards rewards = new MockRewards();
        esc.setRewards(address(rewards));

        _create(alice, 2, 4); // pot 200, rake 20
        _join(bob);
        _join(carol);
        _join(dave);
        _declare(bob);

        uint256 supplyBefore = rf.totalSupply();
        vm.prank(bob);
        esc.claimPrize(ID, 0);

        assertEq(rf.balanceOf(address(rewards)), 10 ether);
        assertEq(supplyBefore - rf.totalSupply(), 10 ether);
        assertEq(rf.balanceOf(address(esc)), 0);
    }

    function test_SetRewardsRejectsEoa() public {
        vm.expectRevert(FastFingerEscrow.RewardsNotContract.selector);
        esc.setRewards(alice);
    }

    function test_SetRewardsBackToZeroResumesFullBurn() public {
        MockRewards rewards = new MockRewards();
        esc.setRewards(address(rewards));
        esc.setRewards(address(0));
        assertEq(esc.rewards(), address(0));

        _create(alice, 0, 2); // Bronze, pot 20, rake 2
        _join(bob);
        _declare(bob);
        uint256 supplyBefore = rf.totalSupply();
        vm.prank(bob);
        esc.claimPrize(ID, 0);
        assertEq(supplyBefore - rf.totalSupply(), 2 ether);
        assertEq(rf.balanceOf(address(rewards)), 0);
    }

    function test_SetRewardsOnlyOwner() public {
        MockRewards rewards = new MockRewards();
        vm.prank(alice);
        vm.expectRevert();
        esc.setRewards(address(rewards));
    }

    function test_TemporaryFriendRejected() public {
        vm.prank(bob);
        uint256 temp = gens.mint(0);
        _create(alice, 0, 2);
        _join(bob);
        _declare(bob);
        vm.prank(bob);
        vm.expectRevert(FastFingerEscrow.NotYourFriend.selector);
        esc.claimPrize(ID, temp);
    }

    function test_SomeoneElsesFriendRejected() public {
        vm.prank(carol);
        uint256 carols = gens.mint(1);
        _create(alice, 0, 2);
        _join(bob);
        _declare(bob);
        vm.prank(bob);
        vm.expectRevert(FastFingerEscrow.NotYourFriend.selector);
        esc.claimPrize(ID, carols);
        vm.prank(bob);
        vm.expectRevert(FastFingerEscrow.NotYourFriend.selector);
        esc.claimPrize(ID, 999); // nonexistent
    }

    function test_OnlyWinnerClaimsOnce() public {
        _create(alice, 0, 2);
        _join(bob);
        _declare(bob);
        vm.prank(alice);
        vm.expectRevert(FastFingerEscrow.NotWinner.selector);
        esc.claimPrize(ID, 0);
        vm.prank(bob);
        esc.claimPrize(ID, 0);
        vm.prank(bob);
        vm.expectRevert(FastFingerEscrow.NotDeclared.selector);
        esc.claimPrize(ID, 0);
    }

    function test_DeclareRules() public {
        _create(alice, 0, 3);
        _join(bob);
        vm.prank(oracle);
        vm.expectRevert(FastFingerEscrow.NotLocked.selector); // still open
        esc.declareWinner(ID, bob);

        vm.prank(alice);
        esc.startMatch(ID);

        vm.prank(alice);
        vm.expectRevert(FastFingerEscrow.NotOracle.selector);
        esc.declareWinner(ID, alice);

        vm.prank(oracle);
        vm.expectRevert(FastFingerEscrow.NotAPlayer.selector);
        esc.declareWinner(ID, carol);

        _declare(alice);
        vm.prank(oracle);
        vm.expectRevert(FastFingerEscrow.NotLocked.selector); // no re-declare
        esc.declareWinner(ID, bob);
    }

    // ─── claim window / sweep ───────────────────────────────────────────────
    function test_ClaimWindowAndSweep_FullBurnByDefault() public {
        _create(alice, 3, 2); // Platinum, pot 200
        _join(bob);
        _declare(bob);

        vm.expectRevert(FastFingerEscrow.ClaimWindowOpen.selector);
        esc.sweepUnclaimed(ID);

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(bob);
        vm.expectRevert(FastFingerEscrow.ClaimWindowClosed.selector);
        esc.claimPrize(ID, 0);

        uint256 supplyBefore = rf.totalSupply();
        vm.prank(dave); // anyone
        esc.sweepUnclaimed(ID);
        assertEq(supplyBefore - rf.totalSupply(), 200 ether); // whole pot burned
        assertEq(uint8(_status()), uint8(FastFingerEscrow.Status.Swept));
    }

    function test_SweepWithRewardsConfigured() public {
        MockRewards rewards = new MockRewards();
        esc.setRewards(address(rewards));
        _create(alice, 0, 2); // pot 20
        _join(bob);
        _declare(bob);
        vm.warp(block.timestamp + 7 days + 1);
        esc.sweepUnclaimed(ID);
        assertEq(rf.balanceOf(address(rewards)), 10 ether);
    }

    // ─── stale refunds ────────────────────────────────────────────────────
    function test_RefundStaleLocked() public {
        _create(alice, 1, 3);
        _join(bob);
        _join(carol);
        vm.expectRevert(FastFingerEscrow.NotStale.selector);
        esc.refundStale(ID);

        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(oracle);
        vm.expectRevert(FastFingerEscrow.SettleWindowClosed.selector);
        esc.declareWinner(ID, bob);

        esc.refundStale(ID);
        assertEq(rf.balanceOf(alice), 100_000 ether);
        assertEq(rf.balanceOf(bob), 100_000 ether);
        assertEq(rf.balanceOf(carol), 100_000 ether);
        assertEq(rf.balanceOf(address(esc)), 0);
    }

    function test_RefundStaleOpenMultiPlayer() public {
        _create(alice, 0, 4);
        _join(bob);
        vm.warp(block.timestamp + 3 days + 1);
        esc.refundStale(ID);
        assertEq(rf.balanceOf(bob), 100_000 ether);
    }

    function test_SoloOpenMatchNotStaleRefundable() public {
        _create(alice, 0, 4);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(FastFingerEscrow.NotStale.selector);
        esc.refundStale(ID); // host uses cancelMatch instead
    }

    // ─── burn fallback ────────────────────────────────────────────────────
    function test_NoBurnTokenGoesToDead() public {
        NoBurnRF nb = new NoBurnRF();
        FastFingerEscrow e2 = new FastFingerEscrow(address(nb), address(gens), oracle);
        nb.mint(alice, 100 ether);
        nb.mint(bob, 100 ether);
        vm.prank(alice);
        nb.approve(address(e2), type(uint256).max);
        vm.prank(bob);
        nb.approve(address(e2), type(uint256).max);
        vm.prank(alice);
        e2.createMatch(ID, 0, 2);
        vm.prank(bob);
        e2.joinMatch(ID);
        vm.prank(oracle);
        e2.declareWinner(ID, alice);
        vm.prank(alice);
        e2.claimPrize(ID, 0);
        assertEq(nb.balanceOf(DEAD), 2 ether); // whole 10% rake, no rewards configured
        assertEq(nb.balanceOf(alice), 90 ether + 18 ether);
    }

    // ─── owner ────────────────────────────────────────────────────────────
    function test_SetOracleOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        esc.setOracle(alice);
        esc.setOracle(carol);
        assertEq(esc.oracle(), carol);
    }

    // ─── fuzz ─────────────────────────────────────────────────────────────
    function testFuzz_SplitConserves(uint128 pot, bool friend) public view {
        (uint256 payout, uint256 rake) = esc.split(pot, friend);
        assertEq(payout + rake, pot);
    }

    function testFuzz_FullMatchConserves_DefaultBurn(uint8 tier, uint8 players, uint8 winnerIdx, bool friend)
        public
    {
        tier = uint8(bound(tier, 0, 5));
        players = uint8(bound(players, 2, 10));
        winnerIdx = uint8(bound(winnerIdx, 0, players - 1));
        address[] memory ps = new address[](players);
        for (uint256 i; i < players; ++i) {
            ps[i] = address(uint160(0x1000 + i));
            rf.mint(ps[i], 1000 ether);
            vm.prank(ps[i]);
            rf.approve(address(esc), type(uint256).max);
        }
        vm.prank(ps[0]);
        esc.createMatch(ID, tier, players);
        for (uint256 i = 1; i < players; ++i) {
            vm.prank(ps[i]);
            esc.joinMatch(ID);
        }
        address w = ps[winnerIdx];
        uint256 fid;
        if (friend) {
            vm.prank(w);
            fid = gens.mint(3);
        }
        _declare(w);
        uint256 supplyBefore = rf.totalSupply();
        vm.prank(w);
        esc.claimPrize(ID, fid);
        _checkPaid(w, tier, players, friend, supplyBefore);
    }

    function _checkPaid(address w, uint8 tier, uint8 players, bool friend, uint256 supplyBefore) internal view {
        uint256 entry = esc.tierEntry(tier);
        (uint256 payout, uint256 rake) = esc.split(entry * players, friend);
        assertEq(rf.balanceOf(w), 1000 ether - entry + payout);
        assertEq(supplyBefore - rf.totalSupply(), rake); // full rake burned, rewards unset
        assertEq(rf.balanceOf(address(esc)), 0);
    }
}

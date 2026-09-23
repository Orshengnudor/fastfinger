// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { FastFingerEscrow } from "../src/FastFingerEscrow.sol";

/// @notice Owner-only: point future rake at a real Rare Friends reward
/// receiver once one exists, or pass address(0) to go back to full-burn.
/// Env: DEPLOYER_KEY (must be the contract owner), ESCROW, NEW_REWARDS.
contract SetRewards is Script {
    function run() external {
        require(block.chainid == 4663, "Robinhood Chain mainnet only");
        uint256 key        = vm.envUint("DEPLOYER_KEY");
        address escrow     = vm.envAddress("ESCROW");
        address newRewards = vm.envAddress("NEW_REWARDS");

        vm.startBroadcast(key);
        FastFingerEscrow(escrow).setRewards(newRewards);
        vm.stopBroadcast();

        console2.log("Rewards set to:", newRewards);
    }
}

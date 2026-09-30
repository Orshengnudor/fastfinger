// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {FastFingerFaucet} from "../src/FastFingerFaucet.sol";

/// @dev Robinhood Chain mainnet only. Run with:
///   forge script script/DeployFaucet.s.sol:DeployFaucet \
///     --rpc-url $ROBINHOOD_RPC --broadcast -vvvv
/// Requires PRIVATE_KEY (the deploying/owner wallet) in the environment.
/// 20 RF per claim, 100 claims max, matching what was asked for exactly.
contract DeployFaucet is Script {
    address constant RF = 0x0779369854d3EcdEA927206718FFD7730C67B71f;
    uint256 constant CLAIM_AMOUNT = 20 ether;
    uint256 constant MAX_CLAIMS = 100;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        FastFingerFaucet faucet = new FastFingerFaucet(RF, deployer, CLAIM_AMOUNT, MAX_CLAIMS);
        vm.stopBroadcast();

        console.log("FastFingerFaucet deployed at:", address(faucet));
        console.log("Owner:", faucet.owner());
        console.log("Claim amount (wei):", CLAIM_AMOUNT);
        console.log("Max claims:", MAX_CLAIMS);
    }
}

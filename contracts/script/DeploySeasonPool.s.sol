// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {FastFingerSeasonPool} from "../src/FastFingerSeasonPool.sol";

/// @dev Robinhood Chain mainnet only, matching the existing deploy scripts,
/// no testnet path. Run with:
///   forge script script/DeploySeasonPool.s.sol:DeploySeasonPool \
///     --rpc-url $ROBINHOOD_RPC --broadcast --verify \
///     --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/ -vvvv
/// Requires PRIVATE_KEY (the deploying/owner wallet) in the environment.
contract DeploySeasonPool is Script {
    address constant RF = 0x0779369854d3EcdEA927206718FFD7730C67B71f;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        FastFingerSeasonPool pool = new FastFingerSeasonPool(RF, deployer);
        vm.stopBroadcast();

        console.log("FastFingerSeasonPool deployed at:", address(pool));
        console.log("Owner:", pool.owner());
        console.log("RF token:", address(pool.RF()));
    }
}

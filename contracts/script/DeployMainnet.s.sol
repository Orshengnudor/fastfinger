// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { FastFingerEscrow } from "../src/FastFingerEscrow.sol";

/// @notice Robinhood Chain mainnet (4663) only.
/// Env: DEPLOYER_KEY, ORACLE_ADDRESS.
///
/// Run once WITHOUT --broadcast first — forge simulates the deploy against a
/// live fork of --rpc-url and will show you if anything would revert, at zero
/// cost. Only add --broadcast once that simulation looks right.
contract DeployMainnet is Script {
    // Real, confirmed Rare Friends mainnet contracts — see
    // https://rarefriends.com/docs/contracts. Hardcoded here (not read from
    // env) so a deploy can't accidentally point at the wrong token.
    address constant RF          = 0x0779369854d3EcdEA927206718FFD7730C67B71f;
    address constant GENERATIONS = 0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D;

    function run() external {
        require(block.chainid == 4663, "Robinhood Chain mainnet only");
        uint256 key    = vm.envUint("DEPLOYER_KEY");
        address oracle = vm.envAddress("ORACLE_ADDRESS");

        vm.startBroadcast(key);
        FastFingerEscrow esc = new FastFingerEscrow(RF, GENERATIONS, oracle);
        vm.stopBroadcast();

        console2.log("VITE_ESCROW_CONTRACT =", address(esc));
        console2.log("Oracle               =", oracle);
        console2.log("Rewards (unset -> full rake burns until you call setRewards)");
    }
}

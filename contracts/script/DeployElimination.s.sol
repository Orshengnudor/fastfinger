// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { FastFingerEliminationEscrow } from "../src/FastFingerEliminationEscrow.sol";

/// @notice Robinhood Chain mainnet (4663) only. A separate deployment from
/// FastFingerEscrow - that one is untouched by this. Env: DEPLOYER_KEY,
/// ORACLE_ADDRESS (reuse the same oracle wallet as the standard contract  - 
/// it's already funded with gas and already trusted by your backend).
contract DeployElimination is Script {
    address constant RF = 0x0779369854d3EcdEA927206718FFD7730C67B71f;

    function run() external {
        require(block.chainid == 4663, "Robinhood Chain mainnet only");
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address oracle = vm.envAddress("ORACLE_ADDRESS");

        vm.startBroadcast(key);
        FastFingerEliminationEscrow esc = new FastFingerEliminationEscrow(RF, oracle);
        vm.stopBroadcast();

        console2.log("VITE_ELIMINATION_ESCROW =", address(esc));
        console2.log("Oracle                  =", oracle);
    }
}

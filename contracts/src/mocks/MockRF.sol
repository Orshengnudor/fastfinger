// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice Testnet-only stand-in for $RAREFRIENDS. Anyone can mint 10,000 per call.
contract MockRF is ERC20, ERC20Burnable {
    uint256 public constant FAUCET_AMOUNT = 10_000 ether;

    constructor() ERC20("Test RAREFRIENDS", "tRF") { }

    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal standard ERC20 for tests only, standing in for the real
/// $RAREFRIENDS token so the pool's own logic can be tested in isolation.
contract MockRF is ERC20 {
    constructor() ERC20("Mock RareFriends", "mRF") {
        _mint(msg.sender, 1_000_000_000 ether);
    }
}

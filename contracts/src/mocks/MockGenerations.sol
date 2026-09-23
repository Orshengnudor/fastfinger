// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Testnet-only stand-in for Rare Friends Generations (ownerOf + generation).
/// generation 0 = temporary Friend, 1..6 = hardwired.
contract MockGenerations {
    mapping(uint256 => address) private _owners;
    mapping(uint256 => uint8) public generation;
    uint256 public nextId = 1;

    error NonexistentToken();

    /// @notice Mint yourself a Friend at the given generation (0..6).
    function mint(uint8 gen) external returns (uint256 id) {
        id = nextId++;
        _owners[id] = msg.sender;
        generation[id] = gen;
    }

    function transfer(address to, uint256 id) external {
        require(_owners[id] == msg.sender, "not owner");
        _owners[id] = to;
    }

    function ownerOf(uint256 id) external view returns (address owner) {
        owner = _owners[id];
        if (owner == address(0)) revert NonexistentToken();
    }
}

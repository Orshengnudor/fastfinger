// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FastFingerFaucet
/// @notice A one-time onboarding claim: the first `maxClaims` unique wallets
/// each receive a fixed amount of RF, once, so new players have enough to
/// actually try the game. Funded the same way as FastFingerSeasonPool, a
/// plain ERC20 transfer works with no special interface required, or the
/// explicit fund() below.
/// @dev The hard limit is the wallet count (maxClaims), set once at deploy
/// time. There is deliberately no hardcoded time deadline, claimOpen lets
/// the owner pause or close the promotion at any moment instead, since a
/// wrong guessed deadline is harder to undo than a toggle.
contract FastFingerFaucet is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable RF;
    uint256 public immutable claimAmount;
    uint256 public immutable maxClaims;

    uint256 public claimedCount;
    mapping(address => bool) public hasClaimed;

    bool public claimOpen = true;

    event Claimed(address indexed claimant, uint256 amount, uint256 claimNumber);
    event Funded(address indexed from, uint256 amount);
    event ClaimOpenSet(bool open);
    event Swept(address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error ClaimClosed();
    error AlreadyClaimed();
    error ClaimLimitReached();
    error InsufficientBalance(uint256 requested, uint256 available);

    constructor(address rfToken, address initialOwner, uint256 claimAmount_, uint256 maxClaims_)
        Ownable(initialOwner)
    {
        if (rfToken == address(0) || initialOwner == address(0)) revert ZeroAddress();
        if (claimAmount_ == 0 || maxClaims_ == 0) revert ZeroAmount();
        RF = IERC20(rfToken);
        claimAmount = claimAmount_;
        maxClaims = maxClaims_;
    }

    /// @notice Current pool balance.
    function balance() external view returns (uint256) {
        return RF.balanceOf(address(this));
    }

    /// @notice Spots left in the first-`maxClaims`-wallets promotion.
    function remaining() external view returns (uint256) {
        return maxClaims - claimedCount;
    }

    /// @notice Claim the fixed amount, once per wallet, while spots remain
    /// and the owner hasn't closed the window.
    function claim() external nonReentrant {
        if (!claimOpen) revert ClaimClosed();
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();
        if (claimedCount >= maxClaims) revert ClaimLimitReached();

        uint256 bal = RF.balanceOf(address(this));
        if (claimAmount > bal) revert InsufficientBalance(claimAmount, bal);

        hasClaimed[msg.sender] = true;
        claimedCount += 1;
        RF.safeTransfer(msg.sender, claimAmount);
        emit Claimed(msg.sender, claimAmount, claimedCount);
    }

    /// @notice Voluntarily add RF. Open to anyone, same reasoning as
    /// FastFingerSeasonPool's fund(): a function that only ever adds funds
    /// cannot be misused by being open.
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        RF.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /// @notice Pause or resume claiming without touching the wallet cap.
    function setClaimOpen(bool open) external onlyOwner {
        claimOpen = open;
        emit ClaimOpenSet(open);
    }

    /// @notice Safety valve, same as FastFingerSeasonPool's sweep().
    function sweep(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = RF.balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();
        RF.safeTransfer(to, bal);
        emit Swept(to, bal);
    }
}

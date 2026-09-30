// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FastFingerSeasonPool
/// @notice Accumulates FastFinger's rewards share of the rake automatically
/// as matches are played, and lets the owner pay it out to season-pool
/// winners exactly as today's manual process already works: top wallets by
/// cumulative in-game score, ranked off-chain, paid out here.
/// @dev Deploy this once, then call the owner-only setRewards(address) on
/// both FastFingerEscrow and FastFingerEliminationEscrow, pointing at this
/// contract's address. Receiving RF here needs nothing special: it is a
/// plain ERC20 transfer, and any deployed contract can receive one without
/// implementing a callback. The escrow's own RewardsNotContract check only
/// requires this address to have code, which it does the moment it is
/// deployed. This assumption (a plain transfer, no interface required) is
/// based on the escrow's documented behavior, not a direct read of its
/// source; confirm with one small real transfer before relying on it for
/// a full season's rake.
contract FastFingerSeasonPool is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The $RAREFRIENDS token this pool holds and pays out.
    IERC20 public immutable RF;

    /// @notice Total RF ever paid out through this contract, kept as a
    /// simple running total so the lifetime activity is readable in one
    /// view call rather than reconstructed from events.
    uint256 public totalPaidOut;

    /// @notice 0 means no season has ever been started, "waiting to start".
    /// The pool can still hold and accumulate a balance in that state, from
    /// rake or a direct fund(), a season is a separate concept from the
    /// balance itself.
    uint256 public seasonId;
    /// @notice When the current season began. Meaningless while seasonId is 0.
    uint256 public seasonStartedAt;
    /// @notice 0 while the current season is still active. Set by endSeason.
    uint256 public seasonEndedAt;

    event Payout(address indexed winner, uint256 amount, string note);
    event Swept(address indexed to, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event SeasonStarted(uint256 indexed seasonId, uint256 startedAt);
    event SeasonEnded(uint256 indexed seasonId, uint256 endedAt);

    error ZeroAddress();
    error ZeroAmount();
    error LengthMismatch();
    error InsufficientBalance(uint256 requested, uint256 available);
    error SeasonAlreadyActive();
    error NoActiveSeason();

    constructor(address rfToken, address initialOwner) Ownable(initialOwner) {
        if (rfToken == address(0) || initialOwner == address(0)) revert ZeroAddress();
        RF = IERC20(rfToken);
    }

    /// @notice Current pool balance. The app's "live pool balance" display
    /// should read this directly instead of a manually tracked number.
    /// This is unaffected by season state: the pool can accumulate rake or
    /// a direct fund() at any time, whether or not a season is active.
    function balance() external view returns (uint256) {
        return RF.balanceOf(address(this));
    }

    /// @notice True once a season has been started and not yet ended. The
    /// dashboard's "waiting to start" state is simply the inverse of this
    /// when seasonId is still 0.
    function seasonActive() external view returns (bool) {
        return seasonId != 0 && seasonEndedAt == 0;
    }

    /// @notice Begin a new season. Owner only. Increments seasonId, so the
    /// very first call moves the pool from "waiting to start" (seasonId 0)
    /// to season 1. Cannot be called again while a season is already active,
    /// call endSeason first.
    function startSeason() external onlyOwner {
        if (seasonId != 0 && seasonEndedAt == 0) revert SeasonAlreadyActive();
        seasonId += 1;
        seasonStartedAt = block.timestamp;
        seasonEndedAt = 0;
        emit SeasonStarted(seasonId, block.timestamp);
    }

    /// @notice Close out the current season, e.g. right before ranking and
    /// paying the top wallets for that period. Owner only. Does not touch
    /// the balance or pay anyone; payout/payoutBatch are separate calls.
    function endSeason() external onlyOwner {
        if (seasonId == 0 || seasonEndedAt != 0) revert NoActiveSeason();
        seasonEndedAt = block.timestamp;
        emit SeasonEnded(seasonId, block.timestamp);
    }

    /// @notice Voluntarily add RF to the pool from your own wallet, on top
    /// of whatever the escrows send automatically. Open to anyone, not just
    /// the owner, there is no way to misuse a function that only ever adds
    /// funds. Requires approving this contract for at least `amount` first.
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        RF.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /// @notice Pay one season-pool winner. Owner only, matching how the
    /// season pool is paid out today, just funded automatically instead of
    /// manually. `note` is a short free-text tag (e.g. "2026-W40 1st") kept
    /// on-chain purely for a readable history on Blockscout; it has no
    /// effect on the transfer itself.
    function payout(address winner, uint256 amount, string calldata note)
        external
        onlyOwner
        nonReentrant
    {
        if (winner == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 bal = RF.balanceOf(address(this));
        if (amount > bal) revert InsufficientBalance(amount, bal);
        RF.safeTransfer(winner, amount);
        totalPaidOut += amount;
        emit Payout(winner, amount, note);
    }

    /// @notice Pay several season-pool winners in one transaction, e.g. a
    /// full top-5 at the end of a period. Arrays must be the same length.
    /// If the combined total would exceed the pool's balance the whole
    /// batch reverts, so either everyone in the batch gets paid or no one
    /// does, never a partial payout.
    function payoutBatch(
        address[] calldata winners,
        uint256[] calldata amounts,
        string calldata note
    ) external onlyOwner nonReentrant {
        uint256 len = winners.length;
        if (len == 0 || len != amounts.length) revert LengthMismatch();

        uint256 total;
        for (uint256 i = 0; i < len; i++) {
            if (winners[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            total += amounts[i];
        }
        uint256 bal = RF.balanceOf(address(this));
        if (total > bal) revert InsufficientBalance(total, bal);

        for (uint256 i = 0; i < len; i++) {
            RF.safeTransfer(winners[i], amounts[i]);
            emit Payout(winners[i], amounts[i], note);
        }
        totalPaidOut += total;
    }

    /// @notice Safety valve only, not part of the normal flow: lets the
    /// owner move the whole balance to a specified address if this
    /// contract ever needs to be retired or migrated. Emits its own
    /// distinct event so it can never be mistaken for a normal payout in
    /// the on-chain history.
    function sweep(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = RF.balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();
        RF.safeTransfer(to, bal);
        emit Swept(to, bal);
    }
}

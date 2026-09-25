// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IBurnable {
    function burn(uint256 amount) external;
}

/// @title FastFinger elimination escrow — $RAREFRIENDS stakes on Robinhood Chain
/// @notice A separate contract from the standard FastFingerEscrow, deliberately —
/// that one stays untouched and live. This one is for 5+ player tables only,
/// where one round narrows the field to a final 2, and the pot pays three
/// places instead of one: 60% / 25% / 15% of a flat 90%-of-pot distributable.
/// @dev No Friend bonus in this version. The standard contract's bonus lets
/// the winner reveal their own Friend at their own claim time, independent of
/// anyone else's claim — safe because there's only ever one claimant. Here
/// there are three independent claimants sharing one pot-wide rake decision;
/// making the rake depend on whichever of them happens to claim first (or
/// requiring a specific claim order) is exactly the kind of subtle rule that
/// belongs in its own careful pass, not bundled into this one. Ship the flat
/// rate now, add the bonus properly once its ordering is worked out on its own.
contract FastFingerEliminationEscrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Chain ──────────────────────────────────────────────────────────────
    uint256 public constant CHAIN_ID = 4663; // Robinhood Chain mainnet, only.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ─── Economics ──────────────────────────────────────────────────────────
    uint256 public constant BPS = 10_000;
    /// @dev Flat rate for every match — see contract-level note on why there's
    /// no Friend-bonus rate here yet.
    uint256 public constant DISTRIBUTABLE_BPS = 9000;

    /// @dev Shares of the distributable pot (not the raw pot).
    uint256 public constant FIRST_BPS = 6000;
    uint256 public constant SECOND_BPS = 2500;
    uint256 public constant THIRD_BPS = 1500;

    // ─── Match rules ────────────────────────────────────────────────────────
    /// @dev Elimination mode needs a real field to narrow down — below this,
    /// use the standard FastFingerEscrow instead.
    uint8 public constant MIN_PLAYERS = 5;
    uint8 public constant MAX_PLAYERS = 10;
    uint8 public constant TIER_COUNT = 6;
    uint256 public constant CLAIM_WINDOW = 7 days;
    uint256 public constant SETTLE_WINDOW = 3 days;

    IERC20 public immutable rf;
    uint256 private immutable _unit;

    address public oracle;

    /// @notice Same reasoning as the standard contract: no verified external
    /// integration exists yet for handing RF to a real Rare Friends reward
    /// receiver, so the rake burns entirely until the owner points this at a
    /// real one via `setRewards`.
    address public rewards;

    enum Status {
        None,
        Open,
        Locked,
        Declared,
        Cancelled,
        Refunded,
        Swept
    }

    struct Match {
        address host;
        uint8 tier;
        uint8 maxPlayers;
        uint8 playerCount;
        Status status;
        uint40 createdAt;
        uint40 lockedAt;
        uint40 declaredAt;
        address first;
        address second;
        address third;
        uint256 firstAmount;
        uint256 secondAmount;
        uint256 thirdAmount;
        uint256 entry;
    }

    mapping(bytes32 => Match) private _matches;
    mapping(bytes32 => address[]) private _players;
    mapping(bytes32 => mapping(address => bool)) public isPlayer;
    mapping(bytes32 => mapping(address => bool)) public claimed;

    // ─── Events ─────────────────────────────────────────────────────────────
    event MatchCreated(bytes32 indexed matchId, address indexed host, uint8 tier, uint256 entry, uint8 maxPlayers);
    event PlayerJoined(bytes32 indexed matchId, address indexed player, uint8 playerCount);
    event MatchLocked(bytes32 indexed matchId, uint8 playerCount);
    event MatchCancelled(bytes32 indexed matchId, address indexed host, uint256 refund);
    event ResultsDeclared(
        bytes32 indexed matchId,
        address first,
        address second,
        address third,
        uint256 firstAmount,
        uint256 secondAmount,
        uint256 thirdAmount
    );
    event PrizeClaimed(bytes32 indexed matchId, address indexed claimant, uint8 place, uint256 payout);
    event UnclaimedSwept(bytes32 indexed matchId, address indexed forfeitedBy, uint256 burned, uint256 rewarded);
    event MatchRefunded(bytes32 indexed matchId, uint8 playerCount, uint256 each);
    event Burned(uint256 amount, bool viaBurnFunction);
    event OracleSet(address indexed oracle);
    event RewardsSet(address indexed rewards);

    // ─── Errors ─────────────────────────────────────────────────────────────
    error WrongChain();
    error ZeroAddress();
    error RewardsNotContract();
    error BadMatchId();
    error MatchExists();
    error BadTier();
    error BadPlayerCount();
    error NotOpen();
    error AlreadyJoined();
    error NotHost();
    error NotOracle();
    error NotLocked();
    error NotAPlayer();
    error DuplicatePlacement();
    error NotEnoughPlayers();
    error SettleWindowClosed();
    error NotStale();
    error NotDeclared();
    error NotAPlacer();
    error AlreadyClaimed();
    error ClaimWindowClosed();
    error ClaimWindowOpen();
    error BurnMismatch();

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    constructor(address rf_, address oracle_) Ownable(msg.sender) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (rf_ == address(0) || oracle_ == address(0)) revert ZeroAddress();
        rf = IERC20(rf_);
        oracle = oracle_;
        _unit = 10 ** IERC20Metadata(rf_).decimals();
        emit OracleSet(oracle_);
    }

    // ─── Player actions ─────────────────────────────────────────────────────

    function createMatch(bytes32 matchId, uint8 tier, uint8 maxPlayers) external nonReentrant {
        if (matchId == bytes32(0)) revert BadMatchId();
        if (_matches[matchId].status != Status.None) revert MatchExists();
        if (tier >= TIER_COUNT) revert BadTier();
        if (maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) revert BadPlayerCount();

        uint256 entry = tierEntry(tier);
        _matches[matchId] = Match({
            host: msg.sender,
            tier: tier,
            maxPlayers: maxPlayers,
            playerCount: 1,
            status: Status.Open,
            createdAt: uint40(block.timestamp),
            lockedAt: 0,
            declaredAt: 0,
            first: address(0),
            second: address(0),
            third: address(0),
            firstAmount: 0,
            secondAmount: 0,
            thirdAmount: 0,
            entry: entry
        });
        _players[matchId].push(msg.sender);
        isPlayer[matchId][msg.sender] = true;

        rf.safeTransferFrom(msg.sender, address(this), entry);
        emit MatchCreated(matchId, msg.sender, tier, entry, maxPlayers);
    }

    function joinMatch(bytes32 matchId) external nonReentrant {
        Match storage m = _matches[matchId];
        if (m.status != Status.Open) revert NotOpen();
        if (isPlayer[matchId][msg.sender]) revert AlreadyJoined();

        _players[matchId].push(msg.sender);
        isPlayer[matchId][msg.sender] = true;
        uint8 count = ++m.playerCount;

        rf.safeTransferFrom(msg.sender, address(this), m.entry);
        emit PlayerJoined(matchId, msg.sender, count);

        if (count == m.maxPlayers) _lock(matchId, m);
    }

    function startMatch(bytes32 matchId) external {
        Match storage m = _matches[matchId];
        if (msg.sender != m.host) revert NotHost();
        if (m.status != Status.Open) revert NotOpen();
        if (m.playerCount < MIN_PLAYERS) revert NotEnoughPlayers();
        _lock(matchId, m);
    }

    function cancelMatch(bytes32 matchId) external nonReentrant {
        Match storage m = _matches[matchId];
        if (msg.sender != m.host) revert NotHost();
        if (m.status != Status.Open) revert NotOpen();
        if (m.playerCount != 1) revert BadPlayerCount();

        m.status = Status.Cancelled;
        rf.safeTransfer(m.host, m.entry);
        emit MatchCancelled(matchId, m.host, m.entry);
    }

    /// @notice Claim your share. 1st, 2nd and 3rd can each claim independently,
    /// in any order — the split was already fixed for all three back in
    /// `declareResults`.
    function claimPrize(bytes32 matchId) external nonReentrant {
        Match storage m = _matches[matchId];
        if (m.status != Status.Declared) revert NotDeclared();
        if (block.timestamp > uint256(m.declaredAt) + CLAIM_WINDOW) revert ClaimWindowClosed();
        if (claimed[matchId][msg.sender]) revert AlreadyClaimed();

        uint8 place;
        uint256 amount;
        if (msg.sender == m.first) {
            place = 1;
            amount = m.firstAmount;
        } else if (msg.sender == m.second) {
            place = 2;
            amount = m.secondAmount;
        } else if (msg.sender == m.third) {
            place = 3;
            amount = m.thirdAmount;
        } else {
            revert NotAPlacer();
        }

        claimed[matchId][msg.sender] = true;
        rf.safeTransfer(msg.sender, amount);
        emit PrizeClaimed(matchId, msg.sender, place, amount);
    }

    // ─── Oracle ─────────────────────────────────────────────────────────────

    /// @notice Record the final 1st/2nd/3rd for a locked match and fix all
    /// three payout amounts at once, at the flat rate. All three must be
    /// distinct players in the match.
    function declareResults(bytes32 matchId, address first, address second, address third) external onlyOracle {
        Match storage m = _matches[matchId];
        if (m.status != Status.Locked) revert NotLocked();
        if (!isPlayer[matchId][first] || !isPlayer[matchId][second] || !isPlayer[matchId][third]) {
            revert NotAPlayer();
        }
        if (first == second || first == third || second == third) revert DuplicatePlacement();
        if (block.timestamp > uint256(m.lockedAt) + SETTLE_WINDOW) revert SettleWindowClosed();

        uint256 pot = _potOf(m);
        uint256 distributable = (pot * DISTRIBUTABLE_BPS) / BPS;
        uint256 rake = pot - distributable;

        m.status = Status.Declared;
        m.declaredAt = uint40(block.timestamp);
        m.first = first;
        m.second = second;
        m.third = third;
        m.firstAmount = (distributable * FIRST_BPS) / BPS;
        m.secondAmount = (distributable * SECOND_BPS) / BPS;
        m.thirdAmount = distributable - m.firstAmount - m.secondAmount; // remainder to 3rd, no dust left behind

        _distributeRake(rake);
        emit ResultsDeclared(matchId, first, second, third, m.firstAmount, m.secondAmount, m.thirdAmount);
    }

    // ─── Permissionless safety valves ───────────────────────────────────────

    /// @notice After 7 days, any of the three shares still unclaimed is swept
    /// (burned, or split with `rewards` once set) — one call handles whichever
    /// of the three are still outstanding.
    function sweepUnclaimed(bytes32 matchId) external nonReentrant {
        Match storage m = _matches[matchId];
        if (m.status != Status.Declared) revert NotDeclared();
        if (block.timestamp <= uint256(m.declaredAt) + CLAIM_WINDOW) revert ClaimWindowOpen();

        _sweepOne(matchId, m.first, m.firstAmount);
        _sweepOne(matchId, m.second, m.secondAmount);
        _sweepOne(matchId, m.third, m.thirdAmount);
        m.status = Status.Swept;
    }

    function refundStale(bytes32 matchId) external nonReentrant {
        Match storage m = _matches[matchId];
        uint256 since;
        if (m.status == Status.Locked) {
            since = m.lockedAt;
        } else if (m.status == Status.Open && m.playerCount >= MIN_PLAYERS) {
            since = m.createdAt;
        } else {
            revert NotStale();
        }
        if (block.timestamp <= since + SETTLE_WINDOW) revert NotStale();

        m.status = Status.Refunded;
        address[] storage list = _players[matchId];
        uint256 len = list.length;
        for (uint256 i; i < len; ++i) {
            rf.safeTransfer(list[i], m.entry);
        }
        emit MatchRefunded(matchId, uint8(len), m.entry);
    }

    // ─── Owner ──────────────────────────────────────────────────────────────

    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleSet(oracle_);
    }

    function setRewards(address rewards_) external onlyOwner {
        if (rewards_ != address(0) && rewards_.code.length == 0) revert RewardsNotContract();
        rewards = rewards_;
        emit RewardsSet(rewards_);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function tierEntry(uint8 tier) public view returns (uint256) {
        if (tier == 0) return 10 * _unit;
        if (tier == 1) return 25 * _unit;
        if (tier == 2) return 50 * _unit;
        if (tier == 3) return 100 * _unit;
        if (tier == 4) return 250 * _unit;
        if (tier == 5) return 1000 * _unit;
        revert BadTier();
    }

    function getMatch(bytes32 matchId) external view returns (Match memory) {
        return _matches[matchId];
    }

    function getPlayers(bytes32 matchId) external view returns (address[] memory) {
        return _players[matchId];
    }

    function _potOf(Match storage m) internal view returns (uint256) {
        return m.entry * m.playerCount;
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _lock(bytes32 matchId, Match storage m) private {
        m.status = Status.Locked;
        m.lockedAt = uint40(block.timestamp);
        emit MatchLocked(matchId, m.playerCount);
    }

    /// @dev address(0) rewards -> burn all of it. Otherwise 50/50, same as the
    /// standard contract's rake split.
    function _distributeRake(uint256 rake) private {
        if (rake == 0) return;
        address r = rewards;
        if (r == address(0)) {
            _burn(rake);
            return;
        }
        uint256 rewardAmt = rake / 2;
        uint256 burnAmt = rake - rewardAmt;
        _burn(burnAmt);
        rf.safeTransfer(r, rewardAmt);
    }

    function _sweepOne(bytes32 matchId, address placer, uint256 amount) private {
        if (placer == address(0) || amount == 0 || claimed[matchId][placer]) return;
        claimed[matchId][placer] = true;
        address r = rewards;
        if (r == address(0)) {
            _burn(amount);
            emit UnclaimedSwept(matchId, placer, amount, 0);
            return;
        }
        uint256 rewardAmt = amount / 2;
        uint256 burnAmt = amount - rewardAmt;
        _burn(burnAmt);
        rf.safeTransfer(r, rewardAmt);
        emit UnclaimedSwept(matchId, placer, burnAmt, rewardAmt);
    }

    function _burn(uint256 amount) private {
        if (amount == 0) return;
        uint256 before = rf.balanceOf(address(this));
        try IBurnable(address(rf)).burn(amount) {
            uint256 burned = before - rf.balanceOf(address(this));
            if (burned == amount) {
                emit Burned(amount, true);
                return;
            }
            if (burned != 0) revert BurnMismatch();
        } catch { }
        rf.safeTransfer(DEAD, amount);
        emit Burned(amount, false);
    }
}

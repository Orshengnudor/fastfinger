// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @dev Rare Friends Generations. generation() is 0 for a temporary Friend, 1..6 once hardwired.
interface IGenerations {
    function ownerOf(uint256 friendId) external view returns (address);
    function generation(uint256 friendId) external view returns (uint8);
}

interface IBurnable {
    function burn(uint256 amount) external;
}

/// @title FastFinger escrow - $RAREFRIENDS stakes on Robinhood Chain
/// @notice Players stake RF, the oracle names the winner, the winner claims.
/// Rake is 10% (8% with a hardwired Generations Friend). Until `rewards` is
/// configured, the whole rake is burned - see the note on `rewards` below for
/// why that's the launch default rather than a guessed address.
contract FastFingerEscrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Chain ──────────────────────────────────────────────────────────────
    uint256 public constant CHAIN_ID = 4663; // Robinhood Chain mainnet, only.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ─── Economics ──────────────────────────────────────────────────────────
    uint256 public constant BPS = 10_000;
    uint256 public constant WINNER_BPS = 9000;
    uint256 public constant FRIEND_WINNER_BPS = 9200;
    /// @dev Generation 1 is the highest. 6 = any hardwired Friend qualifies.
    uint8 public constant FRIEND_MAX_GENERATION = 6;

    // ─── Match rules ────────────────────────────────────────────────────────
    uint8 public constant MIN_PLAYERS = 2;
    uint8 public constant MAX_PLAYERS = 10;
    uint8 public constant TIER_COUNT = 6;
    uint256 public constant CLAIM_WINDOW = 7 days;
    /// @dev If no winner is declared this long after a match locks (or after an
    /// Open multi-player match was created), every player can be refunded.
    uint256 public constant SETTLE_WINDOW = 3 days;

    IERC20 public immutable rf;
    IGenerations public immutable generations;
    uint256 private immutable _unit;

    address public oracle;

    /// @notice Where the non-burned half of the rake goes once set. Starts at
    /// address(0): Rare Friends' published contracts (Genesis, Generations,
    /// RF, ActivationManager, Hook, Market, Reserve, CCA) have no documented
    /// entry point for an outside contract to hand over RF and have it
    /// correctly credited as reward-stream funding - that stream is driven by
    /// users' own Activate/Hardwire/Promote/Upgrade calls, not plain
    /// transfers. Sending rake there on a guess risks it being stuck rather
    /// than distributed. So at launch the entire rake burns instead (still
    /// deflationary, still favours every RF holder) and the owner can point
    /// `rewards` at a real receiver later via `setRewards`, once one exists,
    /// without redeploying - this address is intentionally NOT immutable.
    address public rewards;

    enum Status {
        None,
        Open,
        Locked,
        Declared,
        Paid,
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
        address winner;
        uint256 entry;
    }

    mapping(bytes32 => Match) private _matches;
    mapping(bytes32 => address[]) private _players;
    mapping(bytes32 => mapping(address => bool)) public isPlayer;

    // ─── Events ─────────────────────────────────────────────────────────────
    event MatchCreated(bytes32 indexed matchId, address indexed host, uint8 tier, uint256 entry, uint8 maxPlayers);
    event PlayerJoined(bytes32 indexed matchId, address indexed player, uint8 playerCount);
    event MatchLocked(bytes32 indexed matchId, uint8 playerCount);
    event MatchCancelled(bytes32 indexed matchId, address indexed host, uint256 refund);
    event WinnerDeclared(bytes32 indexed matchId, address indexed winner, uint256 pot);
    event PrizeClaimed(
        bytes32 indexed matchId,
        address indexed winner,
        uint256 payout,
        uint256 burned,
        uint256 rewarded,
        uint256 friendId
    );
    event UnclaimedSwept(bytes32 indexed matchId, uint256 burned, uint256 rewarded);
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
    error NotEnoughPlayers();
    error SettleWindowClosed();
    error NotStale();
    error NotDeclared();
    error NotWinner();
    error ClaimWindowClosed();
    error ClaimWindowOpen();
    error NotYourFriend();
    error BurnMismatch();

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    /// @param rf_ $RAREFRIENDS - the deploy script hardcodes the real address;
    /// this constructor doesn't re-validate it against a canonical constant so
    /// the contract stays testable against mocks without weakening the deploy
    /// path itself.
    constructor(address rf_, address generations_, address oracle_) Ownable(msg.sender) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (rf_ == address(0) || generations_ == address(0) || oracle_ == address(0)) revert ZeroAddress();
        rf = IERC20(rf_);
        generations = IGenerations(generations_);
        oracle = oracle_;
        _unit = 10 ** IERC20Metadata(rf_).decimals();
        emit OracleSet(oracle_);
    }

    // ─── Player actions ─────────────────────────────────────────────────────

    /// @notice Create a match and stake the tier entry. Requires RF approval.
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
            winner: address(0),
            entry: entry
        });
        _players[matchId].push(msg.sender);
        isPlayer[matchId][msg.sender] = true;

        rf.safeTransferFrom(msg.sender, address(this), entry);
        emit MatchCreated(matchId, msg.sender, tier, entry, maxPlayers);
    }

    /// @notice Join an open match and stake its entry. Requires RF approval.
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

    /// @notice Host closes joins early. Needs at least two players.
    function startMatch(bytes32 matchId) external {
        Match storage m = _matches[matchId];
        if (msg.sender != m.host) revert NotHost();
        if (m.status != Status.Open) revert NotOpen();
        if (m.playerCount < MIN_PLAYERS) revert NotEnoughPlayers();
        _lock(matchId, m);
    }

    /// @notice Host alone in the match gets the full stake back.
    function cancelMatch(bytes32 matchId) external nonReentrant {
        Match storage m = _matches[matchId];
        if (msg.sender != m.host) revert NotHost();
        if (m.status != Status.Open) revert NotOpen();
        if (m.playerCount != 1) revert BadPlayerCount();

        m.status = Status.Cancelled;
        rf.safeTransfer(m.host, m.entry);
        emit MatchCancelled(matchId, m.host, m.entry);
    }

    /// @notice Winner claims inside the claim window. Pass a hardwired
    /// Generations friendId you own for the 92% share, or 0 for 90%.
    function claimPrize(bytes32 matchId, uint256 friendId) external nonReentrant {
        Match storage m = _matches[matchId];
        if (m.status != Status.Declared) revert NotDeclared();
        if (msg.sender != m.winner) revert NotWinner();
        if (block.timestamp > uint256(m.declaredAt) + CLAIM_WINDOW) revert ClaimWindowClosed();

        bool friend = friendId != 0;
        if (friend && !isEligibleFriend(msg.sender, friendId)) revert NotYourFriend();

        m.status = Status.Paid;
        uint256 pot = _potOf(m);
        (uint256 payout, uint256 rake) = split(pot, friend);

        rf.safeTransfer(msg.sender, payout);
        (uint256 burnAmt, uint256 rewardAmt) = _distributeRake(rake);
        emit PrizeClaimed(matchId, msg.sender, payout, burnAmt, rewardAmt, friendId);
    }

    // ─── Oracle ─────────────────────────────────────────────────────────────

    /// @notice Record the winner of a locked match. The winner must be a player.
    function declareWinner(bytes32 matchId, address winner) external onlyOracle {
        Match storage m = _matches[matchId];
        if (m.status != Status.Locked) revert NotLocked();
        if (!isPlayer[matchId][winner]) revert NotAPlayer();
        if (block.timestamp > uint256(m.lockedAt) + SETTLE_WINDOW) revert SettleWindowClosed();

        m.status = Status.Declared;
        m.winner = winner;
        m.declaredAt = uint40(block.timestamp);
        emit WinnerDeclared(matchId, winner, _potOf(m));
    }

    // ─── Permissionless safety valves ───────────────────────────────────────

    /// @notice Unclaimed after 7 days: the whole pot is treated as rake and
    /// distributed the same way a claim's rake would be (burned, or split with
    /// `rewards` once one is configured).
    function sweepUnclaimed(bytes32 matchId) external nonReentrant {
        Match storage m = _matches[matchId];
        if (m.status != Status.Declared) revert NotDeclared();
        if (block.timestamp <= uint256(m.declaredAt) + CLAIM_WINDOW) revert ClaimWindowOpen();

        m.status = Status.Swept;
        (uint256 burnAmt, uint256 rewardAmt) = _distributeRake(_potOf(m));
        emit UnclaimedSwept(matchId, burnAmt, rewardAmt);
    }

    /// @notice No winner declared in time (oracle down, unresolved tie, host
    /// never started): every player gets their entry back.
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

    /// @notice Point future rake at a real Rare Friends reward receiver, once
    /// one exists. Pass address(0) to go back to burning the full rake.
    function setRewards(address rewards_) external onlyOwner {
        if (rewards_ != address(0) && rewards_.code.length == 0) revert RewardsNotContract();
        rewards = rewards_;
        emit RewardsSet(rewards_);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    /// @notice Entry in RF base units: 10, 25, 50, 100, 250, 1000 RF.
    function tierEntry(uint8 tier) public view returns (uint256) {
        if (tier == 0) return 10 * _unit;
        if (tier == 1) return 25 * _unit;
        if (tier == 2) return 50 * _unit;
        if (tier == 3) return 100 * _unit;
        if (tier == 4) return 250 * _unit;
        if (tier == 5) return 1000 * _unit;
        revert BadTier();
    }

    /// @notice Winner share and rake for a pot. The rake's own burn/reward
    /// split isn't decided here - see `_distributeRake`, since it depends on
    /// whether `rewards` is configured.
    function split(uint256 pot, bool friend) public pure returns (uint256 payout, uint256 rake) {
        payout = (pot * (friend ? FRIEND_WINNER_BPS : WINNER_BPS)) / BPS;
        rake = pot - payout;
    }

    function isEligibleFriend(address account, uint256 friendId) public view returns (bool) {
        try generations.ownerOf(friendId) returns (address owner) {
            if (owner != account) return false;
        } catch {
            return false;
        }
        try generations.generation(friendId) returns (uint8 gen) {
            return gen >= 1 && gen <= FRIEND_MAX_GENERATION;
        } catch {
            return false;
        }
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

    /// @dev address(0) rewards → burn all of it. Otherwise 50/50, same as the
    /// original spec's rake split, just deferred until a receiver is set.
    function _distributeRake(uint256 rake) private returns (uint256 burnAmt, uint256 rewardAmt) {
        if (rake == 0) return (0, 0);
        address r = rewards;
        if (r == address(0)) {
            _burn(rake);
            return (rake, 0);
        }
        rewardAmt = rake / 2;
        burnAmt = rake - rewardAmt;
        _burn(burnAmt);
        rf.safeTransfer(r, rewardAmt);
    }

    /// @dev Prefer a real supply burn; fall back to the dead address if RF has
    /// no burn(uint256). Either way the tokens can never move again.
    function _burn(uint256 amount) private {
        if (amount == 0) return;
        uint256 before = rf.balanceOf(address(this));
        try IBurnable(address(rf)).burn(amount) {
            uint256 burned = before - rf.balanceOf(address(this));
            if (burned == amount) {
                emit Burned(amount, true);
                return;
            }
            if (burned != 0) revert BurnMismatch(); // unreachable in practice; guards a malformed burn()
        } catch { }
        rf.safeTransfer(DEAD, amount);
        emit Burned(amount, false);
    }
}

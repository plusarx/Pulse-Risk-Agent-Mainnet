// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Chainlink-compatible read interface (Atlas push feeds expose this shape).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title PriceIntegrityGuard
/// @notice On-chain twin of Pulse Risk's price-integrity check for tokenized stocks (bStocks) on BNB Chain.
///         For each token the owner registers an oracle feed (for example an Atlas push feed) and, optionally, a second
///         "anchor" feed for the same stock. `check` says whether the price can be relied on: fresh, positive, and, when
///         an anchor exists, within the allowed deviation. Other contracts call `isTrusted` or `requireTrusted` before
///         accepting a bStock as collateral. It holds no funds, moves nothing and never reverts in `check`: a broken or
///         malicious feed yields a status, not a failure.
contract PriceIntegrityGuard {
    enum Status { OK, NOT_CONFIGURED, STALE, BAD_PRICE, DIVERGED }

    struct Config {
        IAggregatorV3 feed;
        IAggregatorV3 anchor;     // address(0) = no cross-check
        uint32 maxAge;            // seconds
        uint16 maxDeviationBps;   // allowed |feed/anchor - 1| in basis points
    }

    uint32 public constant MAX_AGE_LIMIT = 1 days;
    uint16 public constant MAX_DEVIATION_LIMIT = 5_000; // 50%

    address public owner;
    address public pendingOwner;
    mapping(address token => Config) private _configs;

    error NotOwner();
    error NotPending();
    error ZeroAddress();
    error BadLimits();
    error NotTrusted(address token, Status status);

    event FeedSet(address indexed token, address feed, address anchor, uint32 maxAge, uint16 maxDeviationBps);
    event FeedRemoved(address indexed token);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    // ---- admin (two-step ownership; point it at a multisig) ---------------------------------------------------------

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPending();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    function setFeed(address token, address feed, address anchor, uint32 maxAge, uint16 maxDeviationBps) external onlyOwner {
        if (token == address(0) || feed == address(0)) revert ZeroAddress();
        if (maxAge == 0 || maxAge > MAX_AGE_LIMIT || maxDeviationBps == 0 || maxDeviationBps > MAX_DEVIATION_LIMIT) revert BadLimits();
        _configs[token] = Config(IAggregatorV3(feed), IAggregatorV3(anchor), maxAge, maxDeviationBps);
        emit FeedSet(token, feed, anchor, maxAge, maxDeviationBps);
    }

    function removeFeed(address token) external onlyOwner {
        delete _configs[token];
        emit FeedRemoved(token);
    }

    function configOf(address token) external view returns (Config memory) {
        return _configs[token];
    }

    // ---- the check --------------------------------------------------------------------------------------------------

    /// @return status OK only when the price can be relied on.
    /// @return price18 the feed's price scaled to 18 decimals (0 when it could not be read).
    /// @return ageSeconds seconds since the feed last updated (0 when it could not be read).
    function check(address token) public view returns (Status status, uint256 price18, uint256 ageSeconds) {
        Config memory c = _configs[token];
        if (address(c.feed) == address(0)) return (Status.NOT_CONFIGURED, 0, 0);

        uint256 updatedAt;
        (price18, updatedAt) = _read(c.feed);
        if (price18 == 0 || updatedAt == 0 || updatedAt > block.timestamp) return (Status.BAD_PRICE, 0, 0);
        ageSeconds = block.timestamp - updatedAt;
        if (ageSeconds > c.maxAge) return (Status.STALE, price18, ageSeconds);

        if (address(c.anchor) != address(0)) {
            (uint256 anchorPrice, uint256 anchorAt) = _read(c.anchor);
            if (anchorPrice == 0 || anchorAt == 0 || anchorAt > block.timestamp) return (Status.BAD_PRICE, price18, ageSeconds);
            if (block.timestamp - anchorAt > c.maxAge) return (Status.STALE, price18, ageSeconds);
            uint256 diff = price18 > anchorPrice ? price18 - anchorPrice : anchorPrice - price18;
            // diff / anchor > maxDeviationBps / 10_000, without dividing
            if (diff * 10_000 > anchorPrice * c.maxDeviationBps) return (Status.DIVERGED, price18, ageSeconds);
        }
        return (Status.OK, price18, ageSeconds);
    }

    function isTrusted(address token) external view returns (bool) {
        (Status s,,) = check(token);
        return s == Status.OK;
    }

    /// @notice Reverts unless the token's price is trusted. Returns the 18-decimal price for convenience.
    function requireTrusted(address token) external view returns (uint256 price18) {
        Status s;
        (s, price18,) = check(token);
        if (s != Status.OK) revert NotTrusted(token, s);
    }

    /// @dev A feed that reverts, returns a non-positive answer or reports silly decimals reads as "no price", never as a revert.
    function _read(IAggregatorV3 f) internal view returns (uint256 price18, uint256 updatedAt) {
        uint8 d;
        try f.decimals() returns (uint8 dec) { d = dec; } catch { return (0, 0); }
        if (d > 36) return (0, 0);
        try f.latestRoundData() returns (uint80, int256 answer, uint256, uint256 at, uint80) {
            if (answer <= 0) return (0, 0);
            uint256 a = uint256(answer);
            if (d <= 18) {
                uint256 scale = 10 ** (18 - d);
                if (a > type(uint256).max / scale) return (0, 0);   // would overflow: a nonsense answer, not a price
                price18 = a * scale;
            } else {
                price18 = a / 10 ** (d - 18);
            }
            updatedAt = at;
        } catch { return (0, 0); }
    }
}

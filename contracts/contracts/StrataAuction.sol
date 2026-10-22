// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title STRATA. Auction
/// @notice Timed auctions in AVAX for STRATA. collections, settled by the contract itself.
///         - The seller starts an auction by handing the piece to this contract, with a reserve and an end time.
///         - Bids are plain AVAX sent with `bid`. Each bid beats the last by at least 5%; the outbid AVAX goes
///           straight back to its bidder. A bid in the last 10 minutes moves the end to 10 minutes after it.
///         - Once there is a bid, nobody can back out: the piece and the top bid stay here until the end.
///         - After the end anyone can call `settle` (the STRATA. server does it): the piece goes to the top bidder,
///           the collection's ERC-2981 royalty to its receiver, the rest to the seller. No platform fee.
///           Without bids, `settle` gives the piece back. Before any bid the seller can `cancel`.
///         - If a payment can't be pushed (a contract wallet that rejects AVAX), it waits in `owed` for `withdraw`.
///         - Gasless for sellers: `createFor` / `cancelFor` take the seller's EIP-712 signature, so anyone (the STRATA.
///           server) can start or cancel an auction for them and pay the gas. Only what the seller signed can happen.
///         - The owner chooses which collections may be auctioned, can pause NEW auctions and can set a platform fee
///           per collection (max 10%, 0 for STRATA. collections). A fee change never touches auctions already running.
///           Nobody, the owner included, can move a piece or AVAX that is in an auction.
contract StrataAuction is Ownable, ReentrancyGuard, EIP712 {
    struct Auction {
        address collection;
        uint96 reserve;       // wei
        address seller;
        uint64 end;           // unix seconds
        bool settled;
        address bidder;       // top bidder (zero: no bids)
        uint96 bid;           // top bid, wei
        uint16 feeBps;        // platform fee, fixed when the auction starts
        uint256 tokenId;
    }

    uint256 public constant MIN_STEP_BPS = 500;     // +5% per bid
    uint64 public constant EXTEND = 10 minutes;     // anti-sniping window
    uint64 public constant MIN_DURATION = 10 minutes;
    uint64 public constant MAX_DURATION = 30 days;
    uint16 public constant MAX_FEE_BPS = 1000;      // a platform fee can never be above 10%
    bytes32 public constant CREATE_TYPEHASH =
        keccak256("Create(address seller,address collection,uint256 tokenId,uint96 reserve,uint64 duration,uint256 nonce,uint256 deadline)");
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(uint256 id,uint256 deadline)");
    mapping(address => uint256) public nonces;      // per seller, for createFor

    mapping(address => bool) public allowed;        // collections that may be auctioned
    mapping(uint256 => Auction) public auctions;
    mapping(address => uint256) public owed;        // payments that could not be pushed
    mapping(address => uint16) public feeBps;      // platform fee per collection (0 for STRATA. collections)
    address public feeRecipient;
    uint256 public count;
    bool public paused;

    event CollectionAllowed(address indexed collection, bool allowed);
    event Paused(bool paused);
    event AuctionCreated(uint256 indexed id, address indexed collection, uint256 indexed tokenId, address seller, uint256 reserve, uint64 end);
    event BidPlaced(uint256 indexed id, address indexed bidder, uint256 amount, uint64 end);
    event AuctionSettled(uint256 indexed id, address indexed winner, uint256 amount, uint256 royalty, address royaltyReceiver);
    event AuctionCancelled(uint256 indexed id);
    event Owed(address indexed to, uint256 amount);
    event FeeSet(address indexed collection, uint16 bps);
    event FeeRecipientSet(address recipient);
    event FeePaid(uint256 indexed id, address indexed recipient, uint256 amount);

    error NotAllowed();
    error IsPaused();
    error BadDuration();
    error BadReserve();
    error NoAuction();
    error Ended();
    error NotEnded();
    error TooLow(uint256 minimum);
    error SellerCannotBid();
    error NotSeller();
    error HasBids();
    error AlreadySettled();
    error NothingOwed();
    error Expired();
    error BadSignature();
    error FeeTooHigh();

    constructor(address owner_, address[] memory collections) Ownable(owner_) EIP712("StrataAuction", "1") {
        feeRecipient = owner_;
        for (uint256 i = 0; i < collections.length; i++) {
            allowed[collections[i]] = true;
            emit CollectionAllowed(collections[i], true);
        }
    }

    // ---- owner
    function setAllowed(address collection, bool ok) external onlyOwner {
        allowed[collection] = ok;
        emit CollectionAllowed(collection, ok);
    }

    /// @notice Platform fee for a collection (e.g. outside collections). Only auctions started after the change use it.
    function setFee(address collection, uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps[collection] = bps;
        emit FeeSet(collection, bps);
    }

    function setFeeRecipient(address r) external onlyOwner {
        feeRecipient = r;
        emit FeeRecipientSet(r);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// @notice Ownership can be transferred but never renounced.
    function renounceOwnership() public pure override {
        revert("disabled");
    }

    // ---- seller
    /// @notice Start an auction: the piece moves into this contract until it is settled or cancelled.
    ///         The seller must first approve this contract for the collection.
    function create(address collection, uint256 tokenId, uint96 reserve, uint64 duration) external nonReentrant returns (uint256) {
        return _create(msg.sender, collection, tokenId, reserve, duration);
    }

    /// @notice Same as `create`, for a seller who signed it (the caller pays the gas). One signature, one auction.
    function createFor(address seller, address collection, uint256 tokenId, uint96 reserve, uint64 duration, uint256 deadline, bytes calldata signature)
        external nonReentrant returns (uint256)
    {
        if (block.timestamp > deadline) revert Expired();
        if (ECDSA.recover(_hashTypedDataV4(_createHash(seller, collection, tokenId, reserve, duration, deadline)), signature) != seller) revert BadSignature();
        return _create(seller, collection, tokenId, reserve, duration);
    }

    function _createHash(address seller, address collection, uint256 tokenId, uint96 reserve, uint64 duration, uint256 deadline) internal returns (bytes32) {
        return keccak256(abi.encode(CREATE_TYPEHASH, seller, collection, tokenId, reserve, duration, nonces[seller]++, deadline));
    }

    function _create(address seller, address collection, uint256 tokenId, uint96 reserve, uint64 duration) internal returns (uint256 id) {
        if (paused) revert IsPaused();
        if (!allowed[collection]) revert NotAllowed();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert BadDuration();
        if (reserve == 0) revert BadReserve();
        id = ++count;
        uint64 end = uint64(block.timestamp) + duration;
        auctions[id] = Auction(collection, reserve, seller, end, false, address(0), 0, feeBps[collection], tokenId);
        IERC721(collection).transferFrom(seller, address(this), tokenId); // reverts unless the seller holds it and approved us
        emit AuctionCreated(id, collection, tokenId, seller, reserve, end);
    }

    /// @notice Before the first bid the seller can take the piece back.
    function cancel(uint256 id) external nonReentrant {
        if (auctions[id].seller != address(0) && msg.sender != auctions[id].seller) revert NotSeller();
        _cancel(id);
    }

    /// @notice Same as `cancel`, for a seller who signed it (the caller pays the gas).
    function cancelFor(uint256 id, uint256 deadline, bytes calldata signature) external nonReentrant {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, id, deadline)));
        if (ECDSA.recover(digest, signature) != auctions[id].seller) revert BadSignature();
        _cancel(id);
    }

    function _cancel(uint256 id) internal {
        Auction storage a = auctions[id];
        if (a.seller == address(0)) revert NoAuction();
        if (a.settled) revert AlreadySettled();
        if (a.bidder != address(0)) revert HasBids();
        a.settled = true;
        IERC721(a.collection).transferFrom(address(this), a.seller, a.tokenId);
        emit AuctionCancelled(id);
    }

    // ---- bidders
    /// @notice The lowest bid the auction takes now.
    function minBid(uint256 id) public view returns (uint256) {
        Auction storage a = auctions[id];
        if (a.bidder == address(0)) return a.reserve;
        return uint256(a.bid) + (uint256(a.bid) * MIN_STEP_BPS + 9_999) / 10_000;
    }

    function bid(uint256 id) external payable nonReentrant {
        Auction storage a = auctions[id];
        if (a.seller == address(0)) revert NoAuction();
        if (a.settled || block.timestamp >= a.end) revert Ended();
        if (msg.sender == a.seller) revert SellerCannotBid();
        uint256 min = minBid(id);
        if (msg.value < min || msg.value > type(uint96).max) revert TooLow(min);
        address prev = a.bidder;
        uint256 prevBid = a.bid;
        a.bidder = msg.sender;
        a.bid = uint96(msg.value);
        if (a.end - block.timestamp < EXTEND) a.end = uint64(block.timestamp) + EXTEND;
        emit BidPlaced(id, msg.sender, msg.value, a.end);
        if (prev != address(0)) _pay(prev, prevBid); // the outbid AVAX goes back at once
    }

    // ---- anyone, after the end
    function settle(uint256 id) external nonReentrant {
        Auction storage a = auctions[id];
        if (a.seller == address(0)) revert NoAuction();
        if (a.settled) revert AlreadySettled();
        if (block.timestamp < a.end) revert NotEnded();
        a.settled = true;
        if (a.bidder == address(0)) { // no bids: the piece goes home
            IERC721(a.collection).transferFrom(address(this), a.seller, a.tokenId);
            emit AuctionSettled(id, address(0), 0, 0, address(0));
            return;
        }
        uint256 amount = a.bid;
        (address receiver, uint256 royalty) = _royalty(a.collection, a.tokenId, amount);
        IERC721(a.collection).transferFrom(address(this), a.bidder, a.tokenId);
        uint256 fee = feeRecipient == address(0) ? 0 : amount * a.feeBps / 10_000;
        if (royalty > 0) _pay(receiver, royalty);
        if (fee > 0) { _pay(feeRecipient, fee); emit FeePaid(id, feeRecipient, fee); }
        _pay(a.seller, amount - royalty - fee);
        emit AuctionSettled(id, a.bidder, amount, royalty, receiver);
    }

    /// @notice Collect a payment that could not be pushed.
    function withdraw() external nonReentrant {
        uint256 v = owed[msg.sender];
        if (v == 0) revert NothingOwed();
        owed[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: v}("");
        require(ok, "transfer failed");
    }

    // ---- internals
    function _royalty(address collection, uint256 tokenId, uint256 amount) internal view returns (address, uint256) {
        try IERC2981(collection).royaltyInfo(tokenId, amount) returns (address r, uint256 v) {
            if (r == address(0) || v > amount / 2) return (address(0), 0); // never more than half
            return (r, v);
        } catch {
            return (address(0), 0);
        }
    }

    /// Pushes AVAX with limited gas; if the receiver refuses it, it is kept for `withdraw`.
    function _pay(address to, uint256 v) internal {
        (bool ok, ) = to.call{value: v, gas: 30_000}("");
        if (!ok) {
            owed[to] += v;
            emit Owed(to, v);
        }
    }
}

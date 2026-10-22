// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title STRATA. Transfer
/// @notice Sends several NFTs (any collections) to one wallet in one transaction.
///         - `send`: the holder calls it and moves their own pieces (after approving this contract per collection).
///         - `sendFor`: the holder signs Send(from, to, items, nonce, deadline) (no gas) and anyone (the STRATA. server,
///           which pays the gas) relays it. Only what the holder signed can move, once, before the deadline.
///         - Uses safeTransferFrom: a contract that can't receive NFTs makes the whole send fail instead of locking them.
///         - No owner, holds nothing.
contract StrataTransfer is EIP712 {
    struct Item { address collection; uint256 tokenId; }

    bytes32 public constant ITEM_TYPEHASH = keccak256("Item(address collection,uint256 tokenId)");
    bytes32 public constant SEND_TYPEHASH =
        keccak256("Send(address from,address to,Item[] items,uint256 nonce,uint256 deadline)Item(address collection,uint256 tokenId)");
    uint256 public constant MAX_ITEMS = 100;

    mapping(address => uint256) public nonces;

    event Sent(address indexed from, address indexed to, uint256 count);

    error Empty();
    error TooMany();
    error Expired();
    error BadSignature();
    error SelfSend();

    constructor() EIP712("StrataTransfer", "1") {}

    function send(address to, Item[] calldata items) external {
        _send(msg.sender, to, items);
    }

    function sendFor(address from, address to, Item[] calldata items, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert Expired();
        bytes32[] memory hashes = new bytes32[](items.length);
        for (uint256 i = 0; i < items.length; i++) hashes[i] = keccak256(abi.encode(ITEM_TYPEHASH, items[i].collection, items[i].tokenId));
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SEND_TYPEHASH, from, to, keccak256(abi.encodePacked(hashes)), nonces[from]++, deadline)));
        if (ECDSA.recover(digest, signature) != from) revert BadSignature();
        _send(from, to, items);
    }

    function _send(address from, address to, Item[] calldata items) internal {
        if (items.length == 0) revert Empty();
        if (items.length > MAX_ITEMS) revert TooMany();
        if (to == from || to == address(0)) revert SelfSend();
        for (uint256 i = 0; i < items.length; i++) IERC721(items[i].collection).safeTransferFrom(from, to, items[i].tokenId);
        emit Sent(from, to, items.length);
    }
}

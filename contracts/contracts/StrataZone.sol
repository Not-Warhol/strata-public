// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// Seaport 1.6 order shape (enums as uint8: same ABI encoding)
struct OfferItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; }
struct ConsiderationItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; address payable recipient; }
struct OrderComponents {
    address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType;
    uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 counter;
}

interface ISeaportCancel {
    function cancel(OrderComponents[] calldata orders) external returns (bool);
    function getOrderHash(OrderComponents calldata order) external view returns (bytes32);
}

/// @title STRATA. Zone
/// @notice Gasless cancels for STRATA. Market orders. Seaport lets an order's maker OR its zone cancel it; our orders
///         name this contract as their zone (open orders: the zone is never asked about fills, it can only cancel).
///         The maker signs "cancel these orders" (no gas) and anyone (the STRATA. server, which pays the gas) relays it
///         here. Without the maker's signature nobody, the deployer included, can cancel anything. No owner, no funds.
contract StrataZone is EIP712 {
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32[] orderHashes)");
    ISeaportCancel public immutable seaport;

    error Empty();
    error NotOurs();
    error MixedMakers();
    error BadSignature();

    constructor(address seaport_) EIP712("StrataZone", "1") {
        seaport = ISeaportCancel(seaport_);
    }

    /// @notice Cancels `orders` (all from one maker, all naming this zone) if `signature` is that maker's
    ///         EIP-712 signature of Cancel(orderHashes) over the same orders, in the same order.
    function cancel(OrderComponents[] calldata orders, bytes calldata signature) external returns (bool) {
        uint256 n = orders.length;
        if (n == 0) revert Empty();
        address maker = orders[0].offerer;
        bytes32[] memory hashes = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            if (orders[i].zone != address(this)) revert NotOurs();
            if (orders[i].offerer != maker) revert MixedMakers();
            hashes[i] = seaport.getOrderHash(orders[i]);
        }
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, keccak256(abi.encodePacked(hashes)))));
        if (ECDSA.recover(digest, signature) != maker) revert BadSignature();
        return seaport.cancel(orders);
    }
}

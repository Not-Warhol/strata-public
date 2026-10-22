// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";

/// Test only: an ERC-721 with a 5% ERC-2981 royalty, anyone can mint.
contract MockNFT is ERC721, ERC2981 {
    constructor(address royaltyReceiver) ERC721("Mock", "MOCK") { _setDefaultRoyalty(royaltyReceiver, 500); }
    function mint(address to, uint256 id) external { _mint(to, id); }
    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns (bool) { return super.supportsInterface(id); }
}

/// Test only: a wallet contract that refuses AVAX (to test `owed`).
contract Refuser {
    function bid(address auction, uint256 id) external payable {
        (bool ok, bytes memory r) = auction.call{value: msg.value}(abi.encodeWithSignature("bid(uint256)", id));
        if (!ok) assembly { revert(add(r, 32), mload(r)) }
    }
    function withdrawFrom(address auction) external { (bool ok, ) = auction.call(abi.encodeWithSignature("withdraw()")); require(ok); }
}

/// Test only: stands in for Seaport's cancel/getOrderHash (the real one is exercised on the C-Chain fork).
import {OrderComponents} from "../StrataZone.sol";
contract MockSeaport {
    mapping(bytes32 => bool) public cancelled;
    function getOrderHash(OrderComponents calldata o) public pure returns (bytes32) { return keccak256(abi.encode(o)); }
    function cancel(OrderComponents[] calldata orders) external returns (bool) {
        for (uint256 i = 0; i < orders.length; i++) {
            require(msg.sender == orders[i].offerer || msg.sender == orders[i].zone, "not offerer or zone");
            cancelled[getOrderHash(orders[i])] = true;
        }
        return true;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Simple Drop
/// @notice Small capped ERC-721 for tests and curated editions.
///         - The owner mints; a public mint can be opened later at a fixed price (payments go straight to the owner).
///         - 5% royalties (ERC-2981) and `contractURI` for marketplace collection metadata.
///         - Metadata lives at `baseURI + tokenId`; it can move (e.g. to IPFS) and then be frozen forever.
contract SimpleDrop is ERC721, ERC2981, Ownable {
    uint96 public constant ROYALTY_BPS = 500; // 5%

    uint256 public immutable maxSupply;
    uint256 public totalSupply;
    uint256 public price;
    bool public publicOpen;
    bool public metadataFrozen;
    string private baseURI_;
    string private contractURI_;

    /// @dev ERC-4906: tells marketplaces to refresh every token's metadata.
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);
    event PublicMint(bool open, uint256 price);
    event MetadataFrozen(string baseURI);

    error SoldOut();
    error MintClosed();
    error WrongPrice();
    error PayoutFailed();
    error MetadataIsFrozen();
    error CannotRenounce();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        address royaltyReceiver,
        string memory baseURIValue,
        string memory contractURIValue
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        maxSupply = maxSupply_;
        baseURI_ = baseURIValue;
        contractURI_ = contractURIValue;
        _setDefaultRoyalty(royaltyReceiver, ROYALTY_BPS);
    }

    function ownerMint(address to, uint256 quantity) external onlyOwner {
        _mintMany(to, quantity);
    }

    function mint(uint256 quantity) external payable {
        if (!publicOpen) revert MintClosed();
        if (msg.value != price * quantity) revert WrongPrice();
        _mintMany(msg.sender, quantity);
        if (msg.value > 0) {
            (bool ok, ) = owner().call{value: msg.value}("");
            if (!ok) revert PayoutFailed();
        }
    }

    function _mintMany(address to, uint256 quantity) private {
        if (totalSupply + quantity > maxSupply) revert SoldOut();
        for (uint256 i = 0; i < quantity; i++) _safeMint(to, ++totalSupply);
    }

    function setPublicMint(bool open, uint256 newPrice) external onlyOwner {
        publicOpen = open;
        price = newPrice;
        emit PublicMint(open, newPrice);
    }

    function setBaseURI(string calldata value) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        baseURI_ = value;
        if (totalSupply > 0) emit BatchMetadataUpdate(1, totalSupply);
    }

    function freezeMetadata() external onlyOwner {
        metadataFrozen = true;
        emit MetadataFrozen(baseURI_);
    }

    function setContractURI(string calldata value) external onlyOwner {
        contractURI_ = value;
    }

    function setRoyaltyReceiver(address receiver) external onlyOwner {
        _setDefaultRoyalty(receiver, ROYALTY_BPS);
    }

    function contractURI() external view returns (string memory) {
        return contractURI_;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI_;
    }

    function renounceOwnership() public view override onlyOwner {
        revert CannotRenounce();
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);
    }
}

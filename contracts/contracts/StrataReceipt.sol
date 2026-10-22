// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Burnable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Receipt
/// @notice A receipt for a gift to the Persona drop, issued in the same transaction as the mint. Never sold, never announced.
///         - Only the minter (the Persona contract) issues receipts; the owner can issue one by hand as a fallback.
///         - One receipt per wallet, ever. Transferable and burnable by its holder.
///         - Stores the Persona token, the amount given and the block; the server reads the tx hash from `Issued`.
///         - 5% royalties (ERC-2981) and `contractURI`. Metadata at `baseURI + tokenId`, can move and then freeze.
contract StrataReceipt is ERC721, ERC721Burnable, ERC2981, Ownable {
    struct Gift {
        uint128 paid;       // AVAX given in the mint (wei)
        uint64 persona;     // first Persona token of that mint
        uint64 blockNumber; // block of the mint
    }

    uint96 public constant ROYALTY_BPS = 500; // 5%

    address public minter;
    uint256 public totalMinted;
    mapping(address => bool) public received;
    mapping(uint256 => Gift) public gifts;
    bool public metadataFrozen;
    string private baseURI_;
    string private contractURI_;

    event Issued(address indexed to, uint256 indexed receiptId, uint256 indexed persona, uint256 paid);
    event MinterSet(address minter);
    /// @dev ERC-4906: tells marketplaces to refresh one token / every token.
    event MetadataUpdate(uint256 tokenId);
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);
    event MetadataFrozen(string baseURI);

    error NotMinter();
    error AlreadyReceived(address wallet);
    error MetadataIsFrozen();
    error CannotRenounce();

    constructor(
        string memory name_,
        string memory symbol_,
        address royaltyReceiver,
        string memory baseURIValue,
        string memory contractURIValue
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        baseURI_ = baseURIValue;
        contractURI_ = contractURIValue;
        _setDefaultRoyalty(royaltyReceiver, ROYALTY_BPS);
    }

    /// @notice Called by the Persona contract when a mint carries a gift. A wallet that already has a receipt gets
    ///         nothing more (no revert: the mint must go through). Returns the receipt id, 0 when none was issued.
    function issue(address to, uint256 persona, uint256 paid) external returns (uint256) {
        if (msg.sender != minter) revert NotMinter();
        if (received[to]) return 0;
        return _issue(to, persona, paid);
    }

    /// @notice Fallback: the owner issues a receipt by hand (e.g. if one did not go through with its mint).
    function ownerIssue(address to, uint256 persona, uint256 paid) external onlyOwner returns (uint256) {
        if (received[to]) revert AlreadyReceived(to);
        return _issue(to, persona, paid);
    }

    function _issue(address to, uint256 persona, uint256 paid) internal returns (uint256 id) {
        received[to] = true;
        id = ++totalMinted;
        gifts[id] = Gift(uint128(paid), uint64(persona), uint64(block.number));
        _mint(to, id);
        emit Issued(to, id, persona, paid);
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI_;
    }

    function contractURI() external view returns (string memory) {
        return contractURI_;
    }

    function setMinter(address m) external onlyOwner {
        minter = m;
        emit MinterSet(m);
    }

    function setBaseURI(string calldata value) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        baseURI_ = value;
        emit BatchMetadataUpdate(1, type(uint256).max);
    }

    /// @notice Asks marketplaces to refresh one receipt (e.g. once its picture is rendered).
    function refresh(uint256 tokenId) external onlyOwner {
        emit MetadataUpdate(tokenId);
    }

    /// @notice Irreversible: the base URI can never change again.
    function freezeMetadata() external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        metadataFrozen = true;
        emit MetadataFrozen(baseURI_);
    }

    function setContractURI(string calldata value) external onlyOwner {
        contractURI_ = value;
    }

    function setRoyaltyReceiver(address receiver) external onlyOwner {
        _setDefaultRoyalty(receiver, ROYALTY_BPS);
    }

    function renounceOwnership() public pure override {
        revert CannotRenounce();
    }

    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns (bool) {
        return id == 0x49064906 || super.supportsInterface(id);
    }
}

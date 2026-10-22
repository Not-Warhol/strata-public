// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Burnable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title STRATA. Riot
/// @notice A piece that compounds. A staker reinvests whole makooor credits (off chain, counted by the STRATA. server)
///         and the server signs a Reinvest: the wallet sends it here and its piece goes up that many levels, up to 10.
///         - No piece yet (tokenId 0 in the signed message): a new one is minted to the wallet at the levels reinvested.
///         - Each Reinvest emits `Reinvested`; the art of every level it adds is drawn from that transaction's hash.
///         - The holder can burn the piece (e.g. for a print in the STRATA. store); its level stays readable.
///         - 5% royalties (ERC-2981) and `contractURI`. Metadata at `baseURI + tokenId`, can move and then freeze.
contract StrataRiot is ERC721, ERC721Burnable, ERC2981, Ownable, EIP712 {
    uint96 public constant ROYALTY_BPS = 500; // 5%
    uint8 public constant MAX_LEVEL = 10;
    bytes32 public constant REINVEST_TYPEHASH =
        keccak256("Reinvest(address wallet,uint256 tokenId,uint8 levels,uint256 nonce,uint256 deadline)");

    address public signer;
    uint256 public totalMinted;
    mapping(uint256 => uint8) public levelOf;                    // token → level (kept after a burn)
    mapping(address => mapping(uint256 => bool)) public used;    // wallet → nonce → used
    bool public metadataFrozen;
    string private baseURI_;
    string private contractURI_;

    event Reinvested(uint256 indexed tokenId, address indexed wallet, uint8 fromLevel, uint8 toLevel, uint256 nonce);
    event SignerSet(address signer);
    /// @dev ERC-4906: tells marketplaces to refresh one token / every token.
    event MetadataUpdate(uint256 tokenId);
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);
    event MetadataFrozen(string baseURI);

    error Expired();
    error Used();
    error BadSignature();
    error NotHolder();
    error BadLevels();
    error MetadataIsFrozen();
    error CannotRenounce();

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        address signer_,
        address royaltyReceiver,
        string memory baseURIValue,
        string memory contractURIValue
    ) ERC721(name_, symbol_) Ownable(owner_) EIP712("StrataRiot", "1") {
        signer = signer_;
        baseURI_ = baseURIValue;
        contractURI_ = contractURIValue;
        _setDefaultRoyalty(royaltyReceiver, ROYALTY_BPS);
        emit SignerSet(signer_);
    }

    /// @notice Applies a Reinvest signed by the server. tokenId 0 mints a new piece; otherwise the caller's piece levels up.
    function reinvest(uint256 tokenId, uint8 levels, uint256 nonce, uint256 deadline, bytes calldata signature) external returns (uint256 id) {
        if (block.timestamp > deadline) revert Expired();
        if (used[msg.sender][nonce]) revert Used();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(REINVEST_TYPEHASH, msg.sender, tokenId, levels, nonce, deadline)));
        if (ECDSA.recover(digest, signature) != signer) revert BadSignature();
        used[msg.sender][nonce] = true;

        uint8 from;
        if (tokenId == 0) {
            id = ++totalMinted;
            _mint(msg.sender, id);
        } else {
            if (_ownerOf(tokenId) != msg.sender) revert NotHolder();
            id = tokenId;
            from = levelOf[id];
        }
        if (levels == 0 || uint256(from) + levels > MAX_LEVEL) revert BadLevels();
        uint8 to = from + levels;
        levelOf[id] = to;
        emit Reinvested(id, msg.sender, from, to, nonce);
        emit MetadataUpdate(id);
    }

    function setSigner(address s) external onlyOwner {
        signer = s;
        emit SignerSet(s);
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI_;
    }

    function contractURI() external view returns (string memory) {
        return contractURI_;
    }

    function setBaseURI(string calldata value) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        baseURI_ = value;
        emit BatchMetadataUpdate(1, type(uint256).max);
    }

    /// @notice Asks marketplaces to refresh one piece (e.g. once its picture is rendered).
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

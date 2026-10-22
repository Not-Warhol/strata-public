// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title Strata Drop
/// @notice One contract per monthly drop on the Avalanche C-Chain.
///         - Open edition: no max supply. Mint is open between `mintStart` and `mintEnd`;
///           whatever has been minted when the window closes is the final supply, forever.
///         - Each wallet mints up to the allowance signed for it (Drop 001: 1 to 5 pieces).
///         - The platform reads the wallet off-chain and signs (EIP-712) the price, the seed and a
///           drop-specific payload (`data`). The contract stores seed + data; the art is rendered from them.
///         - 5% royalties (ERC-2981), plus `contractURI` for marketplace collection metadata.
///         - Mint payments are forwarded to the owner in the same transaction: the contract holds no funds.
///         - Metadata can move from the site to IPFS with `setBaseURI`, then be locked forever with `freezeMetadata`.
contract StrataDrop is ERC721, ERC2981, EIP712, Ownable {
    struct Core {
        bytes32 seed;
        bytes data;
    }

    bytes32 public constant MINT_TYPEHASH =
        keccak256("Mint(address to,uint256 price,bytes32 seed,bytes data,uint8 allowance,uint256 deadline)");
    uint8 public constant MAX_PER_WALLET = 5;
    uint96 public constant ROYALTY_BPS = 500; // 5%

    address public signer;
    uint256 public totalSupply;
    uint64 public mintStart;
    uint64 public mintEnd;
    string private baseURI_;
    string private contractURI_;
    bool public metadataFrozen;

    mapping(uint256 => Core) private cores_;
    mapping(address => uint8) public mintedBy;
    mapping(bytes32 => bool) public seedUsed;

    event Minted(address indexed to, uint256 indexed tokenId, bytes32 seed, uint256 price);
    event SignerChanged(address signer);
    event MintWindowSet(uint64 start, uint64 end);
    /// @dev ERC-4906: tells marketplaces to refresh every token's metadata.
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);
    event MetadataFrozen(string baseURI);

    error MintClosed();
    error QuoteExpired();
    error AllowanceUsed();
    error WrongPrice();
    error BadSignature();
    error SeedTaken();
    error BadWindow();
    error WindowStarted();
    error PayoutFailed();
    error CannotRenounce();
    error MetadataIsFrozen();

    constructor(
        string memory name_,
        string memory symbol_,
        address signer_,
        uint64 start_,
        uint64 end_,
        address royaltyReceiver_,
        string memory base_,
        string memory contractURI__
    ) ERC721(name_, symbol_) EIP712("StrataDrop", "1") Ownable(msg.sender) {
        if (end_ <= start_) revert BadWindow();
        signer = signer_;
        mintStart = start_;
        mintEnd = end_;
        baseURI_ = base_;
        contractURI_ = contractURI__;
        _setDefaultRoyalty(royaltyReceiver_, ROYALTY_BPS);
        emit MintWindowSet(start_, end_);
    }

    function mintIsOpen() public view returns (bool) {
        return block.timestamp >= mintStart && block.timestamp < mintEnd;
    }

    function mint(uint256 price, bytes32 seed, bytes calldata data, uint8 allowance, uint256 deadline, bytes calldata signature)
        external
        payable
        returns (uint256 tokenId)
    {
        if (!mintIsOpen()) revert MintClosed();
        if (block.timestamp > deadline) revert QuoteExpired();
        if (allowance > MAX_PER_WALLET || mintedBy[msg.sender] >= allowance) revert AllowanceUsed();
        if (msg.value != price) revert WrongPrice();
        if (seedUsed[seed]) revert SeedTaken();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(MINT_TYPEHASH, msg.sender, price, seed, keccak256(data), allowance, deadline))
        );
        if (ECDSA.recover(digest, signature) != signer) revert BadSignature();

        mintedBy[msg.sender] += 1;
        seedUsed[seed] = true;
        tokenId = ++totalSupply;
        cores_[tokenId] = Core(seed, data);
        _safeMint(msg.sender, tokenId);
        emit Minted(msg.sender, tokenId, seed, price);

        if (msg.value > 0) {
            (bool ok, ) = payable(owner()).call{value: msg.value}("");
            if (!ok) revert PayoutFailed();
        }
    }

    /// @notice Seed and payload a token was generated from.
    function cores(uint256 tokenId) external view returns (bytes32 seed, bytes memory data) {
        Core storage c = cores_[tokenId];
        return (c.seed, c.data);
    }

    function contractURI() external view returns (string memory) {
        return contractURI_;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI_;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId); // ERC-4906
    }

    // --- owner ---

    /// @notice The window can only be changed before it opens. Once minting has started the
    ///         end time is fixed, so the final supply can't be stretched after the fact.
    function setMintWindow(uint64 start_, uint64 end_) external onlyOwner {
        if (block.timestamp >= mintStart) revert WindowStarted();
        if (end_ <= start_) revert BadWindow();
        mintStart = start_;
        mintEnd = end_;
        emit MintWindowSet(start_, end_);
    }
    function setSigner(address s) external onlyOwner { signer = s; emit SignerChanged(s); }
    function setBaseURI(string calldata b) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        baseURI_ = b;
        emit BatchMetadataUpdate(1, type(uint256).max);
    }
    /// @notice One-way switch: after this the token metadata URI can never change again, not even by the owner.
    ///         Call it only once the base URI points at the final IPFS folder.
    function freezeMetadata() external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        metadataFrozen = true;
        emit MetadataFrozen(baseURI_);
    }
    function setContractURI(string calldata c) external onlyOwner { contractURI_ = c; }
    /// @notice Royalty stays at 5%; only the receiving address can change.
    function setRoyaltyReceiver(address r) external onlyOwner { _setDefaultRoyalty(r, ROYALTY_BPS); }
    /// @notice Ownership can be transferred but never renounced: payouts go to the owner,
    ///         and a zero owner would burn every mint payment.
    function renounceOwnership() public view override onlyOwner {
        revert CannotRenounce();
    }
    /// @notice Mint payments are forwarded on mint; this only recovers AVAX sent here some other way.
    function withdraw(address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev The Receipt contract: issues one receipt per wallet for a gift (see StrataReceipt).
interface IReceipt {
    function issue(address to, uint256 persona, uint256 paid) external returns (uint256);
}

/// @title Persona (STRATA. Drop 002)
/// @notice A mask that grows with a wallet. Each token is one unique mask (its `seed`), built from the
///         transactions of its builder wallet: the past (up to `builds[id].since`) draws the map of lots,
///         every transaction after it raises a building. The art is rendered off-chain from these inputs.
///         Differences from StrataDrop (Drop 001):
///         - Pay what you want: the signed price is a minimum (0 for a free mint); anything above it is a
///           tip, forwarded to the owner with the rest.
///         - The per-wallet ceiling is a setting, not a constant (the signed allowance decides each wallet).
///         - The owner can mint a reserve (`ownerMint`).
///         - Redraw: whoever holds a token but isn't its builder can make it theirs, once per holding:
///           the builder becomes their wallet from that block on. Open/closed by the owner.
///         - Owner settings stay adjustable (window, signer, ceiling, URIs, redraw), no code upgrades.
///         - Mask uniqueness: a seed can only be used once, and the platform signs one seed per mask.
///         - Receipt: a mint that gives `receiptMin` or more also gets a Receipt (one per wallet), in the same
///           transaction. A receipt that fails never blocks the mint.
contract PersonaDrop is ERC721, ERC2981, EIP712, Ownable {
    struct Core {
        bytes32 seed;
        bytes data;
    }
    struct Build {
        address wallet; // whose transactions build the mask
        uint64 since;   // block from which its transactions raise buildings (the past is everything before)
        uint32 redraws; // how many times the token was redrawn
    }

    bytes32 public constant MINT_TYPEHASH =
        keccak256("Mint(address to,uint256 price,bytes32[] seeds,bytes[] data,uint8 allowance,uint256 deadline)");
    uint96 public constant ROYALTY_BPS = 500; // 5%

    address public signer;
    uint256 public totalSupply;
    uint64 public mintStart;
    uint64 public mintEnd;
    uint8 public maxPerWallet = 50;
    bool public redrawOpen = true;
    /// @notice A server wallet allowed to ask marketplaces to refresh every token (the pieces evolve). Owner-set, can be zero.
    address public refresher;
    string private baseURI_;
    string private contractURI_;
    bool public metadataFrozen;
    /// @notice The Receipt contract (zero: no receipts) and the gift that earns one.
    address public receipt;
    uint256 public receiptMin = 0.05 ether;

    mapping(uint256 => Core) private cores_;
    mapping(uint256 => Build) public builds;
    mapping(address => uint8) public mintedBy;
    mapping(bytes32 => bool) public seedUsed;

    event Minted(address indexed to, uint256 indexed tokenId, bytes32 seed, uint256 paid);
    event Redrawn(uint256 indexed tokenId, address indexed by, uint64 since, uint256 paid);
    event SignerChanged(address signer);
    event MintWindowSet(uint64 start, uint64 end);
    /// @dev ERC-4906: marketplaces refresh one token / every token.
    event MetadataUpdate(uint256 tokenId);
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);
    event MetadataFrozen(string baseURI);
    event ReceiptSet(address receipt, uint256 min);

    error MintClosed();
    error QuoteExpired();
    error AllowanceUsed();
    error WrongPrice();
    error BadSignature();
    error SeedTaken();
    error BadWindow();
    error PayoutFailed();
    error CannotRenounce();
    error MetadataIsFrozen();
    error NotHolder();
    error AlreadyBuilder();
    error RedrawClosed();
    error BadInput();
    error NotRefresher();

    constructor(
        string memory name_,
        string memory symbol_,
        address signer_,
        uint64 start_,
        uint64 end_,
        address royaltyReceiver_,
        string memory base_,
        string memory contractURI__
    ) ERC721(name_, symbol_) EIP712("StrataDrop", "2") Ownable(msg.sender) {
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

    /// @notice Mints one or several masks in one transaction (one seed each, all signed together).
    ///         `price` is the minimum for the whole batch, signed for this wallet; send more to tip.
    ///         `allowance` is the wallet's total after this mint, so a quote can only ever land once.
    function mint(uint256 price, bytes32[] calldata seeds, bytes[] calldata data, uint8 allowance, uint256 deadline, bytes calldata signature)
        external
        payable
        returns (uint256 firstTokenId)
    {
        uint256 n = seeds.length;
        if (n == 0 || n != data.length) revert BadInput();
        if (!mintIsOpen()) revert MintClosed();
        if (block.timestamp > deadline) revert QuoteExpired();
        if (allowance > maxPerWallet || uint256(mintedBy[msg.sender]) + n > allowance) revert AllowanceUsed();
        if (msg.value < price) revert WrongPrice();

        _checkQuote(price, seeds, data, allowance, deadline, signature);
        mintedBy[msg.sender] += uint8(n);
        firstTokenId = _mintMany(seeds, data);
        _issueReceipt(firstTokenId);
        _pay();
    }

    /// @dev A gift of `receiptMin` or more earns a receipt. Capped gas and try/catch: whatever happens in the
    ///      Receipt contract, the mint goes through.
    function _issueReceipt(uint256 tokenId) internal {
        if (receipt == address(0) || msg.value < receiptMin) return;
        try IReceipt(receipt).issue{gas: 250_000}(msg.sender, tokenId, msg.value) {} catch {}
    }

    /// @notice Whoever holds a token and isn't the wallet it is built from can make it theirs (once per holding:
    ///         after this they are the builder, so they can't do it again until the token changes hands).
    ///         The mask stays the same; the map of the past and the buildings now come from their wallet.
    function redraw(uint256 tokenId) external payable {
        if (!redrawOpen) revert RedrawClosed();
        if (ownerOf(tokenId) != msg.sender) revert NotHolder();
        Build storage b = builds[tokenId];
        if (b.wallet == msg.sender) revert AlreadyBuilder();
        b.wallet = msg.sender;
        b.since = uint64(block.number);
        b.redraws += 1;
        emit Redrawn(tokenId, msg.sender, b.since, msg.value);
        emit MetadataUpdate(tokenId);
        _pay();
    }

    /// @notice Anyone may ask marketplaces to refresh a token (the piece changes with every transaction).
    function refresh(uint256 tokenId) external {
        _requireOwned(tokenId);
        emit MetadataUpdate(tokenId);
    }

    /// @notice Seed and payload a token was minted with.
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

    function _mintOne(address to, bytes32 seed, bytes memory data) internal returns (uint256 tokenId) {
        if (seedUsed[seed]) revert SeedTaken();
        seedUsed[seed] = true;
        tokenId = ++totalSupply;
        cores_[tokenId] = Core(seed, data);
        builds[tokenId] = Build(to, uint64(block.number), 0);
        _safeMint(to, tokenId);
    }

    function _checkQuote(uint256 price, bytes32[] calldata seeds, bytes[] calldata data, uint8 allowance, uint256 deadline, bytes calldata signature) internal view {
        bytes32[] memory dataHashes = new bytes32[](data.length);
        for (uint256 i = 0; i < data.length; i++) dataHashes[i] = keccak256(data[i]);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            MINT_TYPEHASH, msg.sender, price, keccak256(abi.encodePacked(seeds)), keccak256(abi.encodePacked(dataHashes)), allowance, deadline
        )));
        if (ECDSA.recover(digest, signature) != signer) revert BadSignature();
    }

    function _mintMany(bytes32[] calldata seeds, bytes[] calldata data) internal returns (uint256 firstTokenId) {
        for (uint256 i = 0; i < seeds.length; i++) {
            uint256 tokenId = _mintOne(msg.sender, seeds[i], data[i]);
            if (i == 0) firstTokenId = tokenId;
            emit Minted(msg.sender, tokenId, seeds[i], i == 0 ? msg.value : 0);
        }
    }

    function _pay() internal {
        if (msg.value > 0) {
            (bool ok, ) = payable(owner()).call{value: msg.value}("");
            if (!ok) revert PayoutFailed();
        }
    }

    // --- owner ---

    /// @notice The owner's reserve: one token per seed, built from `to`'s wallet. Seeds are unique like any mint.
    function ownerMint(address to, bytes32[] calldata seeds, bytes[] calldata data) external onlyOwner {
        if (seeds.length != data.length || seeds.length == 0) revert BadInput();
        for (uint256 i = 0; i < seeds.length; i++) {
            uint256 tokenId = _mintOne(to, seeds[i], data[i]);
            emit Minted(to, tokenId, seeds[i], 0);
        }
    }
    function setMintWindow(uint64 start_, uint64 end_) external onlyOwner {
        if (end_ <= start_) revert BadWindow();
        mintStart = start_;
        mintEnd = end_;
        emit MintWindowSet(start_, end_);
    }
    function setSigner(address s) external onlyOwner { signer = s; emit SignerChanged(s); }
    function setMaxPerWallet(uint8 m) external onlyOwner { maxPerWallet = m; }
    function setRedrawOpen(bool open) external onlyOwner { redrawOpen = open; }
    function setReceipt(address r, uint256 min) external onlyOwner { receipt = r; receiptMin = min; emit ReceiptSet(r, min); }
    function setBaseURI(string calldata b) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        baseURI_ = b;
        emit BatchMetadataUpdate(1, type(uint256).max);
    }
    /// @notice Tells marketplaces to refresh every token (the pieces evolve). The owner or the refresher wallet.
    function refreshAll() external {
        if (msg.sender != owner() && msg.sender != refresher) revert NotRefresher();
        emit BatchMetadataUpdate(1, type(uint256).max);
    }
    function setRefresher(address r) external onlyOwner { refresher = r; }
    /// @notice One-way switch: after this the token metadata URI can never change again.
    function freezeMetadata() external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        metadataFrozen = true;
        emit MetadataFrozen(baseURI_);
    }
    function setContractURI(string calldata c) external onlyOwner { contractURI_ = c; }
    /// @notice Royalty stays at 5%; only the receiving address can change.
    function setRoyaltyReceiver(address r) external onlyOwner { _setDefaultRoyalty(r, ROYALTY_BPS); }
    /// @notice Ownership can be transferred but never renounced: payouts go to the owner.
    function renounceOwnership() public view override onlyOwner {
        revert CannotRenounce();
    }
    /// @notice Payments are forwarded as they come; this only recovers AVAX sent here some other way.
    function withdraw(address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }
}

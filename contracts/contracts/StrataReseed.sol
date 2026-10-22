// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title Strata Reseed
/// @notice Companion to a closed StrataDrop: whoever holds a token can redraw it from their own wallet.
///         - The platform reads the holder's wallet off-chain and signs (EIP-712) the price, the new seed
///           and the drop payload, exactly like a mint quote. The token itself never moves.
///         - The drop's metadata server draws a token from its latest reseed here, or from `cores()` on the
///           drop contract if it was never reseeded. Every reseed stays readable in `history`.
///         - One reseed per holder per token: a buyer can make a piece theirs, not reroll it.
///         - Payments are forwarded to the owner in the same transaction: the contract holds no funds.
///         - `close()` ends reseeding forever, so the drop's metadata can then be frozen on IPFS.
contract StrataReseed is EIP712, Ownable {
    struct Core {
        bytes32 seed;
        bytes data;
        address by;
        uint64 at;
    }

    bytes32 public constant RESEED_TYPEHASH =
        keccak256("Reseed(address to,uint256 tokenId,uint256 price,bytes32 seed,bytes data,uint256 deadline)");

    IERC721 public immutable drop;
    address public signer;
    bool public closed;

    /// @notice Every reseed ever made, in order (token id of each). The server follows this list.
    uint256[] public history;
    mapping(uint256 => Core[]) private cores_;
    mapping(uint256 => mapping(address => bool)) public reseededBy;
    mapping(bytes32 => bool) public seedUsed;

    event Reseeded(uint256 indexed tokenId, address indexed by, bytes32 seed, uint256 price, uint256 version);
    /// @dev ERC-4906 shape, for indexers that follow it (marketplaces listen on the drop contract itself).
    event MetadataUpdate(uint256 tokenId);
    event SignerChanged(address signer);
    event Closed();

    error ReseedClosed();
    error NotHolder();
    error AlreadyReseeded();
    error QuoteExpired();
    error WrongPrice();
    error BadSignature();
    error SeedTaken();
    error PayoutFailed();
    error CannotRenounce();

    constructor(address drop_, address signer_) EIP712("StrataReseed", "1") Ownable(msg.sender) {
        drop = IERC721(drop_);
        signer = signer_;
    }

    function reseed(uint256 tokenId, uint256 price, bytes32 seed, bytes calldata data, uint256 deadline, bytes calldata signature)
        external
        payable
    {
        if (closed) revert ReseedClosed();
        if (block.timestamp > deadline) revert QuoteExpired();
        if (drop.ownerOf(tokenId) != msg.sender) revert NotHolder();
        if (reseededBy[tokenId][msg.sender]) revert AlreadyReseeded();
        if (msg.value != price) revert WrongPrice();
        if (seedUsed[seed]) revert SeedTaken();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(RESEED_TYPEHASH, msg.sender, tokenId, price, seed, keccak256(data), deadline))
        );
        if (ECDSA.recover(digest, signature) != signer) revert BadSignature();

        reseededBy[tokenId][msg.sender] = true;
        seedUsed[seed] = true;
        cores_[tokenId].push(Core(seed, data, msg.sender, uint64(block.timestamp)));
        history.push(tokenId);
        emit Reseeded(tokenId, msg.sender, seed, price, cores_[tokenId].length);
        emit MetadataUpdate(tokenId);

        if (msg.value > 0) {
            (bool ok, ) = payable(owner()).call{value: msg.value}("");
            if (!ok) revert PayoutFailed();
        }
    }

    /// @notice Number of reseeds across all tokens (length of `history`).
    function totalReseeds() external view returns (uint256) {
        return history.length;
    }

    /// @notice How many times a token has been reseeded (0 = still drawn from the drop contract).
    function versions(uint256 tokenId) external view returns (uint256) {
        return cores_[tokenId].length;
    }

    /// @notice The seed and payload a token is drawn from now. Zero seed = never reseeded.
    function current(uint256 tokenId) external view returns (bytes32 seed, bytes memory data, address by, uint64 at) {
        Core[] storage list = cores_[tokenId];
        if (list.length == 0) return (bytes32(0), "", address(0), 0);
        Core storage c = list[list.length - 1];
        return (c.seed, c.data, c.by, c.at);
    }

    /// @notice A past version of a token (1-based, as in the `Reseeded` event).
    function coreAt(uint256 tokenId, uint256 version) external view returns (bytes32 seed, bytes memory data, address by, uint64 at) {
        Core storage c = cores_[tokenId][version - 1];
        return (c.seed, c.data, c.by, c.at);
    }

    // --- owner ---

    function setSigner(address s) external onlyOwner { signer = s; emit SignerChanged(s); }
    /// @notice One-way switch: no reseed can happen after this, not even by the owner.
    function close() external onlyOwner {
        closed = true;
        emit Closed();
    }
    /// @notice Ownership can be transferred but never renounced: payouts go to the owner.
    function renounceOwnership() public view override onlyOwner {
        revert CannotRenounce();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @title STRATA. Rewards
/// @notice The vault for staking rewards paid on chain (ERC-20 tokens and ERC-721 pieces).
///         - The owner deposits what a season gives away. The STRATA. server counts each staked Persona's
///           fragments (StrataStake) and, once a wallet has whole units, signs a Claim; the wallet sends it here
///           and receives the tokens or pieces. Each claim works once and only before its deadline.
///         - Safety: a reward pays out only while it has a daily limit set by the owner (amount for an ERC-20,
///           pieces for an ERC-721), so a stolen server key could never empty the vault in one go. The owner can
///           pause claims and take back anything in the vault at any time.
contract StrataRewards is Ownable, EIP712, IERC721Receiver {
    using SafeERC20 for IERC20;

    uint8 public constant ERC20_KIND = 0;
    uint8 public constant ERC721_KIND = 1;
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address wallet,address token,uint8 kind,uint256 amount,uint256[] ids,uint256 nonce,uint256 deadline)");

    address public signer;
    bool public paused;
    mapping(address => uint256) public dailyLimit; // token → most paid out per UTC day (0 = reward off)
    mapping(address => mapping(uint256 => uint256)) public paidOn; // token → day → paid out that day
    mapping(address => mapping(uint256 => bool)) public used; // wallet → nonce → claimed

    event SignerSet(address signer);
    event Paused(bool paused);
    event LimitSet(address indexed token, uint256 perDay);
    event Claimed(address indexed wallet, address indexed token, uint8 kind, uint256 amount, uint256[] ids, uint256 nonce);
    event Withdrawn(address indexed token, uint256 amount, uint256[] ids);

    error IsPaused();
    error Expired();
    error Used();
    error BadSignature();
    error BadKind();
    error RewardOff();
    error OverDailyLimit();
    error Nothing();

    constructor(address owner_, address signer_) Ownable(owner_) EIP712("StrataRewards", "1") {
        signer = signer_;
        emit SignerSet(signer_);
    }

    /// @notice Ownership can be transferred but never renounced.
    function renounceOwnership() public pure override {
        revert("disabled");
    }

    function setSigner(address s) external onlyOwner {
        signer = s;
        emit SignerSet(s);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// @notice Turns a reward on (perDay > 0) or off (0).
    function setDailyLimit(address token, uint256 perDay) external onlyOwner {
        dailyLimit[token] = perDay;
        emit LimitSet(token, perDay);
    }

    /// @notice Pays a claim signed by the server. `amount` for an ERC-20, `ids` (pieces held here) for an ERC-721.
    function claim(address token, uint8 kind, uint256 amount, uint256[] calldata ids, uint256 nonce, uint256 deadline, bytes calldata signature) external {
        if (paused) revert IsPaused();
        if (block.timestamp > deadline) revert Expired();
        if (used[msg.sender][nonce]) revert Used();
        if (kind > ERC721_KIND) revert BadKind();
        _verify(token, kind, amount, ids, nonce, deadline, signature);
        used[msg.sender][nonce] = true;
        _count(token, kind == ERC20_KIND ? amount : ids.length);
        if (kind == ERC20_KIND) {
            IERC20(token).safeTransfer(msg.sender, amount);
        } else {
            for (uint256 i; i < ids.length; ++i) IERC721(token).safeTransferFrom(address(this), msg.sender, ids[i]);
        }
        emit Claimed(msg.sender, token, kind, amount, ids, nonce);
    }

    function _verify(address token, uint8 kind, uint256 amount, uint256[] calldata ids, uint256 nonce, uint256 deadline, bytes calldata signature) private view {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            CLAIM_TYPEHASH, msg.sender, token, kind, amount, keccak256(abi.encodePacked(ids)), nonce, deadline
        )));
        if (ECDSA.recover(digest, signature) != signer) revert BadSignature();
    }

    /// @dev Books `units` against the token's limit for today (UTC).
    function _count(address token, uint256 units) private {
        if (units == 0) revert Nothing();
        uint256 limit = dailyLimit[token];
        if (limit == 0) revert RewardOff();
        uint256 day = block.timestamp / 1 days;
        uint256 paid = paidOn[token][day] + units;
        if (paid > limit) revert OverDailyLimit();
        paidOn[token][day] = paid;
    }

    /// @notice The owner takes back tokens or pieces from the vault (end of a season, or anything sent by mistake).
    function withdraw(address token, uint256 amount, uint256[] calldata ids) external onlyOwner {
        if (amount > 0) IERC20(token).safeTransfer(msg.sender, amount);
        for (uint256 i; i < ids.length; ++i) IERC721(token).safeTransferFrom(address(this), msg.sender, ids[i]);
        emit Withdrawn(token, amount, ids);
    }

    /// @notice Accepts pieces sent with safeTransferFrom (the owner's deposits).
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

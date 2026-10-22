// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title STRATA. Names
/// @notice One username per wallet: the wallet can never change it or move it, and each name has one wallet.
///         - The wallet signs Name(wallet, name) (no gas). STRATA. checks it (holders of a STRATA. piece only) and the
///           registrar (the STRATA. server, which pays the gas) or the owner writes it here at once.
///           Nobody can give a wallet a name it did not sign.
///         - Moderation: the owner (or the registrar, on the owner's word) can remove a name. The removed name stays
///           blocked for good (nobody can take it), and the wallet may pick another one.
///         - Names: 3 to 20 characters, a-z, 0-9 and underscore.
contract StrataNames is Ownable, EIP712 {
    bytes32 public constant NAME_TYPEHASH = keccak256("Name(address wallet,string name)");

    address public registrar;
    mapping(address => string) public nameOf;
    mapping(bytes32 => address) public walletOf; // keccak256(name) → wallet

    event RegistrarSet(address registrar);
    event NameSet(address indexed wallet, string name);
    event NameRemoved(address indexed wallet, string name);

    error NotRegistrar();
    error HasName();
    error Taken();
    error BadName();
    error BadSignature();
    error NoName();

    constructor(address owner_, address registrar_) Ownable(owner_) EIP712("StrataNames", "1") {
        registrar = registrar_;
        emit RegistrarSet(registrar_);
    }

    function setRegistrar(address r) external onlyOwner {
        registrar = r;
        emit RegistrarSet(r);
    }

    /// @notice Ownership can be transferred but never renounced.
    function renounceOwnership() public pure override {
        revert("disabled");
    }

    /// @notice Writes an approved name. `signature` is the wallet's EIP-712 signature of Name(wallet, name).
    function register(address wallet, string calldata name, bytes calldata signature) external {
        if (msg.sender != registrar && msg.sender != owner()) revert NotRegistrar();
        if (bytes(nameOf[wallet]).length != 0) revert HasName();
        if (!valid(name)) revert BadName();
        bytes32 key = keccak256(bytes(name));
        if (walletOf[key] != address(0)) revert Taken();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(NAME_TYPEHASH, wallet, key)));
        if (ECDSA.recover(digest, signature) != wallet) revert BadSignature();
        nameOf[wallet] = name;
        walletOf[key] = wallet;
        emit NameSet(wallet, name);
    }

    /// @notice Moderation: removes a wallet's name. The name stays blocked; the wallet may register another.
    function remove(address wallet) external {
        if (msg.sender != registrar && msg.sender != owner()) revert NotRegistrar();
        string memory name = nameOf[wallet];
        if (bytes(name).length == 0) revert NoName();
        delete nameOf[wallet];
        emit NameRemoved(wallet, name);
    }

    /// @notice 3 to 20 characters: a-z, 0-9, underscore.
    function valid(string calldata name) public pure returns (bool) {
        bytes calldata b = bytes(name);
        if (b.length < 3 || b.length > 20) return false;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f)) return false;
        }
        return true;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IStrataReceipt {
    function issue(address to, uint256 persona, uint256 paid) external returns (uint256);
    function received(address wallet) external view returns (bool);
}

/// @title Give
/// @notice The open donation to STRATA. (the Receipt zone on the Drops page, 13 Oct 2026):
///         - `give()` with at least `minGift` (0.1 AVAX at launch). The AVAX goes straight to `payTo` (the owner wallet)
///           in the same transaction; this contract never holds funds.
///         - The first gift of a wallet mints its Receipt (this contract is the Receipt's minter); every later gift adds up
///           on chain (`given`) and the site repaints the Receipt by tier. One Receipt per wallet, ever (the Receipt enforces it).
///         - `issue` lets the owner, or an operator wallet of the server, mint a Receipt by hand for a wallet that gave
///           another way (the Persona mint closed; store orders), since the Receipt accepts one minter only.
contract StrataGive is Ownable {
    IStrataReceipt public immutable receipt;
    address payable public payTo;
    uint256 public minGift;
    address public operator;
    uint256 public total;                       // every gift through here, in wei
    uint256 public gifts;                       // how many
    mapping(address => uint256) public given;   // per wallet, in wei

    event Gave(address indexed from, uint256 amount, uint256 totalGiven, uint256 indexed receiptId);
    event MinGiftSet(uint256 minGift);
    event PayToSet(address payTo);
    event OperatorSet(address operator);

    error BelowMinimum(uint256 sent, uint256 minimum);
    error PayFailed();
    error NotOperator();
    error CannotRenounce();
    error ZeroAddress();

    constructor(address owner_, address receipt_, address payable payTo_, uint256 minGift_) Ownable(owner_) {
        if (receipt_ == address(0) || payTo_ == address(0)) revert ZeroAddress();
        receipt = IStrataReceipt(receipt_);
        payTo = payTo_;
        minGift = minGift_;
    }

    /// @notice Give `minGift` or more. Returns the Receipt id minted now, or 0 when the wallet already had one.
    function give() external payable returns (uint256 id) {
        if (msg.value < minGift) revert BelowMinimum(msg.value, minGift);
        given[msg.sender] += msg.value;
        total += msg.value;
        gifts += 1;
        (bool ok, ) = payTo.call{value: msg.value}("");
        if (!ok) revert PayFailed();
        if (!receipt.received(msg.sender)) id = receipt.issue(msg.sender, 0, msg.value);
        emit Gave(msg.sender, msg.value, given[msg.sender], id);
    }

    /// @notice A Receipt by hand (owner or the server's operator wallet), for a gift made another way.
    function issue(address to, uint256 persona, uint256 paid) external returns (uint256) {
        if (msg.sender != owner() && msg.sender != operator) revert NotOperator();
        return receipt.issue(to, persona, paid);
    }

    function setMinGift(uint256 value) external onlyOwner { minGift = value; emit MinGiftSet(value); }
    function setPayTo(address payable value) external onlyOwner { if (value == address(0)) revert ZeroAddress(); payTo = value; emit PayToSet(value); }
    function setOperator(address value) external onlyOwner { operator = value; emit OperatorSet(value); }
    function renounceOwnership() public pure override { revert CannotRenounce(); }
}

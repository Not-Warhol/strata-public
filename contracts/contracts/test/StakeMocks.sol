// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// Test only: an ERC-721 with totalSupply (stands in for Persona, Contour and Receipt in the staking test).
contract MockSupplyNFT is ERC721 {
    uint256 public totalSupply;
    constructor() ERC721("Mock", "MOCK") {}
    function mint(address to) external { _mint(to, ++totalSupply); }
}

/// Test only: Multicall3's aggregate3, put at the canonical address with hardhat_setCode.
contract MockMulticall3 {
    struct Call3 { address target; bool allowFailure; bytes callData; }
    struct Result { bool success; bytes returnData; }
    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory r) {
        r = new Result[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            (r[i].success, r[i].returnData) = calls[i].target.staticcall(calls[i].callData);
            require(calls[i].allowFailure || r[i].success, "call failed");
        }
    }
}

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Test only: an ERC-20 anyone can mint (a reward token in the StrataRewards test).
contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

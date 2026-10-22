// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title STRATA. Stake
/// @notice Non-custodial staking for one collection (STRATA. 002: Persona). The NFT never leaves the wallet:
///         `stake` only writes down who staked which token and since when.
///         - A stake counts only while the wallet that staked still owns the token. Sell or move it and the stake
///           ends by itself (`isStaked` turns false); the new owner may stake it again from zero.
///         - What a stake earns (credits on makooor) is counted off chain by the STRATA. server from these records.
///         - The owner can pause new stakes (end of a season). Unstaking always works.
contract StrataStake is Ownable {
    IERC721 public immutable nft;
    bool public paused;

    struct Stake {
        address wallet;
        uint64 since;
    }
    mapping(uint256 => Stake) public stakes; // token id → stake

    event Staked(address indexed wallet, uint256 indexed tokenId, uint64 since);
    event Unstaked(address indexed wallet, uint256 indexed tokenId);
    event Paused(bool paused);

    error IsPaused();
    error NotOwner(uint256 tokenId);
    error AlreadyStaked(uint256 tokenId);
    error NotStaker(uint256 tokenId);
    error Empty();

    constructor(address owner_, address nft_) Ownable(owner_) {
        nft = IERC721(nft_);
    }

    /// @notice Ownership can be transferred but never renounced.
    function renounceOwnership() public pure override {
        revert("disabled");
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// @notice Stakes tokens the caller owns. A token staked by a previous owner is taken over (that stake was void).
    function stake(uint256[] calldata ids) external {
        if (paused) revert IsPaused();
        if (ids.length == 0) revert Empty();
        uint64 now_ = uint64(block.timestamp);
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            if (nft.ownerOf(id) != msg.sender) revert NotOwner(id);
            Stake memory s = stakes[id];
            if (s.wallet == msg.sender) revert AlreadyStaked(id);
            if (s.wallet != address(0)) emit Unstaked(s.wallet, id); // the old owner's stake ended when the token moved
            stakes[id] = Stake(msg.sender, now_);
            emit Staked(msg.sender, id, now_);
        }
    }

    /// @notice Ends the caller's stakes. Credits already earned stay earned.
    function unstake(uint256[] calldata ids) external {
        if (ids.length == 0) revert Empty();
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            if (stakes[id].wallet != msg.sender) revert NotStaker(id);
            delete stakes[id];
            emit Unstaked(msg.sender, id);
        }
    }

    /// @notice True while the wallet that staked the token still owns it.
    function isStaked(uint256 id) public view returns (bool) {
        Stake memory s = stakes[id];
        if (s.wallet == address(0)) return false;
        try nft.ownerOf(id) returns (address o) {
            return o == s.wallet;
        } catch {
            return false;
        }
    }

    /// @notice For the server: one call for many tokens. Void stakes come back as wallet 0.
    function stakesOf(uint256[] calldata ids) external view returns (address[] memory wallets, uint64[] memory since) {
        wallets = new address[](ids.length);
        since = new uint64[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            if (isStaked(ids[i])) {
                Stake memory s = stakes[ids[i]];
                (wallets[i], since[i]) = (s.wallet, s.since);
            }
        }
    }
}

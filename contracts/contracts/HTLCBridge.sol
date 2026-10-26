// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IHTLCEscrowV2.sol";

contract HTLCBridge {
    address public immutable escrowFactory;
    address public activeV2Escrow;
    mapping(bytes32 => bool) public locked;

    constructor(address _escrowFactory) {
        escrowFactory = _escrowFactory;
    }

    function setActiveV2Escrow(address _v2Escrow) external {
        activeV2Escrow = _v2Escrow;
    }

    function newLock(
        bytes32 lockHash,
        address target,
        uint256 amount,
        uint256 expiration
    ) external payable {
        require(msg.value == amount, "Amount mismatch");
        require(!locked[lockHash], "Already locked");

        if (activeV2Escrow != address(0) && activeV2Escrow != target) {
            revert("Legacy lock rejected: v2 escrow active");
        }

        locked[lockHash] = true;
        // Legacy lock logic continues...
    }

    // ... rest of existing contract code
}
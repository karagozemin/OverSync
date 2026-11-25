// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HTLCBridge} from "../../contracts/HTLCBridge.sol";

contract HTLCBridgeLegacyLockTest is Test {
    HTLCBridge bridge;

    function setUp() public {
        bridge = new HTLCBridge(address(0));
        vm.deal(address(this), 1 ether);
    }

    function _lock() internal {
        bridge.newLock{value: 0.01 ether}(
            bytes32(uint256(1)),
            address(this),
            0.01 ether,
            block.timestamp + 2 hours
        );
    }

    function test_legacyLockRevertsWhenV2EscrowIsActive() public {
        bridge.setActiveV2Escrow(address(0xBEEF));
        vm.expectRevert(bytes("Legacy lock rejected: v2 escrow active"));
        _lock();
    }

    function test_legacyLockSucceedsWhenV2IsUnset() public {
        _lock();
        assertTrue(bridge.locked(bytes32(uint256(1))));
    }
}

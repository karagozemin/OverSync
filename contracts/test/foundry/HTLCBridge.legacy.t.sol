// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HTLCBridge} from "../../contracts/HTLCBridge.sol";

contract HTLCBridgeLegacyLockTest is Test {
    HTLCBridge bridge;

    function setUp() public {
        bridge = new HTLCBridge();
        vm.deal(address(this), 1 ether);
    }

    function _lock() internal returns (uint256) {
        return bridge.createOrder{value: 0.01 ether}(
            address(0),
            1,
            bytes32(uint256(1)),
            block.timestamp + 2 hours,
            0,
            address(this),
            address(this),
            1,
            bytes32(0),
            false
        );
    }

    function test_legacyLockRevertsWhenV2EscrowIsActive() public {
        bridge.setActiveV2Escrow(address(0xBEEF));
        vm.expectRevert(bytes("legacy lock refused"));
        _lock();
    }

    function test_legacyLockSucceedsWhenV2IsUnset() public {
        uint256 id = _lock();
        assertEq(id, 1);
    }
}

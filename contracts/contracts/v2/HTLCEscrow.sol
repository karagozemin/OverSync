// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

import {IHTLCEscrow} from "./interfaces/IHTLCEscrow.sol";
import {IResolverRegistry} from "./interfaces/IResolverRegistry.sol";

/// @title HTLCEscrow
/// @notice OverSync v2 canonical Ethereum-side HTLC. Mirrors the
///         OverSync Soroban HTLC; the two contracts together implement
///         atomic cross-chain swaps with these properties:
///
///         1. Funds locked by `createOrder` can only move under two
///            conditions:
///            - The beneficiary reveals a preimage whose digest matches
///              `hashlock` before `timelock`.
///            - Anyone calls `refundOrder` after `timelock` has expired;
///              the locked funds are returned to `refundAddress`.
///
///         2. There is no admin escape hatch, no `emergencyWithdraw`,
///            and no `pause`. The contract is non-custodial by construction:
///            even the deployer cannot move locked funds.
///
///         3. The `ResolverRegistry` integration gates both who may
///            *create* orders (sybil-resistance) **and** who may *claim*
///            them. If the registry is set, `claimOrder` will revert for
///            any address that is not currently active in the registry —
///            even if that resolver was active when the order was opened.
///            This enforces off-chain resolver removal on-chain. Refunds
///            remain fully permissionless.
///
/// @dev Cross-chain hashlocks use sha256(abi.encodePacked(orderId,
///      preimage)); the order id is uint256-encoded as 32-byte big-endian.
///      This matches the Soroban implementation and prevents a preimage
///      from being replayed against a different order.
contract HTLCEscrow is IHTLCEscrow, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------

    /// @notice Minimum timelock — protects users from accidentally
    ///         creating orders that expire before they can claim.
    uint64 public constant MIN_TIMELOCK = 300;        // 5 minutes
    /// @notice Maximum timelock — protects users from accidentally
    ///         locking funds for unreasonably long periods.
    uint64 public constant MAX_TIMELOCK = 24 * 60 * 60; // 24 hours

    // ---------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------

    /// @notice Optional resolver registry. When non-zero, only an
    ///         active resolver can call `createOrder`. The registry
    ///         can be cleared by setting this to address(0). Once
    ///         cleared, `createOrder` is permissionless.
    /// @dev The registry pointer is immutable after construction. To
    ///      update it deploy a new HTLCEscrow and migrate.
    IResolverRegistry public immutable resolverRegistry;

    /// @notice The minimum safety deposit accepted by the contract.
    ///         The safety deposit incentivises whoever submits the
    ///         claim or refund transaction.
    uint256 public immutable minSafetyDeposit;

    /// @notice Auto-incrementing order id.
    uint256 private _nextOrderId = 1;

    /// @notice Order data, keyed by order id.
    mapping(uint256 => Order) private _orders;

    // ---------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------

    error InvalidAmount();
    error InvalidTimelock();
    error InvalidHashlock();
    error InvalidPreimage();
    error InvalidValue();
    error OrderNotFound();
    error OrderNotClaimable();
    error OrderNotRefundable();
    error NotExpired();
    error Expired();
    error SafetyDepositTooSmall();
    error ResolverNotAuthorised();
    error ClaimResolverNotRegistered();
    error NativeTransferFailed();

    // ---------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------

    /// @param _resolverRegistry Resolver registry to query when creating
    ///        orders. Pass `address(0)` to disable the gate entirely.
    /// @param _minSafetyDeposit Minimum safety deposit in wei.
    constructor(IResolverRegistry _resolverRegistry, uint256 _minSafetyDeposit) {
        resolverRegistry = _resolverRegistry;
        minSafetyDeposit = _minSafetyDeposit;
    }

    // ---------------------------------------------------------------
    // Core HTLC operations
    // ---------------------------------------------------------------

    /// @inheritdoc IHTLCEscrow
    function createOrder(
        address beneficiary,
        address refundAddress,
        address token,
        uint256 amount,
        uint256 safetyDeposit,
        bytes32 hashlock,
        uint64  timelockSeconds
    ) external payable nonReentrant returns (uint256 orderId) {
        if (amount == 0) revert InvalidAmount();
        if (beneficiary == address(0) || refundAddress == address(0)) revert InvalidAmount();
        if (hashlock == bytes32(0)) revert InvalidHashlock();
        if (timelockSeconds < MIN_TIMELOCK || timelockSeconds > MAX_TIMELOCK) revert InvalidTimelock();
        if (safetyDeposit < minSafetyDeposit) revert SafetyDepositTooSmall();

        if (address(resolverRegistry) != address(0)) {
            if (!resolverRegistry.isActive(msg.sender)) revert ResolverNotAuthorised();
        }

        // Pull funds.
        if (token == address(0)) {
            // Native ETH: msg.value must cover amount + safetyDeposit exactly.
            if (msg.value != amount + safetyDeposit) revert InvalidValue();
        } else {
            // ERC20: msg.value must be exactly safetyDeposit (in ETH) +
            // we pull `amount` of the token from msg.sender.
            if (msg.value != safetyDeposit) revert InvalidValue();
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        unchecked {
            orderId = _nextOrderId++;
        }
        uint64 absoluteTimelock = uint64(block.timestamp) + timelockSeconds;

        _orders[orderId] = Order({
            sender: msg.sender,
            beneficiary: beneficiary,
            refundAddress: refundAddress,
            token: token,
            amount: amount,
            safetyDeposit: safetyDeposit,
            hashlock: hashlock,
            timelock: absoluteTimelock,
            createdAt: uint64(block.timestamp),
            finalisedAt: 0,
            status: OrderStatus.Funded,
            preimageKeccak: bytes32(0)
        });

        emit OrderCreated(
            orderId,
            msg.sender,
            beneficiary,
            token,
            amount,
            safetyDeposit,
            hashlock,
            absoluteTimelock
        );
    }

    /// @inheritdoc IHTLCEscrow
    function claimOrder(uint256 orderId, bytes memory preimage) external nonReentrant {
        Order storage order = _orders[orderId];
        // `amount` is a safe existence sentinel: createOrder rejects zero
        // amounts, so an unset entry always has amount == 0. Checking it
        // first keeps an unknown id from being mistaken for a Funded
        // order (OrderStatus.Funded is the zero value) — the same reason
        // the Soroban contract panics with OrderNotFound.
        // Suppress incorrect-equality: Safe because amount == 0 is only true for unset entries.
        // slither-disable-next-line incorrect-equality
        if (order.amount == 0) revert OrderNotFound();
        if (order.status != OrderStatus.Funded) revert OrderNotClaimable();
        if (block.timestamp > order.timelock) revert Expired();

        // Registry gate: if a registry is configured, the caller must be
        // currently active. Removing a resolver from the registry must
        // prevent them from claiming — even for orders opened while they
        // were registered.
        if (address(resolverRegistry) != address(0)) {
            if (!resolverRegistry.isActive(msg.sender)) revert ClaimResolverNotRegistered();
        }

        if (preimage.length == 0) revert InvalidPreimage();

        // Hashlock v1: SHA256(uint256 orderId, big-endian || preimage bytes).
        // Binding the order id prevents a preimage revealed for one order from
        // being replayed against another, and matches the Soroban contract.
        bytes32 sha = sha256(abi.encodePacked(orderId, preimage));
        bytes32 kek = keccak256(preimage);
        if (sha != order.hashlock) revert InvalidPreimage();

        order.status = OrderStatus.Claimed;
        order.finalisedAt = uint64(block.timestamp);
        order.preimageKeccak = kek;

        uint256 amount = order.amount;
        uint256 safetyDeposit = order.safetyDeposit;

        // Locked amount → beneficiary.
        _payout(order.token, order.beneficiary, amount);
        // Safety deposit → whoever submitted the claim.
        if (safetyDeposit > 0) {
            _payout(address(0), msg.sender, safetyDeposit);
        }

        emit OrderClaimed(orderId, msg.sender, _bytesToBytes32(preimage), amount, safetyDeposit);
    }

    /// @inheritdoc IHTLCEscrow
    function refundOrder(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        // See claimOrder: `amount == 0` identifies an unset entry so an
        // unknown id cannot slip through as a no-op refund.
        // Suppress incorrect-equality: Safe because amount == 0 is only true for unset entries.
        // slither-disable-next-line incorrect-equality
        if (order.amount == 0) revert OrderNotFound();
        if (order.status != OrderStatus.Funded) revert OrderNotRefundable();
        if (block.timestamp <= order.timelock) revert NotExpired();

        order.status = OrderStatus.Refunded;
        order.finalisedAt = uint64(block.timestamp);

        uint256 amount = order.amount;
        uint256 safetyDeposit = order.safetyDeposit;

        _payout(order.token, order.refundAddress, amount);
        if (safetyDeposit > 0) {
            _payout(address(0), msg.sender, safetyDeposit);
        }

        emit OrderRefunded(orderId, msg.sender, amount, safetyDeposit);
    }

    // ---------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------

    /// @inheritdoc IHTLCEscrow
    function getOrder(uint256 orderId) external view returns (Order memory) {
        Order memory order = _orders[orderId];
        // Suppress incorrect-equality: Safe because we check order.amount == 0 to verify the existence of the mapping entry.
        // slither-disable-next-line incorrect-equality
        if (order.amount == 0) revert OrderNotFound();
        return order;
    }

    /// @notice Returns the next order id that will be assigned. Useful
    ///         for clients that want to compute the upcoming id without
    ///         simulating a transaction.
    function nextOrderId() external view returns (uint256) {
        return _nextOrderId;
    }

    // ---------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------

    /// @dev Suppress arbitrary-send-eth and low-level-calls: Safe because _payout only transfers native ETH to the validated beneficiary or refundAddress stored in the order structure.
    // slither-disable-next-line arbitrary-send-eth,low-level-calls
    function _payout(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            // Native ETH transfer.
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @dev Suppress assembly: Safe because _bytesToBytes32 only uses assembly to cast a dynamic bytes array to bytes32.
    // slither-disable-next-line assembly
    function _bytesToBytes32(bytes memory data) private pure returns (bytes32 result) {
        if (data.length == 0) return bytes32(0);
        assembly {
            result := mload(add(data, 32))
        }
    }

    // Reject stray ETH.
    receive() external payable {
        revert InvalidValue();
    }
}

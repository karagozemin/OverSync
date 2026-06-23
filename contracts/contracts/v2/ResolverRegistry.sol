// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IResolverRegistry} from "./interfaces/IResolverRegistry.sol";

/// @title ResolverRegistry
/// @notice Open stake/slash registry for OverSync resolvers. Resolvers
///         post a stake of a chosen ERC20 (typically a stablecoin or
///         the project's governance token) to become eligible to fill
///         swap orders.
///
///         Misbehaviour is slashed by the `owner`, which is intended to
///         be a multisig or DAO contract — NOT an EOA. The owner
///         CANNOT spend an honest resolver's stake; the only privileged
///         action is `slash`, which is gated by economic semantics
///         (off-chain governance) and emits an auditable event.
///
///         This contract is intentionally separate from the HTLC: a
///         compromise of the registry cannot move user funds. The HTLC
///         queries `isActive` only as a soft sybil filter for who may
///         create orders.
contract ResolverRegistry is IResolverRegistry, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct ResolverInfo {
        address resolver;
        uint256 stake;
        uint64  registeredAt;
        uint64  lastSlashAt;
        uint256 totalSlashed;
        bool    active;
    }

    /// @notice ERC20 used for staking.
    IERC20 public immutable stakeAsset;

    /// @notice Minimum stake required to be `active`.
    uint256 public minStake;

    /// @notice Address that receives slashed stake.
    address public slashBeneficiary;

    mapping(address => ResolverInfo) private _resolvers;
    address[] private _resolverList;
    mapping(address => uint256) private _resolverIndex; // 1-based

    event Registered(address indexed resolver, uint256 stake);
    event StakeIncreased(address indexed resolver, uint256 added, uint256 newTotal);
    event Unregistered(address indexed resolver, uint256 stakeReturned);
    event Slashed(address indexed resolver, uint256 amount, address beneficiary);
    event MinStakeUpdated(uint256 oldMinStake, uint256 newMinStake);
    event SlashBeneficiaryUpdated(address indexed oldBeneficiary, address indexed newBeneficiary);

    error InvalidAmount();
    error InvalidAddress();
    error AlreadyRegistered();
    error NotRegistered();
    error StakeBelowMinimum();

    constructor(
        IERC20 _stakeAsset,
        uint256 _minStake,
        address _slashBeneficiary,
        address _owner
    ) Ownable(_owner) {
        if (address(_stakeAsset) == address(0) || _slashBeneficiary == address(0) || _owner == address(0)) {
            revert InvalidAddress();
        }
        stakeAsset = _stakeAsset;
        minStake = _minStake;
        slashBeneficiary = _slashBeneficiary;
    }

    /// @notice Register as a resolver by posting `stake` of `stakeAsset`.
    function register(uint256 stake) external nonReentrant {
        if (stake < minStake) revert StakeBelowMinimum();
        if (_resolverIndex[msg.sender] != 0) revert AlreadyRegistered();

        stakeAsset.safeTransferFrom(msg.sender, address(this), stake);

        _resolvers[msg.sender] = ResolverInfo({
            resolver: msg.sender,
            stake: stake,
            registeredAt: uint64(block.timestamp),
            lastSlashAt: 0,
            totalSlashed: 0,
            active: true
        });

        _resolverList.push(msg.sender);
        _resolverIndex[msg.sender] = _resolverList.length; // 1-based

        emit Registered(msg.sender, stake);
    }

    /// @notice Increase an existing resolver's stake.
    function increaseStake(uint256 additional) external nonReentrant {
        if (additional == 0) revert InvalidAmount();
        ResolverInfo storage info = _resolvers[msg.sender];
        if (_resolverIndex[msg.sender] == 0) revert NotRegistered();

        stakeAsset.safeTransferFrom(msg.sender, address(this), additional);
        info.stake += additional;
        if (info.stake >= minStake) {
            info.active = true;
        }

        emit StakeIncreased(msg.sender, additional, info.stake);
    }

    /// @notice Withdraw the entire stake and remove the resolver. The
    ///         caller forfeits their `active` status immediately.
    function unregister() external nonReentrant {
        uint256 idx = _resolverIndex[msg.sender];
        if (idx == 0) revert NotRegistered();
        ResolverInfo memory info = _resolvers[msg.sender];

        delete _resolvers[msg.sender];
        _removeFromList(msg.sender, idx);

        if (info.stake > 0) {
            stakeAsset.safeTransfer(msg.sender, info.stake);
        }

        emit Unregistered(msg.sender, info.stake);
    }

    // ---------------------------------------------------------------
    // Owner (DAO/multisig) actions
    // ---------------------------------------------------------------

    /// @notice Slash a registered resolver. The owner is the only role
    ///         that can call this; the design intent is that `owner` is
    ///         a DAO or multisig that votes on slashing.
    function slash(address resolver, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        ResolverInfo storage info = _resolvers[resolver];
        if (_resolverIndex[resolver] == 0) revert NotRegistered();

        uint256 take = amount > info.stake ? info.stake : amount;
        info.stake -= take;
        info.totalSlashed += take;
        info.lastSlashAt = uint64(block.timestamp);
        if (info.stake < minStake) {
            info.active = false;
        }

        if (take > 0) {
            stakeAsset.safeTransfer(slashBeneficiary, take);
        }

        emit Slashed(resolver, take, slashBeneficiary);
    }

    function setMinStake(uint256 newMinStake) external onlyOwner {
        emit MinStakeUpdated(minStake, newMinStake);
        minStake = newMinStake;
    }

    function setSlashBeneficiary(address newBeneficiary) external onlyOwner {
        if (newBeneficiary == address(0)) revert InvalidAddress();
        emit SlashBeneficiaryUpdated(slashBeneficiary, newBeneficiary);
        slashBeneficiary = newBeneficiary;
    }

    // ---------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------

    /// @inheritdoc IResolverRegistry
    function isActive(address resolver) external view returns (bool) {
        return _resolvers[resolver].active && _resolvers[resolver].stake >= minStake;
    }

    function get(address resolver) external view returns (ResolverInfo memory) {
        return _resolvers[resolver];
    }

    function list() external view returns (address[] memory) {
        return _resolverList;
    }

    function listLength() external view returns (uint256) {
        return _resolverList.length;
    }

    // ---------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------

    function _removeFromList(address resolver, uint256 idx) private {
        uint256 i = idx - 1; // 0-based
        uint256 last = _resolverList.length - 1;
        if (i != last) {
            address swap = _resolverList[last];
            _resolverList[i] = swap;
            _resolverIndex[swap] = i + 1;
        }
        _resolverList.pop();
        delete _resolverIndex[resolver];
    }
}

# Failure Code Catalog

This document defines the stable, machine-readable failure codes used across the OverSync system (Coordinator, Resolver, and Frontend) for order lifecycle errors.

## Guidelines

All lifecycle failures must be assigned one of the codes in this catalog. Do not use ad-hoc strings for API error responses.

## Catalog

| Code | Meaning | Emitted By | Condition | Default User Message | Category |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ORDER_EXPIRED` | Order exceeded deadline | Coordinator | `currentTime > order.deadline` | The order has expired and can now be refunded. | user-actionable |
| `INSUFFICIENT_LIQUIDITY` | Not enough funds to fill | Resolver | Resolver cannot provide requested amount | Insufficient liquidity to complete the order at this time. | system-transient |
| `RESOLVER_TIMEOUT` | Resolver failed to act | Coordinator | Resolver did not settle in time | The resolver failed to respond within the expected time. | system-transient |
| `SETTLEMENT_REJECTED` | Chain rejected settlement | Resolver/Coordinator | On-chain transaction reverted | The settlement transaction was rejected by the network. | permanent |
| `INVALID_SIGNATURE` | Signature verification failed | Coordinator | Invalid user/resolver signature | The provided signature is invalid. | user-actionable |
| `CHAIN_RPC_UNAVAILABLE` | RPC node unresponsive | Coordinator/Resolver | Connectivity issues with chain node | The blockchain network is currently unreachable. | system-transient |
| `VALIDATION_FAILED` | Request failed validation | Coordinator | Invalid address, mismatched chains, etc. | The order failed validation checks. | user-actionable |
| `ORDER_NOT_FOUND` | Order does not exist | Coordinator | Public ID not found in DB | The requested order could not be found. | permanent |
| `INTERNAL_ERROR` | Unexpected system failure | Coordinator | Uncaught exception / 500 error | An unexpected internal error occurred. | permanent |

## Categories

- **user-actionable**: The user can take a specific action to resolve the issue (e.g., fix an address, wait for expiry).
- **system-transient**: The error is likely temporary and may resolve itself upon retry.
- **permanent**: The error is fatal for this specific order; no further action will change the outcome.

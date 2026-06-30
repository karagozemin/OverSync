# Ecosystem Integration Path

This document outlines how OverSync integrates with the broader Stellar bridging ecosystem. OverSync is designed not as an isolated island, but as a specialized HTLC settlement layer that complements existing and upcoming cross-chain infrastructure.

## Complementarity with CCTP-style USDC Movement

OverSync is complementary to CCTP (Cross-Chain Transfer Protocol). CCTP provides an excellent, fast path for burn-and-mint transfers of **USDC** using Circle's attestation service. However, CCTP is limited to USDC. OverSync natively handles atomic swaps of other assets (such as XLM ↔ ETH) without relying on a centralized attester.

A complete user journey might use CCTP for moving USDC efficiently and OverSync for trading native chain assets via trust-minimized atomic swaps. They do not compete; instead, they solve different parts of the cross-chain problem.

## Differences from Validator-Set or Wrapped-Asset Bridges

Generalist bridges like Axelar Interchain Token Service (ITS) or Allbridge operate on a **validator-set trust model**. They lock an asset on the source chain, use a threshold signature from a validator committee, and mint a wrapped representation on the destination chain.

OverSync differs fundamentally by avoiding wrapping and validator committees entirely:
- **No Wrapped Assets:** OverSync delivers the native asset on the destination chain.
- **Trust-Minimized:** Security relies purely on the cryptographic guarantees of HTLCs (Hash Time Locked Contracts) and the underlying chain consensus, not on the honesty of a multisig guardian set.

## Adapter Isolation and Feature Flagging

As we build adapters to interact with tools like CCTP or Axelar, it is critical that the core HTLC logic remains strictly isolated. 

**Rule:** Every future ecosystem adapter must be deployed behind an explicit feature flag or launch gate. 
- Core HTLC settlement must not depend on the availability or security of external bridge contracts.
- Experimental integrations must not put mainnet funds at risk if a third-party bridge encounters downtime.
- Adapters should be treated as composable modules rather than embedded core logic.

## Integration Surfaces

The OverSync architecture provides clear boundaries for integration.

**Currently Existing Integration Surfaces:**
- **SDK asset mappings:** Located in `packages/sdk`, standardizing how assets are recognized across networks.
- **Resolver runner:** The off-chain worker in `resolver/` that facilitates Fusion+ style order execution.
- **Freighter hook:** Frontend integration (`frontend/src/hooks/useFreighter.ts`) for Stellar wallet interactions.
- **Soroban contracts:** Core on-chain HTLC logic in the `contracts/` and `soroban/` directories.

**Explicitly Future Work (Planned):**
- Axelar ITS adapter.
- CCTP composable fast path.
- Deeper wallet and DEX protocol integration.

## Integration Readiness Matrix

| Integration Target | Current Status | Repo Owner/Module | Risk Level | Test Artifact Needed Before Enabling | Launch Gate |
|---|---|---|---|---|---|
| **Freighter Wallet** | Shipped (Testnet) | `frontend/hooks` | Low | E2E browser test passing | General Availability |
| **HTLC Contracts** | Shipped (Testnet) | `contracts/` & `soroban/` | High | Security audit report | Mainnet V1 |
| **SDK Asset Mappings** | Shipped (Testnet) | `packages/sdk` | Low | Unit tests coverage >90% | Mainnet V1 |
| **Resolver Runner** | Shipped (Testnet) | `resolver/` | Medium | Load test simulation | Mainnet V1 |
| **CCTP Fast Path** | Future Work | TBD | Medium | Circle testnet E2E flow | Feature Flag: `ENABLE_CCTP` |
| **Axelar ITS Adapter** | Future Work | TBD | High | Axelar testnet deployment | Feature Flag: `ENABLE_AXELAR` |
| **DEX Routing** | Future Work | TBD | Medium | Integration tests with DEX | Feature Flag: `ENABLE_DEX` |

# OverSync — Investor Overview

> **Documentation:** For the full technical architecture, threat model, and audit roadmap, see
> [`ARCHITECTURE.md`](../ARCHITECTURE.md) and [`docs/`](.) — in particular
> [`TRUST_MODEL.md`](TRUST_MODEL.md), [`SECURITY.md`](SECURITY.md),
> [`TRACTION.md`](TRACTION.md), and [`REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md).

---

## Problem

Bridges have caused some of the largest losses in DeFi (Ronin $625M, Wormhole $325M, Multichain $231M). The common failure pattern is an off-chain validator quorum that signs proofs of locks — once compromised, wrapped tokens on the destination chain are minted without a real lock ([`README.md`](../README.md):39-46).

OverSync gives up the convenience of validator-set bridging in exchange for a strictly weaker trust assumption: no privileged signer exists in the HTLC ([`README.md`](../README.md):45-48).

---

## Target Users

OverSync v2 targets four segments ([`docs/TRACTION.md`](TRACTION.md):16-55):

1. **Trust-conscious power users** who explicitly want HTLC settlement rather than validator-set attestation.
2. **Stellar-native protocols** (DEXes, lending markets) seeking ETH liquidity without wrapped representations.
3. **1inch Fusion+ resolver operators** who can extend their EVM resolver pattern to Stellar.
4. **Treasuries and OTC desks** doing $25k–$500k cross-chain swaps where per-swap gas overhead is irrelevant compared to trust savings.

---

## Why Stellar / Soroban

OverSync is built as the **first native Soroban HTLC bridge for Stellar** ([`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md):70-72). The Soroban HTLC contract enforces sha256 hashlock + ledger-timestamp timelock with permissionless refunds ([`soroban/contracts/htlc/src/lib.rs`](../soroban/contracts/htlc/src/lib.rs)). All swap state lives on the Soroban ledger — there is no shadow accounting in the coordinator ([`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md):59-61).

The EVM-side contracts and resolver pattern mirror 1inch's Fusion+ protocol, so EVM resolver operators can integrate Stellar with minimal new tooling ([`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md):74-77).

---

## Trust Model

User funds are locked in HTLC contracts on both chains. Locked funds can only move under two on-chain conditions ([`README.md`](../README.md):228-241):

1. A caller submits a preimage matching the hashlock, before timelock expiry.
2. Any caller invokes `refund` after timelock — funds return to the original `refundAddress` (always the user).

There is **no validator set, no attester, no admin escape hatch**. The coordinator never signs a transaction that could move user funds. Resolvers stake into the on-chain `ResolverRegistry`; misbehaviour is slashable ([`docs/TRUST_MODEL.md`](TRUST_MODEL.md):7-25, [`README.md`](../README.md):237-241).

The HTLC contracts have no admin role with fund-moving authority — verified by the test `non-custodial guarantees > contract has no admin escape hatch` ([`docs/SECURITY.md`](SECURITY.md):57-58).

Compared to the current architecture: the coordinator is untrusted (can withhold service but cannot steal funds), resolvers are untrusted (can refuse to fill but cannot keep user funds), and the `ResolverRegistry` admin is trusted for liveness only (intended to become a multisig before mainnet) ([`ARCHITECTURE.md`](../ARCHITECTURE.md):695-716).

---

## Current Status

**v2 is deployed on testnet** (Sepolia + Stellar testnet) as the live design. The public frontend is **testnet-only** — the network selector shows **Mainnet Coming** and does not expose the legacy v1 mainnet path until v2 completes its independent audit ([`README.md`](../README.md):17-24).

| Component | Status |
|---|---|
| Soroban HTLC contract | Live on Stellar testnet; 10 unit tests |
| EVM HTLCEscrow + ResolverRegistry | Live on Sepolia; 21 Hardhat tests |
| Open resolver network | Reference runner + Docker image shipped |
| Coordinator (modular rewrite) | SQLite-backed; REST + WebSocket |
| Frontend (v2) | React/Vite, testnet-only; real on-chain refund dialog |
| Mainnet | **Not deployed** — gated on audit completion (Q1 2027 target) |

Sources: [`README.md`](../README.md):60-94, [`ARCHITECTURE.md`](../ARCHITECTURE.md):720-731.

Smart contract addresses are published in the README and verifiable on Sepolia Etherscan and Stellar Expert ([`README.md`](../README.md):66-73).

---

## Traction / Evidence

- **Testnet deployment** with live contracts on Sepolia and Stellar testnet ([`README.md`](../README.md):62-73).
- **49 automated tests** across Rust (Soroban), Solidity (Hardhat), and TypeScript, CI-enforced in GitHub Actions ([`README.md`](../README.md):85-95).
- **End-to-end test harness** for cross-chain hashlock parity between EVM and Soroban ([`README.md`](../README.md):207-212).
- **Architecture documentation** ([`ARCHITECTURE.md`](../ARCHITECTURE.md)): 824-line exhaustive document covering design goals, atomic-swap flows, refund mechanisms, failure mode catalogue, and auditor checklist.
- **SCF resubmission**: Stellar Community Fund #40 resubmission with a tranche-gated $40,000 budget request ([`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md):171-186).
- **Testnet demo** published at `https://testnet.oversync.app` ([`docs/TRACTION.md`](TRACTION.md):120).
- **Public dashboard of testnet metrics** (orders, refunds, latency) planned as a continuous Grafana-style page ([`docs/TRACTION.md`](TRACTION.md):124).

---

## Roadmap / Ask

The roadmap ([`ROADMAP.md`](../ROADMAP.md)) follows an audit-first launch plan:

| Period | Milestone | Status |
|---|---|---|
| Q2 2026 | v2.0 rebuild (8 phases shipped) | ✅ Complete |
| Q3 2026 | Audit prep: fuzz testing, Slither CI gate, differential harness, load test, Postgres migration, observability | 🛠 In progress |
| Q4 2026 | Independent audits (EVM + Soroban), remediation, bug bounty, multisig migration | 🗓 Scheduled |
| Q1 2027 | Mainnet launch + Axelar ITS adapter + CCTP v2 composable fast path + first 3 community resolvers | 🗓 Scheduled |
| Q2–Q3 2027 | v2.1 deepening (partial fills, multi-asset, DAO governance, resolver auction) | 🗓 Scheduled |

**Exit criterion for mainnet:** Two public audits, all medium+ findings remediated, bounty open 14 days with no critical reports ([`ROADMAP.md`](../ROADMAP.md):74-75).

**Funding ask:** The current request is a $40,000 tranche-gated SCF grant covering audit preparation ($8,000), Soroban hardening ($7,000), coordinator productionisation ($5,000), bug bounty bootstrap ($5,000), resolver onboarding ($9,000), and beta program insurance ($6,000) ([`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md):171-186). A bootstrap grant pool for resolver network coldstart is part of the Tranche 2 funding ask ([`ROADMAP.md`](../ROADMAP.md):139).

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| **Audit findings push mainnet launch** | Mainnet ships when audits are clean; no hard date is pre-announced ([`ROADMAP.md`](../ROADMAP.md):137). |
| **Bridge security — smart contract vulnerability** | All contracts are unaudited pre-mainnet. Audit preparation includes Foundry fuzz + invariant suite, Slither CI gate, and differential testing across both chains ([`docs/SECURITY.md`](SECURITY.md):62-74). Independent audits are scheduled for Q4 2026 before any mainnet deployment ([`ROADMAP.md`](../ROADMAP.md):64-75). |
| **Protocol maturity — new Soroban deployment** | Contracts have been live on testnet since the v2 rebuild. The Soroban HTLC and resolver registry are exercised by 10 and 6 unit tests respectively ([`README.md`](../README.md):87-94). |
| **Solo-team bus factor** | Open resolver protocol means the bridge keeps working even if the core team is unavailable; CI and documentation lower the onboarding bar ([`ROADMAP.md`](../ROADMAP.md):138). Team expansion is planned as a grant milestone ([`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md):161-163). |
| **Resolver network coldstart** | A bootstrap grant pool is included in the funding ask to incentivise initial community resolvers ([`ROADMAP.md`](../ROADMAP.md):139). |
| **CCTP v2 Stellar mainnet timing slips** | Independent of the OverSync roadmap; only affects Q2–Q3 2027 USDC composability ([`ROADMAP.md`](../ROADMAP.md):135). |

Sources: [`ROADMAP.md`](../ROADMAP.md):131-139, [`docs/SECURITY.md`](SECURITY.md):7-15, [`docs/TRUST_MODEL.md`](TRUST_MODEL.md):91-105.

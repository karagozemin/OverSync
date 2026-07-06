# Roadmap Dependency Tracker

This document tracks the external dependencies, assumptions, and critical timelines that impact the [OverSync Roadmap](../ROADMAP.md). Unlike internal tasks, these items depend on third-party schedules, external network launches, or ecosystem readiness.

---

## Document Legend & Status Key

- **🔴 Critical Blocker**: Directly halts mainnet launch or core functionality.
- **🟡 At Risk**: Slippage affects adapters or optional ecosystem features, but core mainnet can launch.
- **🟢 On Track**: Proceeding as planned or stable.

---

## 1. External Infrastructure & Protocol Blockers

These are protocols and networks owned by external entities. Delays in their timelines directly impact the timeline of OverSync adapters and feature sets.

| Dependency | Current Status | Owner / Source of Truth | Impact if Delayed | Mitigation | Last Checked | Related Milestone |
|---|---|---|---|---|---|---|
| **Circle CCTP v2 on Stellar Mainnet** | 🟢 **Testnet active** since April 2026. Mainnet target Q3/Q4 2026. | [Circle Developer Docs](https://developers.circle.com/) / Circle Blog | USDC composable fast-path adapter cannot be enabled on mainnet. | Keep the adapter behind a feature flag (`VITE_CCTP_ENABLED=false`). Swaps revert to standard HTLC routes. | June 28, 2026 | [Q1 2027 Mainnet Launch](../ROADMAP.md#q1-2027---mainnet-launch-and-not-isolated-composability) |
| **Axelar ITS API Surface Stability** | 🟢 **Mainnet active** since Feb 16, 2026. Current API is stable. | [Axelar Network Docs](https://docs.axelar.dev/) | Axelar ITS destination leg adapter requires API rewrite. | Adapter code is isolated; we pin dependencies to verified SDK version `v1.2.x` to prevent breaking changes. | June 28, 2026 | [Q1 2027 Mainnet Launch](../ROADMAP.md#q1-2027---mainnet-launch-and-not-isolated-composability) |
| **Stellar/Soroban Core & Tooling (v22+)** | 🟢 **Soroban live on Mainnet**. SDKs and CLI are stable. | [Stellar Dev Foundation](https://stellar.org/) / SDF Releases | Build toolchain breakage, contract compiler mismatch. | Pin `cargo-contract`, Soroban CLI, and `soroban-sdk` versions in Cargo.toml/Makefile. Avoid upgrading pre-release core. | June 28, 2026 | [Q2 2026 v2.0 rebuild](../ROADMAP.md#q2-2026---v20-rebuild-current-quarter) |

---

## 2. Audits & Launch Hardening

Third-party security audits are strict gating items for mainnet contract deployment.

| Dependency | Current Status | Owner / Source of Truth | Impact if Delayed | Mitigation | Last Checked | Related Milestone |
|---|---|---|---|---|---|---|
| **Audit Firm A (EVM Contracts)** | 🟡 **Scheduling phase**. Finalizing Q4 booking slot. | Audit Firm A / Internal Security Lead | Delays EVM contract deployments to mainnet. Q1 2027 launch shifts. | Prepare all scope items in Q3, run internal dry-run reviews, and submit codebase early. Engage alternate firm. | June 28, 2026 | [Q4 2026 Independent Audits](../ROADMAP.md#q4-2026---independent-audits) |
| **Audit Firm B (Soroban Contracts)** | 🟡 **Proposal review**. Soroban-native audit expertise is limited. | Audit Firm B / Internal Security Lead | Delays Soroban contract deployments to mainnet. | Run comprehensive local simulation suite and invariant fuzzing to reduce potential audit cycles. | June 28, 2026 | [Q4 2026 Independent Audits](../ROADMAP.md#q4-2026---independent-audits) |

---

## 3. Operations & Onboarding

Dependencies related to service providers, operators, and ecosystem actors required for the network to function at launch.

| Dependency | Current Status | Owner / Source of Truth | Impact if Delayed | Mitigation | Last Checked | Related Milestone |
|---|---|---|---|---|---|---|
| **EVM & Stellar RPC Providers** | 🟢 **Stable** (using Alchemy/Infura for EVM, SDF public/Blockdaemon for Soroban). | Infrastructure Providers | Relayer and coordinator service downtime. | Implement fallback RPC providers in Relayer/Coordinator config (`RPC_FALLBACK_URLS`). | June 28, 2026 | [Q1 2027 Mainnet Launch](../ROADMAP.md#q1-2027---mainnet-launch-and-not-isolated-composability) |
| **Resolver Network Coldstart** | 🟡 **Onboarding guidelines published** ([docs/RESOLVERS.md](RESOLVERS.md)). | Ecosystem Manager / [docs/RESOLVERS.md](RESOLVERS.md) | Insufficient resolver liquidity at launch leads to slow swaps or high slippage. | Bootstrap grant pool via Tranche 2 funding (see [docs/REVIEW_RESPONSE.md](REVIEW_RESPONSE.md)) to incentivize initial 3 community resolvers. | June 28, 2026 | [Q1 2027 Mainnet Launch](../ROADMAP.md#q1-2027---mainnet-launch-and-not-isolated-composability) |

---

> [!IMPORTANT]
> dates listed in this document reflect current expectations based on publicly available information. No speculative dates have been guaranteed without a confirmed SLA/contract from the respective owner.

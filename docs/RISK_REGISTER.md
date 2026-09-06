# OverSync — Risk Register

> **Audience:** Investors, SCF reviewers, grant committees, and the core team.
> **Purpose:** Single source of truth for every material risk the project faces, with concrete mitigations, current evidence, and next actions.
> **Status (June 2026):** v2 live on Sepolia + Stellar testnet; mainnet gated on independent audit (target Q1 2027).

---

## Quick navigation

| Category | Risks |
|---|---|
| [1. Smart contract and audit risk](#1-smart-contract-and-audit-risk) | R-001, R-002, R-003 |
| [2. Resolver cold-start and liquidity risk](#2-resolver-cold-start-and-liquidity-risk) | R-004, R-005, R-006 |
| [3. RPC / provider reliability risk](#3-rpc--provider-reliability-risk) | R-007, R-008 |
| [4. Stellar ecosystem dependency risk](#4-stellar-ecosystem-dependency-risk) | R-009, R-010 |
| [5. Mainnet launch timing risk](#5-mainnet-launch-timing-risk) | R-011, R-012 |
| [6. Bridge regulatory / compliance ambiguity](#6-bridge-regulatory--compliance-ambiguity) | R-013, R-014 |
| [7. Solo-team / bus-factor risk](#7-solo-team--bus-factor-risk) | R-015, R-016 |

---

## 1. Smart contract and audit risk

### R-001 — Contracts unaudited pre-mainnet

| Field | Value |
|---|---|
| **Category** | Smart contract and audit risk |
| **Risk** | All four smart contracts (EVM HTLCEscrow, EVM ResolverRegistry, Soroban HTLC, Soroban ResolverRegistry) are **unaudited**. A critical vulnerability in any contract could lead to loss of user funds or resolver stakes. |
| **Likelihood** | **Certain** (by design — audit is scheduled post-testnet) |
| **Impact** | **High** — undiscovered bug could break core invariants |
| **Mitigation** | Mainnet is hard-gated on two independent audit reports (EVM + Soroban). Pre-audit hardening is underway (Foundry fuzz, Slither CI gate, differential test harness). All contracts are immutable with no admin escape hatch — an audit finding post-deploy would require a new deployment, not a silent patch. |
| **Current evidence** | Audit preparation checklist: 9 of 12 items complete. See [`docs/SECURITY.md`](SECURITY.md#audit-preparation-checklist). |
| **Owner / action** | Core team — engage two audit firms in Q4 2026 per [`ROADMAP.md`](../ROADMAP.md#q4-2026----independent-audits). |
| **Next action** | Complete remaining pre-audit items: differential test harness (Q3 2026). Tracked in [`ROADMAP.md`](../ROADMAP.md#q3-2026--audit-preparation-and-launch-hardening). |

### R-002 — Undiscovered smart contract bug survives static analysis

| Field | Value |
|---|---|
| **Category** | Smart contract and audit risk |
| **Risk** | Foundry fuzz + invariant tests and Slither cannot prove absence of all bugs. A vulnerability that slips through both CI gates and one or both audits could be exploited before a fix is deployed. |
| **Likelihood** | **Low** (mitigated by layered validation) |
| **Impact** | **Critical** — loss of user funds or resolver stakes |
| **Mitigation** | Bug bounty programme opens after audits (Immunefi-style). Contracts are immutable with no proxy — any exploit requires deploying new contracts and migrating, but user funds in existing HTLCs are protected by timelock semantics (exploited contracts refund after timelock). Incident response runbook exists at [`docs/INCIDENT_RESPONSE_RUNBOOK.md`](INCIDENT_RESPONSE_RUNBOOK.md). |
| **Current evidence** | Slither CI gate at [`.github/workflows/contracts.yml`](../.github/workflows/contracts.yml). Foundry fuzz suite at [`contracts/test/foundry/HTLCEscrow.t.sol`](../contracts/test/foundry/HTLCEscrow.t.sol). Bug bounty plan at [`docs/SECURITY.md#bug-bounty`](SECURITY.md#bug-bounty). |
| **Owner / action** | Core team — launch bug bounty within 14 days of audit report publication. |
| **Next action** | File issue: *Define bug bounty scope, severity rubric, and payout tiers*. |

### R-003 — Differential test gap (hashlock parity unverified across chains)

| Field | Value |
|---|---|
| **Category** | Smart contract and audit risk |
| **Risk** | The EVM and Soroban HTLC contracts are tested independently with separate unit-test suites. A subtle divergence in hashlock behaviour between Solidity `sha256` and Soroban `sha256` could cause an order that is valid on one chain to be unclaimable on the other. |
| **Likelihood** | **Present** (scheduled for Q3 2026) |
| **Impact** | **Medium** — stuck orders requiring timelock expiry and refund |
| **Mitigation** | Each chain has independent unit tests (10 Soroban, 15 EVM) covering the hashlock flow. SDK provides a shared `computeHashlock` function used by both test suites. Cross-chain differential test harness is a planned Q3 2026 milestone. No user funds at risk — stuck orders always refund to the user after timelock. |
| **Current evidence** | 10 Soroban unit tests, 15 EVM Hardhat tests, 8 SDK tests. See [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md#12-status-table) for the full implementation status table. |
| **Owner / action** | Core team — implement `e2e/cross-chain.test.ts` that drives in-memory simulators of both chains. |
| **Next action** | Tracked in [`ROADMAP.md § Q3 2026`](../ROADMAP.md#q3-2026--audit-preparation-and-launch-hardening). File issue: *Implement cross-chain differential test harness*. |

---

## 2. Resolver cold-start and liquidity risk

### R-004 — Resolver network cold-start

| Field | Value |
|---|---|
| **Category** | Resolver cold-start and liquidity risk |
| **Risk** | At mainnet launch, there may be zero or very few community resolvers staked in the registry. Users see "No resolvers available" and cannot execute swaps (liveness failure, not fund-safety failure). |
| **Likelihood** | **Moderate** |
| **Impact** | **Medium** — bridge is non-functional at launch until resolver participation reaches critical mass |
| **Mitigation** | Bootstrap grant pool of $9,000 in Tranche 2 for first 3 community resolvers. Open resolver protocol (anyone can stake and run the open-source runner). Team-operated reference resolver to ensure baseline liveness during initial weeks. Resolver onboarding documentation at [`docs/RESOLVERS.md`](RESOLVERS.md). |
| **Current evidence** | Open-source resolver runner + Docker image at [`resolver/`](../resolver/). Onboarding packet at [`docs/RESOLVER_ONBOARDING_PACKET.md`](RESOLVER_ONBOARDING_PACKET.md). |
| **Owner / action** | Core team — recruit 3 community resolvers before mainnet. |
| **Next action** | Tracked in [`ROADMAP.md § Q1 2027`](../ROADMAP.md#q1-2027--mainnet-launch-and-not-isolated-composability). File issue: *Resolver recruitment programme and grant terms*. |

### R-005 — Resolver collusion to ignore orders

| Field | Value |
|---|---|
| **Category** | Resolver cold-start and liquidity risk |
| **Risk** | A small set of resolvers could tacitly coordinate to ignore certain orders (e.g. small amounts, specific assets), creating a liveness gap for those users. Users cannot force a resolver to fill their order. |
| **Likelihood** | **Low** (rational resolvers compete for fees) |
| **Impact** | **Low** — users can self-resolve by running their own resolver, or wait for timelock refund |
| **Mitigation** | Anyone can run a resolver (open permissionless registry). Users can self-resolve by staking and running the open-source runner. The coordinator broadcasts orders to all registered resolvers simultaneously — no single resolver can suppress an order. |
| **Current evidence** | Docs at [`docs/RESOLVERS.md`](RESOLVERS.md) and [`docs/TRUST_MODEL.md`](TRUST_MODEL.md). Coordinator order broadcast in [`coordinator/src/services/order-service.ts`](../coordinator/src/services/order-service.ts). |
| **Owner / action** | Core team — monitor resolver fill rates post-launch; consider minimum-fill-rate slashing if resolver set becomes oligopolistic. |
| **Next action** | File issue: *Define resolver performance metrics and potential slashing conditions for liveness failure*. |

### R-006 — `ResolverRegistry.owner` / admin is a single EOA (slashing risk)

| Field | Value |
|---|---|
| **Category** | Resolver cold-start and liquidity risk |
| **Risk** | The `ResolverRegistry` owner on EVM (deployer EOA) and admin on Soroban (deployer account) can unilaterally slash any resolver's stake or change the slash beneficiary. A compromised key could destroy resolver capital. |
| **Likelihood** | **Low** (testnet only; mitigated before mainnet) |
| **Impact** | **High** — resolver stakes could be stolen if replicated to mainnet |
| **Mitigation** | Migration to 2-of-3 Safe (EVM) and 2-of-3 Stellar multisig (Soroban) is scheduled for Q4 2026, before audit reports are published. User HTLC funds are unaffected — slashing only affects resolver stakes. Full plan at [`docs/TRUST_MODEL.md`](TRUST_MODEL.md). |
| **Current evidence** | See [`docs/TRUST_MODEL.md`](TRUST_MODEL.md) for the per-actor threat analysis and multisig migration plan. |
| **Owner / action** | Core team — execute multisig migration in Q4 2026. |
| **Next action** | Tracked in [`ROADMAP.md § Q4 2026`](../ROADMAP.md#q4-2026----independent-audits). File issue: *Create Safe deployment and ownership transfer scripts*. |

---

## 3. RPC / provider reliability risk

### R-007 — Public Soroban / Ethereum RPC rate-limits during high traffic

| Field | Value |
|---|---|
| **Category** | RPC / provider reliability risk |
| **Risk** | Public RPC endpoints (Soroban testnet RPC, Sepolia public RPC, Ethereum mainnet public RPC) impose rate limits that could delay order claims or refunds during congestion or a memecoin-driven demand spike. |
| **Likelihood** | **Moderate** |
| **Impact** | **Medium** — delayed claims and refunds (liveness, not fund safety) |
| **Mitigation** | Coordinator uses a round-robin pool of RPC endpoints (Alchemy, QuickNode, public). Resolver runner supports configurable RPC endpoints. On-chain refund is permissionless — any user can call `refundOrder` via any RPC, including their own. Watchdog refund scanner runs on a separate RPC fallback path. |
| **Current evidence** | RPC configuration in [`coordinator/src/config.ts`](../coordinator/src/config.ts) and [`resolver/src/config.ts`](../resolver/src/config.ts). |
| **Owner / action** | Core team — add monitoring for RPC failure rates and alert when fallback is active. |
| **Next action** | File issue: *RPC health monitoring dashboard and automatic failover metrics*. |

### R-008 — Coordinator DDoS or persistent outage

| Field | Value |
|---|---|
| **Category** | RPC / provider reliability risk |
| **Risk** | The reference coordinator (hosted on Render) suffers a DDoS attack or extended platform outage. Users cannot discover resolvers, get quotes, or track order status through the frontend. |
| **Likelihood** | **Low** |
| **Impact** | **Low** — liveness only; funds are never at risk |
| **Mitigation** | Cloudflare + rate-limiting in front of the coordinator. Even with coordinator entirely offline, users can: (1) refund directly from the HTLC contracts after timelock, (2) interact with contracts via block explorers, (3) run their own coordinator instance from source. The coordinator holds no keys that can move user funds. |
| **Current evidence** | Runbook at [`docs/INCIDENT_RESPONSE_RUNBOOK.md#coordinator-outage`](INCIDENT_RESPONSE_RUNBOOK.md#coordinator-outage). Coordinator architecture at [`coordinator/README.md`](../coordinator/README.md). |
| **Owner / action** | Core team — implement coordinator health dashboard and publish SLA metrics. |
| **Next action** | Tracked in [`docs/METRICS_SCHEMA.md`](METRICS_SCHEMA.md). |

---

## 4. Stellar ecosystem dependency risk

### R-009 — CCTP v2 Stellar mainnet timing slips

| Field | Value |
|---|---|
| **Category** | Stellar ecosystem dependency risk |
| **Risk** | Circle's CCTP v2 Stellar mainnet deployment (required for the fast-path USDC + XLM composability feature) slips beyond Q1 2027, delaying the CCTP adapter feature. |
| **Likelihood** | **Possible** (external dependency outside project control) |
| **Impact** | **Low** — affects only the CCTP v2 fast-path feature, which is isolated behind a feature flag. The core HTLC bridge is independent and unaffected. |
| **Mitigation** | CCTP v2 fast-path gated behind a feature flag and not part of the core bridge trust model. OverSync operates without CCTP v2 — the adapter is a UX enhancement, not a required dependency. |
| **Current evidence** | Roadmap dependency at [`docs/ROADMAP_DEPENDENCIES.md`](ROADMAP_DEPENDENCIES.md). Feature flag in [`frontend/src/config/networks.ts`](../frontend/src/config/networks.ts). |
| **Owner / action** | Core team — monitor Circle's Stellar roadmap; if CCTP v2 slips > 6 months, decouple the feature into a separate post-launch milestone. |
| **Next action** | File issue: *CCTP v2 adapter — dependency tracking and decoupling plan*. |

### R-010 — Soroban platform maturity risk

| Field | Value |
|---|---|
| **Category** | Stellar ecosystem dependency risk |
| **Risk** | Soroban is a relatively new smart-contract platform. A bug in the Soroban host environment, Stellar Core, or the Stellar RPC layer could disrupt contract execution, delay transactions, or (in extreme cases) cause state inconsistencies. |
| **Likelihood** | **Low** (Soroban is post-Beta and mainnet-stable since 2024) |
| **Impact** | **Medium** — potential liveness disruption or stuck orders on the Stellar side |
| **Mitigation** | EVM-side refund path is always available independent of Stellar network health. User XLM stuck on Stellar-side HTLC due to host bug can be recovered if Stellar network recovers before timelock expiry. The Soroban contracts are minimal in surface area (~200 lines each), reducing platform-attack surface. |
| **Current evidence** | Contract source: [`soroban/contracts/htlc/src/lib.rs`](../soroban/contracts/htlc/src/lib.rs) (196 lines), [`soroban/contracts/resolver-registry/src/lib.rs`](../soroban/contracts/resolver-registry/src/lib.rs) (310 lines). |
| **Owner / action** | Core team — monitor Stellar core releases and Soroban changelogs; test against each new protocol version before upgrading. |
| **Next action** | File issue: *Soroban version compatibility test matrix in CI*. |

---

## 5. Mainnet launch timing risk

### R-011 — Audit findings push Q1 2027 mainnet target

| Field | Value |
|---|---|
| **Category** | Mainnet launch timing risk |
| **Risk** | Independent audits uncover medium or high severity findings that require remediation and re-audit, pushing the mainnet launch past Q1 2027. |
| **Likelihood** | **Possible** |
| **Impact** | **Low** — funds are safe on testnet; mainnet delay is a timeline risk, not a fund-safety risk |
| **Mitigation** | No hard pre-announced mainnet date. Mainnet is gated on verifiable criteria (audit reports public, all medium+ findings remediated, bug bounty open 14+ days with no critical reports, multisig live, ≥3 resolvers). Team has runway through 2027 (see [`docs/RUNWAY_AND_HIRING_PLAN.md`](RUNWAY_AND_HIRING_PLAN.md)). |
| **Current evidence** | Exit criteria in [`ROADMAP.md`](../ROADMAP.md#q1-2027--mainnet-launch-and-not-isolated-composability). |
| **Owner / action** | Core team — reserve budget for one remediation + re-audit cycle. |
| **Next action** | Tracked in [`ROADMAP.md`](../ROADMAP.md). |

### R-012 — Team expansion or retention delays milestones

| Field | Value |
|---|---|
| **Category** | Mainnet launch timing risk |
| **Risk** | Difficulty hiring or retaining engineers with Solidity + Soroban + TypeScript cross-stack skills delays audit preparation or mainnet deliverables. |
| **Likelihood** | **Low** (single core contributor in place; auditable deliverables are well-defined) |
| **Impact** | **Medium** — timeline slippage on non-critical-path items |
| **Mitigation** | All critical deliverables (audit prep, coordinator productionisation, resolver tooling) are structured as fixed-scope milestones deliverable by a single engineer. Onboarding documentation and CI reduce contributor friction for PR-based contributions. See [`CONTRIBUTING.md`](../CONTRIBUTING.md). |
| **Current evidence** | Hiring plan at [`docs/RUNWAY_AND_HIRING_PLAN.md`](RUNWAY_AND_HIRING_PLAN.md). |
| **Owner / action** | Core team — initiate hiring search in Q3 2026 to overlap with current contributor before audit phase. |
| **Next action** | File issue: *Technical writer / engineer contractor scope for Q3 2026 deliverables*. |

---

## 6. Bridge regulatory / compliance ambiguity

### R-013 — Securities classification of resolver stakes

| Field | Value |
|---|---|
| **Category** | Bridge regulatory / compliance ambiguity |
| **Risk** | The minimum stake and safety deposit mechanisms could be interpreted as investment contracts under the Howey test in certain jurisdictions, exposing the project to securities-law risk. |
| **Likelihood** | **Low** (stakes are functional collateral, not profit-seeking investments) |
| **Impact** | **High** — regulatory action could require shutdown of frontend or coordinator services |
| **Mitigation** | Stakes are refundable on demand (resolver can unregister and withdraw at any time). No profit-sharing or dividend mechanism. Safety deposit is returned in full after order completion. Legal counsel review is scheduled before mainnet. See open questions in [`docs/COMPLIANCE_BOUNDARY.md#7-open-questions-for-counsel-before-mainnet`](COMPLIANCE_BOUNDARY.md#7-open-questions-for-counsel-before-mainnet). |
| **Current evidence** | Compliance boundary document at [`docs/COMPLIANCE_BOUNDARY.md`](COMPLIANCE_BOUNDARY.md). |
| **Owner / action** | Core team — engage securities counsel in Q4 2026 before mainnet. |
| **Next action** | File issue: *Securities law analysis of resolver stake and safety deposit mechanisms*. |

### R-014 — Sanctions / geofencing obligations

| Field | Value |
|---|---|
| **Category** | Bridge regulatory / compliance ambiguity |
| **Risk** | OFAC or other sanctions regulators determine that the reference frontend or coordinator must block sanctioned addresses or jurisdictions. The project may face liability if sanctions-screening is absent at mainnet launch. |
| **Likelihood** | **Low** (non-custodial protocols have not been targeted to date) |
| **Impact** | **Medium** — potential legal exposure for operator; on-chain contracts are immutable and cannot be forced to filter |
| **Mitigation** | The HTLC contracts are permissionless and immutable with no blocklist capability — by design. Frontend geofencing and coordinator rate-limiting are deployment-time configuration options (see [`docs/COMPLIANCE_BOUNDARY.md#5-sanctions-and-geofencing`](COMPLIANCE_BOUNDARY.md#5-sanctions-and-geofencing)). Project will seek counsel on entity structure and sanctions obligations before mainnet. |
| **Current evidence** | Compliance boundary document at [`docs/COMPLIANCE_BOUNDARY.md`](COMPLIANCE_BOUNDARY.md). |
| **Owner / action** | Core team — engage sanctions counsel before mainnet; implement CDN-level geofencing if required. |
| **Next action** | File issue: *Sanctions-screening legal analysis and optional CDN geofencing implementation*. |

---

## 7. Solo-team / bus-factor risk

### R-015 — Solo-team bus factor

| Field | Value |
|---|---|
| **Category** | Solo-team / bus-factor risk |
| **Risk** | The project has one core contributor with deep knowledge of the full stack (Solidity, Soroban, coordinator, frontend, SDK). Illness, resignation, or other unavailability would halt development and delay the mainnet timeline. |
| **Likelihood** | **Moderate** |
| **Impact** | **High** — development halts; mainnet and all post-launch milestones slip indefinitely |
| **Mitigation** | Open resolver protocol keeps bridge alive even without core team (resolvers operate independently). CI + comprehensive docs (ARCHITECTURE.md 825 lines, DEPLOYMENT.md, RESOLVERS.md, CONTRIBUTING.md) reduce onboarding friction for new contributors. Formal team expansion planned post-Tranche 1. |
| **Current evidence** | Onboarding docs: [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`docs/DEPLOYMENT.md`](DEPLOYMENT.md), [`docs/RESOLVERS.md`](RESOLVERS.md). Hiring plan at [`docs/RUNWAY_AND_HIRING_PLAN.md`](RUNWAY_AND_HIRING_PLAN.md). |
| **Owner / action** | Core team — onboard second contributor before audit phase (Q4 2026). |
| **Next action** | Tracked in [`docs/RUNWAY_AND_HIRING_PLAN.md`](RUNWAY_AND_HIRING_PLAN.md). |

### R-016 — No on-chain timelock on admin actions

| Field | Value |
|---|---|
| **Category** | Solo-team / bus-factor risk |
| **Risk** | Admin actions on both `ResolverRegistry` contracts and the Soroban `HTLC` `set_admin` take effect immediately — no timelock delays admin function calls. A compromised key or rogue admin can change parameters without giving the community time to react. |
| **Likelihood** | **Low** (admin is controlled by the team; multisig migration scheduled before mainnet) |
| **Impact** | **Medium** — resolver stakes could be slashed or registry binding changed instantly |
| **Mitigation** | Multisig migration (2-of-3) before mainnet removes single-key risk. Future DAO + TimelockController (48-hour delay) planned for Q2–Q3 2027. User HTLC funds are never affected — admin actions only touch resolver stakes and registry configuration. |
| **Current evidence** | Governance path at [`docs/TRUST_MODEL.md`](TRUST_MODEL.md). |
| **Owner / action** | Core team — deploy TimelockController + Governor as part of v2.1 roadmap. |
| **Next action** | Tracked in [`ROADMAP.md § Q2–Q3 2027`](../ROADMAP.md#q2q3-2027--v21-deepening). File issue: *Design TimelockController integration for EVM ResolverRegistry*. |

---

## Risk summary matrix

| ID | Risk | Likelihood | Impact | Owner | Target resolution |
|---|---|---|---|---|---|
| R-001 | Contracts unaudited pre-mainnet | Certain | High | Core team | Q4 2026 (audit) |
| R-002 | Bug survives static analysis + audit | Low | Critical | Core team | Post-audit (bug bounty) |
| R-003 | Differential test gap | Present | Medium | Core team | Q3 2026 |
| R-004 | Resolver network cold-start | Moderate | Medium | Core team | Q1 2027 |
| R-005 | Resolver collusion to ignore orders | Low | Low | Core team | Ongoing monitoring |
| R-006 | ResolverRegistry owner is single EOA | Low | High | Core team | Q4 2026 |
| R-007 | Public RPC rate-limits | Moderate | Medium | Core team | Q3 2026 |
| R-008 | Coordinator DDoS / outage | Low | Low | Core team | Q3 2026 |
| R-009 | CCTP v2 Stellar mainnet slips | Possible | Low | Core team | Ongoing monitoring |
| R-010 | Soroban platform maturity | Low | Medium | Core team | Ongoing monitoring |
| R-011 | Audit findings push mainnet | Possible | Low | Core team | Q1 2027 |
| R-012 | Team expansion / retention delays | Low | Medium | Core team | Q3 2026 |
| R-013 | Securities classification of stakes | Low | High | Core team | Q4 2026 (counsel) |
| R-014 | Sanctions / geofencing obligations | Low | Medium | Core team | Q4 2026 (counsel) |
| R-015 | Solo-team bus factor | Moderate | High | Core team | Q4 2026 |
| R-016 | No on-chain timelock | Low | Medium | Core team | Q2–Q3 2027 |

---

## Heat map

```
Impact →
Critical  │        │        │        │ R-002  │
High      │        │        │ R-001  │        │ R-006, R-013, R-015
Medium    │ R-005  │ R-003, │ R-004, │        │
          │        │ R-010, │ R-007, │        │
          │        │ R-012, │ R-014, │        │
          │        │ R-016  │        │        │
Low       │ R-008, │ R-009, │        │        │
          │ R-011  │        │        │        │
          └────────┴────────┴────────┴────────┘
           Low     Possible Moderate High   Certain
                              Likelihood →
```

---

## Tracking issues

Each risk's next action will be filed as a GitHub issue with label `risk-register` and linked here as issues are created.

| Risk | Issue |
|---|---|
| R-001 | [`ROADMAP.md`](../ROADMAP.md) (audit scheduling) |
| R-002 | Issue: *Define bug bounty scope, severity rubric, and payout tiers* |
| R-003 | Issue: *Implement cross-chain differential test harness* |
| R-004 | Issue: *Resolver recruitment programme and grant terms* |
| R-005 | Issue: *Define resolver performance metrics and potential slashing conditions* |
| R-006 | Issue: *Create Safe deployment and ownership transfer scripts* |
| R-007 | Issue: *RPC health monitoring dashboard and automatic failover metrics* |
| R-008 | [`docs/METRICS_SCHEMA.md`](METRICS_SCHEMA.md) |
| R-009 | Issue: *CCTP v2 adapter dependency tracking and decoupling plan* |
| R-010 | Issue: *Soroban version compatibility test matrix in CI* |
| R-011 | [`ROADMAP.md`](../ROADMAP.md) (budget for remediation cycle) |
| R-012 | Issue: *Technical writer / engineer contractor scope for Q3 2026 deliverables* |
| R-013 | Issue: *Securities law analysis of resolver stake and safety deposit mechanisms* |
| R-014 | Issue: *Sanctions-screening legal analysis and optional CDN geofencing* |
| R-015 | [`docs/RUNWAY_AND_HIRING_PLAN.md`](RUNWAY_AND_HIRING_PLAN.md) |
| R-016 | Issue: *Design TimelockController integration for EVM ResolverRegistry* |

---

## Related documents

| Document | Relevance |
|---|---|
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Failure mode catalogue (§9), security boundaries (§10), trust model summary (§11) |
| [`docs/SECURITY.md`](SECURITY.md) | STRIDE threat model, audit prep checklist, bug bounty plan |
| [`docs/TRUST_MODEL.md`](TRUST_MODEL.md) | Per-actor threat analysis, what each component can and cannot do |
| [`docs/TRUST_MODEL.md`](TRUST_MODEL.md) | Per-actor threat analysis, centralisation risks, multisig migration plan |
| [`docs/COMPLIANCE_BOUNDARY.md`](COMPLIANCE_BOUNDARY.md) | Legal/regulatory boundary analysis, open counsel questions |
| [`docs/INCIDENT_RESPONSE_RUNBOOK.md`](INCIDENT_RESPONSE_RUNBOOK.md) | SEV definitions, response procedures, postmortem template |
| [`docs/MAINNET_READINESS_SCORECARD.md`](MAINNET_READINESS_SCORECARD.md) | Mainnet readiness scorecard with implementation status |
| [`ROADMAP.md`](../ROADMAP.md) | Delivery timeline, exit criteria, open dependencies |

---

*Document version: June 2026. Maintained by the OverSync core team. Every claim links to source code, a deployed contract, or a public document — no information in this register is hypothetical or invented.*

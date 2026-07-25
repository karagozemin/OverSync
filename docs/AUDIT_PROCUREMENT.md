# OverSync v2 — Audit Procurement Document

- **Project:** OverSync — non-custodial, multi-resolver, HTLC-based bridge between Ethereum (EVM) and Stellar (Soroban)
- **Repository:** <https://github.com/oversync/oversync>
- **Version:** v2 (pre-mainnet)
- **Date:** June 2026

---

## 1. Audit Scope

The audit covers the four on-chain smart contracts that implement cross-chain HTLC atomic swaps and resolver staking. These are the only contracts that hold or control user funds.

### 1.1 In-scope contracts

| # | Contract | Language | Source | Lines | Role |
|---|---|---|---|---|---|
| C1 | `HTLCEscrow` | Solidity 0.8.24 | [`contracts/contracts/v2/HTLCEscrow.sol`](../contracts/contracts/v2/HTLCEscrow.sol) | 286 | EVM-side HTLC: locks ETH/ERC-20 under hashlock + timelock. No admin escape hatch. Non-custodial by construction. |
| C2 | `ResolverRegistry` | Solidity 0.8.24 | [`contracts/contracts/v2/ResolverRegistry.sol`](../contracts/contracts/v2/ResolverRegistry.sol) | 208 | EVM-side resolver stake/slash registry. Separate from HTLC; compromise cannot move user funds. |
| C3 | `oversync-htlc` | Rust (Soroban SDK 22.0.8) | [`soroban/contracts/htlc/src/lib.rs`](../soroban/contracts/htlc/src/lib.rs) | 480 | Soroban-side HTLC: mirrors C1 semantics for Stellar assets. |
| C4 | `oversync-resolver-registry` | Rust (Soroban SDK 22.0.8) | [`soroban/contracts/resolver-registry/src/lib.rs`](../soroban/contracts/resolver-registry/src/lib.rs) | 326 | Soroban-side resolver stake/slash registry. Mirrors C2. |

The Solidity interfaces `IHTLCEscrow` ([`contracts/contracts/v2/interfaces/IHTLCEscrow.sol`](../contracts/contracts/v2/interfaces/IHTLCEscrow.sol), 77 lines) and `IResolverRegistry` ([`contracts/contracts/v2/interfaces/IResolverRegistry.sol`](../contracts/contracts/v2/interfaces/IResolverRegistry.sol), 11 lines) should be reviewed as supporting reference material but contain no executable logic.

### 1.2 Contract responsibilities

**C1 — HTLCEscrow (`HTLCEscrow.sol`).** The canonical Ethereum-side HTLC contract. Accepts native ETH or any ERC-20. Provides three state-changing functions:
- `createOrder` — locks funds under a user-supplied `hashlock` (sha256 or keccak256) and `timelock`. Optionally gated by `ResolverRegistry.isActive(msg.sender)` for sybil resistance.
- `claimOrder` — releases locked funds to `beneficiary` upon correct preimage before expiry. Pays safety deposit to caller.
- `refundOrder` — permissionless post-expiry return of locked funds to `refundAddress` (pinned to the creator at creation time). Pays safety deposit to caller.

No `onlyOwner` function exists. No `emergencyWithdraw`, `pause`, or `upgradeTo`.

**C2 — ResolverRegistry (`ResolverRegistry.sol`).** Open staking registry for EVM-side resolvers. Resolvers post ERC-20 stake to become active. The `owner` (intended as multisig/DAO) can slash misbehaving resolvers, with slashed funds routed to `slashBeneficiary` (not the owner). Exposes `isActive(address) → bool` consumed by C1.

**C3 — oversync-htlc (`lib.rs`).** Mirrors C1 on Stellar via Soroban. Uses sha256-only hashlock (Stellar does not support keccak256). Enforces `MIN_TIMELOCK_SECONDS` (300) and `MAX_TIMELOCK_SECONDS` (86400). Includes an `admin` role that can update `min_safety_deposit` and `resolver_registry` address but CANNOT move locked user funds. The admin can transfer its own role via `set_admin`.

**C4 — oversync-resolver-registry (`lib.rs`).** Mirrors C2 on Stellar. Resolvers stake Stellar assets; admin (DAO/multisig) can slash. Admin can update `min_stake` and `slash_beneficiary`. Admin can transfer its role via `set_admin`.

---

## 2. Out of Scope

The following components are explicitly excluded from the smart contract audit. They cannot directly move user funds or affect custody.

| Component | Path(s) | Reason excluded |
|---|---|---|
| Coordinator (TypeScript) | [`coordinator/`](../coordinator/) | Stateless metadata service with no signing authority over HTLC contracts. Holds no private keys that can move funds. See [`TRUST_MODEL.md`](TRUST_MODEL.md). |
| TypeScript SDK (`@oversync/sdk`) | [`packages/sdk/`](../packages/sdk/) | Client-side library for wallet interaction. All state-changing operations require user's on-chain signature. |
| Frontend (React/Vite) | [`frontend/`](../frontend/) | UI layer; refunds call HTLC directly from the user's wallet. Cannot move funds independently. |
| Resolver runner | [`resolver/`](../resolver/) | Off-chain reference implementation of a resolver operator. Runs with the operator's own keys; any compromise is bounded to that resolver's stake. |
| Legacy relayer (v1) | [`relayer/`](../relayer/) | Deprecated phase-6 relayer. Not used in v2 mainnet path. |
| Test ERC-20 token | [`contracts/contracts/TestERC20.sol`](../contracts/contracts/TestERC20.sol) | Standard mintable ERC-20 for test deployments only. |
| EscrowFactory (v1) | [`contracts/contracts/EscrowFactory.sol`](../contracts/contracts/EscrowFactory.sol) | Legacy factory pattern; not part of v2 architecture. |
| MainnetHTLC (v1) | [`contracts/contracts/MainnetHTLC.sol`](../contracts/contracts/MainnetHTLC.sol) | Legacy simplified HTLC; superseded by C1. |
| HTLCBridge (v1) | [`contracts/contracts/HTLCBridge.sol`](../contracts/contracts/HTLCBridge.sol) | Legacy enhanced HTLC; superseded by C1. |
| Hardhat/Foundry test helpers | [`contracts/test/`](../contracts/test/), [`contracts/lib/forge-std/`](../contracts/lib/forge-std/) | Test infrastructure, not deployed. |
| End-to-end / load tests | [`e2e/`](../e2e/) | Off-chain test harness. |
| Stellar bridge utilities | [`stellar/`](../stellar/) | TypeScript utilities for Stellar interaction; no fund custody. |
| Deployment scripts | [`deployments.testnet.json`](../deployments.testnet.json), [`soroban/scripts/deploy.sh`](../soroban/scripts/deploy.sh) | Off-chain configuration and scripts. |

---

## 3. Existing Security Evidence

### 3.1 Test suites

| Test suite | Location | Scope | Lines | Run in CI |
|---|---|---|---|---|
| Hardhat (EVM contracts) | [`contracts/test/v2/HTLCEscrow.test.ts`](../contracts/test/v2/HTLCEscrow.test.ts) | HTLCEscrow create/claim/refund, safety deposit, non-custodial invariants, edge cases | 383 | Yes (`ci.yml`) |
| Hardhat (EVM registry) | [`contracts/test/v2/ResolverRegistry.test.ts`](../contracts/test/v2/ResolverRegistry.test.ts) | register, isActive, increaseStake, slash, minimum stake | 105 | Yes (`ci.yml`) |
| Foundry fuzz + invariant | [`contracts/test/foundry/HTLCEscrow.t.sol`](../contracts/test/foundry/HTLCEscrow.t.sol) | Fuzzed create/claim/refund, hashlock verification (sha256 + keccak256), non-custodial | 293 | Yes (`contracts.yml`) |
| Rust (Soroban HTLC) | [`soroban/contracts/htlc/src/test.rs`](../soroban/contracts/htlc/src/test.rs) | Full order lifecycle, safety deposits, TTL, registry integration, error handling | 669 | Yes (`ci.yml`) |
| Rust (Soroban registry) | [`soroban/contracts/resolver-registry/src/test.rs`](../soroban/contracts/resolver-registry/src/test.rs) | register, stake management, slash, isActive, TTL extension | 240 | Yes (`ci.yml`) |
| Cross-chain differential | [`e2e/cross-chain.test.ts`](../e2e/cross-chain.test.ts) | Hash primitive parity, in-process EVM/Soroban simulators for full state machine coverage | 130 | No (requires both runtimes) |

### 3.2 CI workflows

| Workflow | Trigger | What it runs | File |
|---|---|---|---|
| `ci.yml` | Push/PR to `master`, `main`, `v2-rebuild` | TypeScript build + typechecks (SDK, coordinator, resolver, frontend); SDK/frontend/coordinator tests; Hardhat contract tests; Soroban build + `cargo test` | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| `contracts.yml` | Push/PR touching `contracts/**` | Foundry fuzz + invariant tests; Slither static analysis on v2 contracts with artifact upload | [`.github/workflows/contracts.yml`](../.github/workflows/contracts.yml) |
| `release.yml` | Tag `v*` | Build and push resolver Docker image to `ghcr.io` | [`.github/workflows/release.yml`](../.github/workflows/release.yml) |

### 3.3 Static analysis

- **Slither** is the only static analysis tool configured. The CI job in [`contracts.yml`](../.github/workflows/contracts.yml) runs `slither-analyzer==0.10.4` against `contracts/v2` with exclusions for `naming-convention`, `solc-version`, and `timestamp`. Results are uploaded as a CI artifact.
- Justified Slither suppressions are annotated inline in the Solidity source via `// slither-disable-next-line` with rationale comments (see `HTLCEscrow.sol:181`, `HTLCEscrow.sol:261-262`).
- No Semgrep, Mythril, Echidna, or solhint configurations are present.

### 3.4 Security documentation

| Document | Description | Location |
|---|---|---|
| SECURITY.md | STRIDE threat model, audit status, preparation checklist, bug bounty plan | [`docs/SECURITY.md`](SECURITY.md) |
| TRUST_MODEL.md | Single-point-of-failure analysis, threat scenarios per actor, core invariant explanation | [`docs/TRUST_MODEL.md`](TRUST_MODEL.md) |
| ARCHITECTURE.md | Exhaustive architecture description: design goals, system topology, order lifecycle, failure mode catalogue, security boundaries | [`ARCHITECTURE.md`](../ARCHITECTURE.md) |
| DEPLOYMENT.md | Step-by-step deployment guide for testnet/mainnet | [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) |
| REVIEW_RESPONSE.md | Point-by-point response to v1 review feedback with source code links | [`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md) |

### 3.5 Current security verification status

- All four in-scope contracts are **currently unaudited** by an independent third party.
- Pre-audit hardening items tracked in [`docs/SECURITY.md`](SECURITY.md) are largely complete: single canonical contracts, no admin escape hatches, reentrancy guards, SafeERC20, OZ v5, test suites in CI, Slither CI gate.
- The repository is testnet-only for v2 (`VITE_MAINNET_ENABLED=false`). No v2 contracts are deployed to mainnet.

---

## 4. Audit Objectives & Security Invariants

The audit should verify the following invariants. Each is documented in source code, tests, and the architecture document as referenced.

### 4.1 Escrow correctness

1. Locked funds can only move under exactly two conditions: (a) correct preimage revealed before `timelock`, or (b) any caller after `timelock` invoking refund.
2. `claimOrder` / `claim_order` requires `sha256(preimage) == hashlock` (both chains) OR `keccak256(preimage) == hashlock` (EVM only) AND `block.timestamp <= timelock`.
3. `refundOrder` / `refund_order` requires `block.timestamp > timelock` AND order status is exactly `Funded`.
4. An order that has been claimed or refunded cannot transition again (idempotent terminal states).

### 4.2 Fund safety

5. No admin role, owner function, or privileged address can move locked funds from HTLC contracts. Verified by test `non-custodial guarantees > contract has no admin escape hatch`.
6. `refundAddress` is set to `msg.sender` / `sender` at creation time and is immutable.
7. No `emergencyWithdraw`, `pause`, `upgradeTo`, proxy admin, or delegatecall exists in HTLC contracts.
8. Safety deposit is separate from locked amount and paid to the caller (gas reimbursement), not to the beneficiary.

### 4.3 Access control

9. `claim_order` and `refund_order` are permissionless (no registry check, no allowlist).
10. `ResolverRegistry.isActive` is consulted only in `createOrder` / `create_order` as a soft sybil gate. Bypassing the registry (address zero / unset) must preserve fund safety.
11. Registry `slash` is `onlyOwner` (EVM) / `require_admin` (Soroban) and routes slashed funds to `slashBeneficiary`, not to the admin EOA.
12. EVM `ResolverRegistry` uses `Ownable2Step` (no single-transaction ownership transfer).

### 4.4 Resolver permissions

13. Resolver stake can only be withdrawn by the resolver itself via `unregister`.
14. Slashing cannot extract more than the resolver's current stake.
15. `increaseStake` / `increase_stake` enforces `require_auth` on the resolver.

### 4.5 Replay protection

16. Each order has a unique auto-incrementing `orderId` (EVM) or `order_id` (Soroban). No key reuse.
17. A preimage revealed for one order cannot be replayed against a different order (different `hashlock`).
18. Double-claim and double-refund revert (status check prevents state transition from terminal states).

### 4.6 Timeout/refund logic

19. `MIN_TIMELOCK` (300 s) prevents orders that expire before they can be claimed.
20. `MAX_TIMELOCK` (86400 s) prevents unreasonably long fund locks.
21. Timelocks are absolute (`block.timestamp + timelockSeconds`), stored at creation, and evaluated against `block.timestamp`.
22. Off-chain timelock ordering (`timelock_dest < timelock_source`) is enforced by the coordinator order builder and verified by the resolver runner, not by the contracts themselves. Contracts enforce only absolute bounds.

### 4.7 Authorization

23. Soroban `create_order` requires `sender.require_auth()`. Soroban `claim_order` / `refund_order` require `caller.require_auth()`.
24. EVM functions use `msg.sender` directly (implicitly authenticated by the transaction signature).
25. Soroban admin functions (`set_admin`, `set_min_safety_deposit`, `set_resolver_registry`, `set_min_stake`, `set_slash_beneficiary`) all require `require_admin()` which authenticates the stored admin address.

### 4.8 Cross-chain assumptions

26. Atomic swap safety depends on `sha256` being collision-resistant and preimage-resistant. The EVM side additionally accepts `keccak256` for EVM-tooling compatibility.
27. The two contracts are not composable on-chain with each other (different chains). The atomicity guarantee is cryptographic (same preimage unlocks both), not cross-chain-messaging-based.
28. Coordinator and resolver are off-chain actors with no on-chain authority over locked funds.

### 4.9 Denial-of-service risks

29. Refund is permissionless: even if the coordinator is offline, any address can trigger refund after timelock.
30. No unbounded loops in either HTLC contract; only fixed-cost operations.
31. Soroban contracts use TTL extension (`extend_ttl`) on every write to prevent stored orders from being garbage-collected by the ledger before timelock expiry.

### 4.10 Invalid state transitions

32. Claim of a refunded order reverts. Refund of a claimed order reverts.
33. Order status transitions strictly: `Funded → Claimed | Refunded`. No other path exists.
34. `Refunded` and `Claimed` are terminal states; no function can mutate them.

### 4.11 Event correctness

35. `OrderCreated` / `OrderClaimed` / `OrderRefunded` events are emitted on every state change.
36. Events include `orderId`, caller, beneficiary/refund address, amount, safety deposit, hashlock, and timelock (create) or preimage (claim).
37. Soroban events use `symbol_short` topics matching the EVM event semantics so the coordinator can process both chains with shared code.

### 4.12 Upgrade / ownership risks

38. EVM `HTLCEscrow` has no upgrade mechanism (no proxy, no `upgradeTo`, no `UUPS`). Immutable constructor parameters.
39. Soroban HTLC has an `admin` role that can update `min_safety_deposit` and `resolver_registry` address. The admin CANNOT modify locked orders or add new fund-moving functions. Admin is transferable via `set_admin`.
40. EVM `ResolverRegistry` is `Ownable2Step`; the owner can update `minStake`, `slashBeneficiary`, and `slash`. Owner is transferable via the `Ownable2Step` two-step pattern.
41. Soroban `resolver-registry` admin can update `min_stake`, `slash_beneficiary`, and `set_admin`. Same constraints as C4 admin.

---

## 5. Expected Auditor Deliverables

### 5.1 Findings report

A written report detailing each finding with:

- **Title and unique identifier.**
- **Severity classification** using a standard scale (e.g., Critical, High, Medium, Low, Informational).
- **Affected contract(s) and function(s)** with file paths and line numbers.
- **Description** of the vulnerability or issue, including the conditions required to exploit it.
- **Impact assessment** — what an attacker could achieve, and under what assumptions.
- **Proof of concept** — for Critical and High severity findings, a working PoC (Solidity, Rust, or TypeScript test case) demonstrating the exploit. For Medium/Low, a written description or simplified PoC is acceptable.
- **Remediation recommendation** — specific code changes, design alternatives, or configuration changes.

### 5.2 Severity classification

We expect the standard OpenZeppelin / Consensys / Sherlock-style severity matrix:

| Severity | Definition |
|---|---|
| **Critical** | Direct loss of user funds, or permanent freezing of funds, with no preconditions or with widely-available preconditions. |
| **High** | Loss of funds under specific but realistic preconditions; or permanent denial of service for a contract function. |
| **Medium** | Unexpected behavior that does not directly lead to fund loss but violates documented invariants or weakens security assumptions. |
| **Low** | Code quality issues, minor spec deviations, unused code paths, or events emitting incorrect data. |
| **Informational** | Suggestions, style, documentation gaps, or gas optimizations. |

### 5.3 Remediation recommendations

Each finding should include a concrete remediation recommendation. For code-level fixes, we prefer diff-style suggestions or pseudocode. For design-level issues, a description of the architectural change required.

### 5.4 Verification of fixes

After remediation, we request a **verification pass** by the same audit team to confirm:
- Each finding is adequately resolved.
- No new issues were introduced by the remediation.
- A signed statement or brief addendum covering the verification.

### 5.5 Final report

A single consolidated report including:
- Executive summary
- Scope confirmation
- All findings (including those remediated during the audit)
- Verification results
- Limitations and assumptions
- Auditor's opinion on overall security posture

---

## 6. Remediation Process

### 6.1 Issue tracking

All audit findings will be tracked as GitHub Issues in the project repository. Each issue will reference the auditor's finding ID.

### 6.2 Remediation PR workflow

1. For each finding, a developer creates a dedicated branch.
2. A pull request is opened against `main` with the fix, referencing the issue.
3. The PR includes updated tests demonstrating the fix (or new tests for the edge case discovered).
4. CI must pass, including the relevant test suite and static analysis.

### 6.3 Review process

- Internal review by at least one other team member.
- The fix PR must not introduce new functionality outside the scope of the finding.
- Documentation is updated if the finding changes documented behavior or assumptions.

### 6.4 Regression testing

Before merging, the full test suite is run:
- Hardhat tests (EVM contracts)
- Foundry fuzz + invariant tests
- Rust `cargo test` (Soroban contracts)
- SDK tests (if affected)
- E2E cross-chain differential tests (if applicable)

### 6.5 Verification and closure

- After merging, the auditor is invited to review the fix.
- The auditor confirms the fix resolves the finding (or provides feedback for iteration).
- The issue is closed, and the finding is marked as resolved in the final report.

---

## 7. Proposed Audit Timeline

| Phase | Duration | Activities |
|---|---|---|
| **Preparation** | 1 week | Internal team: finalize source, freeze scope, provide auditor access to repository, documentation, and test suite. |
| **Audit execution** | 3–4 weeks | Auditor: reconnaissance, automated analysis, manual review, PoC development, preliminary report. Weekly sync calls. |
| **Preliminary report** | — | Auditor delivers initial findings. Team reviews and asks clarifying questions. |
| **Remediation** | 1–2 weeks | Team fixes findings per severity (Critical/High within 72 hours, Medium within 1 week, Low by end of remediation phase). |
| **Verification** | 1 week | Auditor reviews fixes, confirms resolution, provides verification addendum. |
| **Final report** | — | Auditor delivers consolidated final report with executive summary. |
| **Publication** | 1 week post-report | Findings are published in the repository, bug bounty program is announced. |

Total estimated timeline: **6–8 weeks** from audit kickoff to published final report.

---

## 8. Audit Firm Selection Criteria

We will evaluate firms based on the following factors, weighted approximately as shown.

### 8.1 Smart contract expertise (weight: high)

- Proven track record auditing EVM (Solidity) and non-EVM (Soroban/Rust) contracts.
- Experience with HTLC, atomic swap, or bridge contracts specifically.
- Familiarity with OpenZeppelin libraries and common Solidity patterns (ReentrancyGuard, SafeERC20, Ownable2Step).

### 8.2 EVM and Soroban experience (weight: high)

- Direct experience auditing Soroban/Soroban SDK contracts, or a demonstrated plan to upskill.
- Understanding of Stellar-specific nuances: TTL management, `require_auth`, Soroban token interface, ledger timestamp semantics.

### 8.3 Audit methodology (weight: high)

- Combination of manual review, automated analysis (Slither, Mythril, or equivalent), and formal verification (if offered).
- Systematic approach to state space exploration and invariant checking.
- Request for previous audit reports to assess thoroughness.

### 8.4 Turnaround time (weight: medium)

- Ability to commit to the proposed timeline (3–4 weeks audit execution, 1 week verification).
- Availability of the same lead auditor(s) for the verification pass.

### 8.5 Communication (weight: medium)

- Weekly status updates with written progress summaries.
- Responsive point of contact for clarifying questions during the audit.

### 8.6 Pricing (weight: medium)

- Fixed-price or capped quote for the defined scope.
- Separate pricing for the verification pass.
- Willingness to prioritize Critical/High findings mid-engagement if discovered.

### 8.7 Reputation (weight: high)

- No history of missed Critical findings that later led to exploits.
- Positive references from projects of similar complexity and TVL.
- Insured (professional liability / errors & omissions) preferred.

---

## 9. Known Limitations

The following are honest limitations, assumptions, and areas that the project team has identified as requiring additional review. These are communicated to ensure the auditor has full context.

### 9.1 Soroban ecosystem maturity

The Soroban platform (Soroban SDK 22.0.8) is relatively new compared to EVM. The audit should consider:
- The SDK's own security posture and any known limitations.
- Soroban TTL management: persistent storage entries must be periodically extended. The contracts extend TTL on every write, but a prolonged period of no transactions could theoretically lead to order data being garbage-collected before timelock expiry. The `INSTANCE_TTL_THRESHOLD` / `INSTANCE_TTL_TARGET` (50k / 100k ledgers, ~14 days) are configured to provide ample margin.
- The `env.crypto().sha256()` Soroban host function is trusted.

### 9.2 Dual-hash digest design

The EVM `HTLCEscrow` accepts either sha256 or keccak256 as matching a single stored `hashlock`. This is a deliberate design choice (documented in ARCHITECTURE.md §7.1) to support both Soroban cross-chain swaps and pure EVM HTLC tooling. The auditor should verify:
- There is no path where a preimage that is neither sha256 nor keccak256 of itself could satisfy the hashlock check.
- The `sha256` digest computed by the EVM is identical to the `sha256` digest computed by Soroban for the same preimage (byte-identical inputs produce byte-identical outputs).

### 9.3 Off-chain timelock ordering

The contracts enforce only absolute timelock bounds (`MIN_TIMELOCK ≤ t ≤ MAX_TIMELOCK`). The atomic-swap ordering invariant (`timelock_dest < timelock_source`) is enforced off-chain by the coordinator and verified by the resolver. If a resolver incorrectly accepts an order where `timelock_dest >= timelock_source`, the atomicity guarantee degrades. This is documented as the single trust point resolver implementers must get right (ARCHITECTURE.md §7.2).

### 9.4 Registry admin centralization

On testnet, the `ResolverRegistry` owner is the deploying EOA. On mainnet, ownership is intended to be transferred to a multisig (Safe) before launch and ultimately to a DAO with timelock. Until the multisig transfer is complete, a compromised owner EOA can slash legitimate resolvers (though cannot touch HTLC funds). The current state reflects pre-mainnet convention and is documented accordingly.

### 9.5 Slither exclusions

The CI Slither run excludes the `naming-convention`, `solc-version`, and `timestamp` detectors. Suppressed findings in the source are annotated with inline `// slither-disable-next-line` comments with rationale. Reviewers should inspect these suppressions for validity.

### 9.6 No formal verification

No formal verification tools (Certora, Halmos, KEVM) have been applied. Only fuzz testing and Slither are currently in place. The team is open to auditor-led formal verification as an additional service.

### 9.7 Test coverage gaps

- The cross-chain differential test (`e2e/cross-chain.test.ts`) is not run in CI.
- Some edge cases (e.g., claim when `registry == address(0)`) are tested in Hardhat but may lack Foundry fuzz coverage.
- Invariant tests are limited in scope (Foundry `invariant` runs with depth 16).

### 9.8 No bug bounty active

A public bug bounty program will be launched after the audit is complete and contracts are deployed to mainnet. See [`docs/SECURITY.md`](SECURITY.md) for the current disclosure policy.

---

*This document was prepared by the OverSync team to facilitate audit procurement. It reflects the state of the repository at the time of writing. No third-party audit has yet been conducted.*

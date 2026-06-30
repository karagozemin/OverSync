# OverSync v2 — SCF Diligence Data Room

> **Audience:** Stellar Community Fund (SCF) reviewers and prospective investors.  
> **Reading time:** ≤ 10 minutes (use the section links below to jump to what you need).  
> **Status (June 2026):** v2 is live on Sepolia + Stellar testnet. Mainnet is intentionally gated on independent audits (target: Q1 2027). No protocol behaviour changed in this document — it is documentation only.

---

## Quick-navigation index

| Section | What you will find |
|---|---|
| [1. Live testnet contracts](#1-live-testnet-contracts) | On-chain addresses + block-explorer links |
| [2. Public deployments](#2-public-deployments) | Frontend, coordinator, health endpoints |
| [3. Architecture](#3-architecture) | Design overview and canonical doc links |
| [4. Security and audit readiness](#4-security-and-audit-readiness) | Threat model, checklist, audit plan |
| [5. CI status and testing](#5-ci-status-and-testing) | Workflow files, test counts by layer |
| [6. Roadmap and milestones](#6-roadmap-and-milestones) | Delivery plan with verifiable artefacts |
| [7. Implementation status](#7-implementation-status) | v1 → v2 transition table |
| [8. Budget and grant scope](#8-budget-and-grant-scope) | Tranche breakdown, Stellar-only work |
| [9. Onboarding documentation](#9-onboarding-documentation) | Operators, resolvers, contributors |
| [10. Known risks and mitigations](#10-known-risks-and-mitigations) | Open risks with concrete mitigations |

---

## 1. Live testnet contracts

All addresses are sourced directly from [`deployments.testnet.json`](../deployments.testnet.json).  
No mainnet contracts are active in the v2 UI (`VITE_MAINNET_ENABLED=false`).

### Ethereum — Sepolia (chain ID 11155111)

| Contract | Address | Block explorer | Source |
|---|---|---|---|
| `HTLCEscrow` | `0xb352339BEb146f2699d28D736700B953988bB178` | [Sepolia Etherscan ↗](https://sepolia.etherscan.io/address/0xb352339BEb146f2699d28D736700B953988bB178) | [`contracts/contracts/v2/HTLCEscrow.sol`](../contracts/contracts/v2/HTLCEscrow.sol) |
| `ResolverRegistry` | `0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99` | [Sepolia Etherscan ↗](https://sepolia.etherscan.io/address/0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99) | [`contracts/contracts/v2/ResolverRegistry.sol`](../contracts/contracts/v2/ResolverRegistry.sol) |

Deployed: 2026-05-14. Deployer: `0x686Be1DEF4b9Bd725A5Df07505E25a94Fa71394c`.

### Stellar — Testnet (passphrase: `Test SDF Network ; September 2015`)

| Contract | Contract ID | Block explorer | Source |
|---|---|---|---|
| `oversync-htlc` | `CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK` | [Stellar Expert ↗](https://stellar.expert/explorer/testnet/contract/CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK) | [`soroban/contracts/htlc/src/lib.rs`](../soroban/contracts/htlc/src/lib.rs) |
| `oversync-resolver-registry` | `CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF` | [Stellar Expert ↗](https://stellar.expert/explorer/testnet/contract/CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF) | [`soroban/contracts/resolver-registry/src/lib.rs`](../soroban/contracts/resolver-registry/src/lib.rs) |

Deployed: 2026-05-14. Deployer: `GC4VWBK5QSJCBSRWIZJYWCF2SJAPCKU3OFHH4XK7ZBTZ5HCK7VYLU6FL`.

Deploy transactions on Stellar Expert:

| Action | Transaction hash |
|---|---|
| HTLC deploy | [`f7583c2c…201d7`](https://stellar.expert/explorer/testnet/tx/f7583c2cca3ca542a4754677e98f1ce9c4e1fa93ebe534ed094110b0e58201d7) |
| ResolverRegistry deploy | [`1532a403…75d7`](https://stellar.expert/explorer/testnet/tx/1532a403acc488b651692b6d26fd393535014176b6905909e8d133cf475875d7) |
| ResolverRegistry initialize | [`e5e353b6…535`](https://stellar.expert/explorer/testnet/tx/e5e353b6d6b2b6f6e6a88661c199418551508acf558d1799f0d1e184aa23d535) |

ResolverRegistry config: minimum stake = 100 XLM (native XLM SAC), slash beneficiary = deployer address (intended for multisig before mainnet — see [§ 10](#10-known-risks-and-mitigations)).

---

## 2. Public deployments

### Frontend

- **URL:** `https://oversync.app` (Vercel deployment, source [`frontend/`](../frontend/))
- **Mode:** Testnet-only. The network selector shows **Testnet** (active) and a disabled **Mainnet Coming** badge.
- `VITE_MAINNET_ENABLED=false` is the default; the Vercel deployment does not expose the mainnet path. See [`docs/DEPLOYMENT.md § Frontend network mode`](DEPLOYMENT.md#frontend-network-mode).
- Vercel project configuration: [`vercel.json`](../vercel.json).

### Coordinator (reference)

- **Hosted on Render** (source [`coordinator/`](../coordinator/))
- **Health endpoint:** `GET /health` — defined in [`coordinator/src/server/routes/health.ts`](../coordinator/src/server/routes/health.ts)
- **Order history:** `GET /api/orders/history?address=<address>`
- **Quotes:** `GET /api/quotes/eth-xlm`
- The coordinator holds **no signing keys** that can move user funds. It is a metadata cache rebuildable from on-chain events. See [`coordinator/README.md`](../coordinator/README.md).

### Soroban RPC

- Testnet: `https://soroban-testnet.stellar.org`
- Horizon: `https://horizon-testnet.stellar.org`

Both are public Stellar Foundation endpoints, referenced in [`deployments.testnet.json`](../deployments.testnet.json).

---

## 3. Architecture

The canonical architecture document is [`ARCHITECTURE.md`](../ARCHITECTURE.md) (825 lines, exhaustive).

### Design in one paragraph

OverSync is a non-custodial Ethereum ↔ Stellar bridge using symmetric Hash-Time-Lock Contracts (HTLCs). Funds are locked on-chain; the only ways to move them are (1) a caller reveals a correct SHA-256 preimage before the timelock, or (2) anyone calls `refundOrder`/`refund_order` after the timelock — paying the user's `refundAddress` back. No admin, coordinator, or resolver can bypass these conditions. The coordinator is a stateless order-book cache; resolvers are open-registry economic actors.

### Key sections to verify

| Topic | Location |
|---|---|
| System topology diagram | [`ARCHITECTURE.md § 3`](../ARCHITECTURE.md#3-system-topology) |
| ETH→XLM and XLM→ETH sequence diagrams | [`ARCHITECTURE.md § 4`](../ARCHITECTURE.md#4-the-atomic-swap-flow) |
| Four-layer refund mechanism | [`ARCHITECTURE.md § 6`](../ARCHITECTURE.md#6-refund-mechanisms) |
| Failure mode catalogue | [`ARCHITECTURE.md § 9`](../ARCHITECTURE.md#9-failure-mode-catalogue) |
| Security boundaries (auditor checklist source) | [`ARCHITECTURE.md § 10`](../ARCHITECTURE.md#10-security-boundaries-what-is-enforced-where) |
| Trust model summary | [`ARCHITECTURE.md § 11`](../ARCHITECTURE.md#11-trust-model-summary) |
| v1 → v2 status table | [`ARCHITECTURE.md § 12`](../ARCHITECTURE.md#12-status-table) |
| Cryptographic primitives | [`ARCHITECTURE.md § 7`](../ARCHITECTURE.md#7-cryptographic-primitives) |
| Trust model (STRIDE-style) | [`docs/TRUST_MODEL.md`](TRUST_MODEL.md) |
| Competitive differentiation | [`docs/DIFFERENTIATION.md`](DIFFERENTIATION.md) |

---

## 4. Security and audit readiness

Full document: [`docs/SECURITY.md`](SECURITY.md).

### Audit status (as of June 2026)

| Asset | Status | Notes |
|---|---|---|
| `soroban/contracts/htlc` | **Unaudited** — 10 unit tests | Independent audit planned pre-mainnet (Tranche 2) |
| `soroban/contracts/resolver-registry` | **Unaudited** | Same plan |
| `contracts/v2/HTLCEscrow.sol` | **Unaudited** — 15 Hardhat tests + Slither in CI | Foundry fuzz + invariant suite in CI (Tranche 1 deliverable — completed) |
| `contracts/v2/ResolverRegistry.sol` | **Unaudited** — 6 Hardhat tests | Multisig migration before mainnet |
| Coordinator / SDK / frontend | Out of scope — cannot move user funds | Static analysis (ESLint + `tsc --strict`) only |

### Pre-audit hardening checklist (from [`docs/SECURITY.md`](SECURITY.md))

- [x] Single canonical EVM HTLC contract (`HTLCEscrow.sol`)
- [x] Single canonical Soroban HTLC contract (`oversync-htlc`)
- [x] No admin escape hatches in HTLC contracts — verified by Hardhat test `non-custodial guarantees > contract has no admin escape hatch` in [`contracts/test/v2/HTLCEscrow.test.ts`](../contracts/test/v2/HTLCEscrow.test.ts)
- [x] Reentrancy guards on every state-changing function (OpenZeppelin `ReentrancyGuard`)
- [x] `SafeERC20` on every ERC-20 transfer
- [x] OpenZeppelin v5 (`Ownable2Step` for registry)
- [x] Foundry fuzz + invariant tests (`contracts/test/foundry/HTLCEscrow.t.sol`) gated in CI ([`.github/workflows/contracts.yml`](../.github/workflows/contracts.yml))
- [x] Slither static analysis CI gate ([`.github/workflows/contracts.yml`](../.github/workflows/contracts.yml))
- [ ] Differential testing: same hashlock works on both chains (Q3 2026 milestone)

### Auditor checklist

A full, grep-ready auditor checklist for Solidity, Soroban, and off-chain components is at [`ARCHITECTURE.md § 13`](../ARCHITECTURE.md#13-auditor-checklist).

### Bug bounty

A public Immunefi-style bounty will open after both HTLC contracts are independently audited. Until then, security findings go to `security@oversync.app`. See [`docs/SECURITY.md § Bug bounty`](SECURITY.md#bug-bounty).

---

## 5. CI status and testing

### Workflow files

| Workflow | Triggers | File |
|---|---|---|
| `ci` (TypeScript + Soroban) | Push/PR to `master`, `main`, `v2-rebuild` | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| `contracts` (Foundry fuzz + Slither) | Push/PR touching `contracts/**` | [`.github/workflows/contracts.yml`](../.github/workflows/contracts.yml) |
| `release` | Tag push | [`.github/workflows/release.yml`](../.github/workflows/release.yml) |

### Test coverage by layer

| Layer | Test count | Framework | CI gate |
|---|---|---|---|
| Soroban `oversync-htlc` | 10 | Rust `#[contracttest]` | `ci.yml` → job `soroban` |
| Soroban `oversync-resolver-registry` | 6 | Rust `#[contracttest]` | `ci.yml` → job `soroban` |
| EVM `HTLCEscrow` | 15 | Hardhat + Chai | `ci.yml` → job `typescript` |
| EVM `ResolverRegistry` | 6 | Hardhat + Chai | `ci.yml` → job `typescript` |
| EVM `HTLCEscrow` fuzz + invariant | Foundry | Foundry `forge test` | `contracts.yml` → job `foundry` |
| SDK (`@oversync/sdk`) | 8 | Vitest | `ci.yml` → job `typescript` |
| Coordinator | 4 | Vitest | `ci.yml` → job `typescript` |
| Frontend | Vitest | Vitest | `ci.yml` → job `typescript` |

To run all tests locally:

```bash
pnpm --filter @oversync/sdk test             # 8 SDK tests
pnpm --filter @oversync/coordinator test     # 4 coordinator tests
pnpm --filter @oversync/contracts exec hardhat test test/v2  # 21 EVM tests
cd soroban && cargo test --release           # 16 Soroban tests
```

Reference: [`docs/REVIEW_RESPONSE.md § Verification commands`](REVIEW_RESPONSE.md#verification-commands).

---

## 6. Roadmap and milestones

Full document with delivery status: [`ROADMAP.md`](../ROADMAP.md).

### Summary by quarter

| Quarter | Theme | Status |
|---|---|---|
| Q2 2026 (current) | v2.0 rebuild — Soroban HTLC, EVM v2 contracts, open resolver network, coordinator rewrite, SDK, frontend, CI/CD, documentation | ✅ All 8 phases shipped |
| Q3 2026 | Audit preparation — Foundry fuzz, Slither CI gate, differential test harness, Sepolia load test, Postgres migration, observability | 🛠 In progress |
| Q4 2026 | Independent audits — two audit firms (EVM + Soroban), remediation, bug bounty launch, multisig migration | 🗓 Scheduled |
| Q1 2027 | Mainnet launch — EVM + Soroban mainnet deployment, first 3 community resolvers, Axelar ITS adapter, CCTP v2 fast-path | 🗓 Scheduled |
| Q2–Q3 2027 | v2.1 — partial fills, non-XLM Soroban assets, 1inch Fusion+ mesh integration, DAO governance | ⏳ Post-mainnet |

**Exit criterion for mainnet:** both HTLC contracts audited (public reports), all medium+ findings remediated, bug bounty open ≥ 14 days with no critical reports, `ResolverRegistry.owner` on multisig, at least 3 active community resolvers.

---

## 7. Implementation status

This table maps v1 reviewer concerns to v2 completed deliverables. The full point-by-point response is in [`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md).

| Component | v1 state | v2 state | Verifiable artefact |
|---|---|---|---|
| Stellar HTLC | Claimable balance with coordinator-custodial unconditional claimants | **Shipped** — Soroban HTLC contract with sha256 hashlock + timelock | [`soroban/contracts/htlc/src/lib.rs`](../soroban/contracts/htlc/src/lib.rs), 10 unit tests |
| EVM HTLC | Three overlapping contracts, resolver allowlist not enforced | **Shipped** — single canonical `HTLCEscrow` | [`contracts/contracts/v2/HTLCEscrow.sol`](../contracts/contracts/v2/HTLCEscrow.sol), 15 Hardhat tests |
| Resolver registry | None | **Shipped** on EVM + Soroban | [`contracts/v2/ResolverRegistry.sol`](../contracts/contracts/v2/ResolverRegistry.sol), [`soroban/contracts/resolver-registry/`](../soroban/contracts/resolver-registry/) |
| Operator model | Single privileged relayer | **Open registry** — anyone who stakes can run a resolver | [`resolver/`](../resolver/), [`docs/RESOLVERS.md`](RESOLVERS.md) |
| Refunds | Mocked (`relayer/src/recovery-service.ts` logged a fake hash) | **Four-layer real refund stack** | [`ARCHITECTURE.md § 6`](../ARCHITECTURE.md#6-refund-mechanisms) |
| Order persistence | In-memory `Map`, lost on restart | **SQLite-backed coordinator** with XState-style state machine | [`coordinator/`](../coordinator/) |
| Transaction history | Hard-coded mock entries + fake hashes | Real coordinator API + on-chain events, mock entries filtered out | [`frontend/src/components/TransactionHistory.tsx`](../frontend/src/components/TransactionHistory.tsx) |
| Console output in prod | Sensitive state logged to browser devtools | All `console.*` stripped via Vite `esbuild.drop` | [`frontend/vite.config.ts`](../frontend/vite.config.ts) |
| Mainnet exposure | v1 mainnet path active in UI | **Disabled** — `VITE_MAINNET_ENABLED=false`; UI shows **Mainnet Coming** | [`frontend/src/config/networks.ts`](../frontend/src/config/networks.ts) |
| Audits | None | Pre-audit hardening complete; independent audits scheduled Q4 2026 | [`docs/SECURITY.md`](SECURITY.md) |

---

## 8. Budget and grant scope

Full budget breakdown: [`docs/REVIEW_RESPONSE.md § Budget`](REVIEW_RESPONSE.md#9-budget-items-dont-match-grant-guidelines).

**Total request: $40,000 USD** across two tranches.

| Tranche | Deliverable | Amount |
|---|---|---|
| 1 — Audit preparation | Foundry fuzz + invariant suite; Slither must-not-fail CI gate; cross-chain differential test harness | $8,000 |
| 1 — Soroban hardening | Resolver registry binding enforcement; partial-fill support; additional unit tests; testnet load test | $7,000 |
| 1 — Coordinator productionising | Postgres migration; horizontal scaling test; observability (Prometheus + Grafana) | $5,000 |
| 2 — Bug bounty bootstrap | Initial bounty pool (Immunefi or comparable) | $5,000 |
| 2 — Resolver onboarding | Grants for first 3 community resolvers | $9,000 |
| 2 — Beta program | Bridge insurance fund (returned if unused) | $6,000 |

Audit firm fees are funded separately (not from this grant). Tranche 2 is conditional on Tranche 1 deliverables shipping.

### Stellar-only work scope

The grant is SCF-funded and targets Stellar-specific value. All Stellar-exclusive deliverables:

| Deliverable | Stellar relevance | Status |
|---|---|---|
| [`soroban/contracts/htlc/`](../soroban/contracts/htlc/) — native Soroban HTLC in Rust | First native HTLC on Soroban; replaces v1 claimable-balance custody | ✅ Shipped + deployed on Stellar testnet |
| [`soroban/contracts/resolver-registry/`](../soroban/contracts/resolver-registry/) — Soroban resolver registry | Stake + slash registry for Stellar-side resolvers | ✅ Shipped + deployed |
| [`packages/sdk/src/soroban/`](../packages/sdk/src/soroban/) — TypeScript bindings | SDK wrapping `create_order`, `claim_order`, `refund_order` with any Stellar wallet | ✅ Shipped |
| Soroban contract hardening (Q3 2026) | Resolver binding enforcement, partial fills, load test | 🛠 In progress |
| Stellar-side resolver tooling | Docker image + runner for Soroban order watching + signing | ✅ Shipped ([`resolver/`](../resolver/)) |
| Axelar ITS adapter (Q1 2027) | Allows Axelar-wrapped assets on Stellar as destination | 🗓 Scheduled |
| CCTP v2 fast-path (Q1 2027) | USDC via CCTP + XLM via OverSync HTLC in one flow | 🗓 Scheduled (behind feature flag until CCTP v2 Stellar mainnet) |

---

## 9. Onboarding documentation

### Operators (running the coordinator)

- [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) — step-by-step deployment guide: Soroban contracts → EVM contracts → coordinator → resolver → frontend.
- [`coordinator/README.md`](../coordinator/README.md) — coordinator architecture, API endpoints, health check, SQLite vs Postgres config.
- [`env.example`](../env.example) — annotated environment variable reference for all services.

### Resolvers (community operators filling orders)

- [`docs/RESOLVERS.md`](RESOLVERS.md) — complete guide: prerequisites, `env` config, registration (stake into registry), running the runner, withdrawing stake, security checklist.
- [`resolver/`](../resolver/) — open-source resolver runner + Docker image.
- Docker: `docker run ghcr.io/oversync/resolver:latest run`

### Contributors (developers opening PRs)

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — prerequisites, repo layout, local setup, CI test matrix commands, PR expectations, security disclosure path.
- Quick-start in [`README.md § Quick start`](../README.md#quick-start).
- Soroban-specific setup in [`soroban/README.md`](../soroban/README.md).

---

## 10. Known risks and mitigations

Sourced from [`ROADMAP.md § Open dependencies and risks`](../ROADMAP.md#open-dependencies-and-risks) and [`docs/TRUST_MODEL.md`](TRUST_MODEL.md).

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **`ResolverRegistry.owner` is a single EOA on testnet** | Low (testnet only) | High if replicated to mainnet | Transfer to 2-of-3 multisig before mainnet deployment; DAO governance after 30 days. Documented in [`docs/TRUST_MODEL.md § Compromised resolver slash privilege`](TRUST_MODEL.md#compromised-resolver-slash-privilege) and [`docs/DEPLOYMENT.md § Mainnet rollout checklist`](DEPLOYMENT.md#mainnet-rollout-checklist). |
| **Contracts unaudited pre-mainnet** | Certain (by design) | High | Mainnet is hard-gated on two independent audits. No mainnet deployment until reports are public. See [`docs/SECURITY.md`](SECURITY.md). |
| **Resolver network cold-start** | Moderate | Medium (liveness, not fund safety) | Bootstrap grant pool in Tranche 2 ($9k for first 3 resolvers). Open resolver protocol means community actors can fill without team involvement. |
| **Solo-team bus factor** | Moderate | Medium | Open resolver protocol keeps bridge alive without core team. CI + docs reduce contributor onboarding friction. Formal team expansion planned post-Tranche 1. |
| **Audit findings push Q1 2027 mainnet** | Possible | Low (funds are safe on testnet) | We ship to mainnet when audits are clean. No hard pre-announced date. See [`ROADMAP.md § Q4 2026`](../ROADMAP.md#q4-2026----independent-audits). |
| **CCTP v2 Stellar mainnet timing slips** | Possible | Low (isolated) | Affects only the CCTP v2 fast-path composability feature. Independent of the core HTLC bridge. |
| **Coordinator DDoS** | Low | Low (liveness only) | Cloudflare/rate-limit in front of public deployment. Users can refund directly from contracts even with coordinator offline. |
| **Differential test gap** | Present (scheduled Q3 2026) | Low — addressed by independent unit tests on each chain | Cross-chain differential test harness (`e2e/cross-chain.test.ts`) is a Q3 2026 milestone. Current: 10 Soroban + 15 EVM unit tests, each chain independently verified. |

---

## Standalone verification

A reviewer with `pnpm`, `cargo`, and Node 22.5+ can verify all major claims independently:

```bash
# Clone and install
git clone https://github.com/karagozemin/OverSync-1nchFusion
cd OverSync-1nchFusion
pnpm install

# TypeScript tests (SDK + coordinator + EVM contracts)
pnpm --filter @oversync/sdk test
pnpm --filter @oversync/coordinator test
pnpm --filter @oversync/contracts exec hardhat test test/v2

# Soroban unit tests
cd soroban && cargo test --release && cd ..

# Confirm testnet contract existence (no auth required)
curl https://soroban-testnet.stellar.org \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getContractData","params":{"contract":"CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK","key":"AAAAA==","durability":"persistent"}}'
```

All four on-chain addresses are independently verifiable on Sepolia Etherscan and Stellar Expert using the links in [§ 1](#1-live-testnet-contracts). No information in this document is invented; every claim links to source code, a deployed contract, or a public block explorer.

---

*Document version: June 2026. For review feedback history, see [`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md). For the full architecture, see [`ARCHITECTURE.md`](../ARCHITECTURE.md).*

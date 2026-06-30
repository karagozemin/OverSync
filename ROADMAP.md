# OverSync v2 — Roadmap

The bridging landscape is moving fast: Circle's CCTP v2 entered Stellar
testnet in April 2026, Axelar's Interchain Token Service shipped on
Stellar mainnet on 16 February 2026, and Allbridge keeps adding pools.
OverSync is not racing to compete with them on coverage. We are
shipping a focused product — trust-minimised native cross-chain swaps
between Ethereum and Stellar — and the roadmap below reflects that.

Every milestone has a concrete deliverable, a verification artefact and
a status flag. Dates beyond the current quarter are intentionally
ranges, not pinpoint commitments, because audit timelines and bug-bounty
findings move them.

Legend: ✅ shipped · 🛠 in progress · 🗓 scheduled · ⏳ depends on prior milestone

---

## Current production status (May 2026)

| Environment | Bridge stack | Public UI | Live contracts |
|---|---|---|---|
| **Testnet** (Sepolia + Stellar testnet) | **v2 — decentralized HTLC + open resolver network** | **Active** — default and only public mode | EVM: `HTLCEscrow` `0xb352339B…bB178`, `ResolverRegistry` `0x7D9ce70A…1D99`. Soroban: `CDIKSJK…6JK`, `CBSR7Z4…WGF` |
| **Mainnet** (Ethereum + Stellar public) | **v1 — single-relayer bridge** (legacy, retained in repo) | **Disabled** — frontend shows **Mainnet Coming** (`VITE_MAINNET_ENABLED=false`) | v1 EVM HTLC: `0x87372d4b…b73E`; 1inch escrow factory: `0xa7bcb4ea…df99a` |

The public dApp is **testnet-only** until v2 passes audit and mainnet
launch (Q1 2027 target). Legacy v1 mainnet contracts may still exist
on-chain from earlier deployments, but the UI does not route new users
through that path. Re-enable the mainnet toggle only after audit by
setting `VITE_MAINNET_ENABLED=true` in the frontend env (see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)).

---

## Q2 2026 — v2.0 rebuild (current quarter)

| Milestone | Status | Deliverable |
|---|---|---|
| Phase 0 — repository cleanup, remove mock data, single canonical EVM contract path | ✅ | Branch `v2-rebuild`; obsolete docs removed; env example fixed |
| Phase 1 — Soroban HTLC contract | ✅ | `soroban/contracts/htlc/`; 10 unit tests passing |
| Phase 2 — EVM v2 contracts | ✅ | `contracts/contracts/v2/`; 21 Hardhat tests passing |
| Phase 3 — open resolver network | ✅ | `resolver/` runner + Docker image + `docs/RESOLVERS.md` |
| Phase 4 — coordinator full rewrite | ✅ | `coordinator/`; 4 service tests passing |
| Phase 5 — shared `@oversync/sdk` | ✅ | `packages/sdk/`; 8 unit tests |
| Phase 6 — frontend rewrite | ✅ | Refund dialog, network-mode hook, production console strip |
| Phase 7 — CI/CD pipelines | ✅ | `.github/workflows/{ci,contracts,release}.yml` |
| Phase 8 — documentation rewrite | ✅ | README, ARCHITECTURE, TRUST_MODEL, DIFFERENTIATION, SECURITY, DEPLOYMENT |

## Q3 2026 — Audit preparation and launch hardening

| Milestone | Status | Deliverable | Verifiable on |
|---|---|---|---|
| Foundry fuzz + invariant suite for `HTLCEscrow.sol` | 🛠 | `contracts/test/foundry/` directory + CI gate | GitHub Actions |
| Slither must-not-fail CI gate (currently advisory) | 🛠 | Slither failure breaks the build | GitHub Actions |
| Differential test harness across EVM ↔ Soroban (same hashlock and preimage round-trip) | 🗓 | `e2e/cross-chain.test.ts` | Local + CI |
| Sepolia load test (1k concurrent orders, 2-week soak) | 🗓 | Public Sepolia dashboard + report (harness: [`e2e/load-test/`](e2e/load-test/harness.ts) · dry-run: `pnpm load-test` · live: `pnpm load-test:live`) | Dashboard URL |
| Soroban resolver-registry binding enforcement in HTLC (currently soft) | 🗓 | Contract upgrade + 2 new tests | Soroban testnet |
| Coordinator Postgres migration path | 🗓 | `coordinator/migrations/` + integration test | CI |
| Coordinator observability stack (Prometheus + Grafana) | 🗓 | `coordinator/ops/` Docker compose | Repo |

**Exit criterion:** all Q3 milestones complete, no high-severity issues
open from internal review, then engage external auditors.

## Q4 2026 — Independent audits

| Milestone | Status | Deliverable | Verifiable on |
|---|---|---|---|
| Audit firm A — EVM contracts (HTLCEscrow + ResolverRegistry) | 🗓 | Public audit report | Auditor's site + repo |
| Audit firm B — Soroban contracts (oversync-htlc + oversync-resolver-registry) | 🗓 | Public audit report | Auditor's site + repo |
| Remediation diff and re-audit pass | 🗓 | Annotated PRs linking findings to fixes | GitHub |
| Bug bounty programme launched (Immunefi or comparable) | 🗓 | Bounty programme URL | Immunefi |
| Multisig migration of `ResolverRegistry.owner` (2-of-3 testnet, prep for mainnet) | 🗓 | Multisig address committed to repo | Etherscan / Stellar Expert |

**Exit criterion:** two audits public, all medium+ findings remediated,
bounty open for 14 days with no critical reports.

## Q1 2027 — Mainnet launch (and "not isolated" composability)

Stellar's bridging surface area has changed materially in Q1 2026:
Axelar ITS is **live on Stellar mainnet** since 16 February 2026, and
Circle's CCTP v2 testnet support landed in April 2026 with mainnet
imminent. We refuse to ship a Stellar HTLC bridge that arrives looking
isolated from the rest of the ecosystem. That means two ecosystem
adapters that were originally scoped to v2.1 are being pulled forward
into the mainnet tranche.

| Milestone | Status | Deliverable | Verifiable on |
|---|---|---|---|
| Mainnet deployment of EVM contracts | 🗓 | Deployed addresses in `deployments.mainnet.json`, verified on Etherscan | Etherscan |
| Mainnet deployment of Soroban contracts | 🗓 | Deployed contract ids in `deployments.public.json` | Stellar Expert |
| Coordinator production deployment (behind CDN/WAF) | 🗓 | Live coordinator URL with SLOs published | Status page |
| First three community resolvers onboarded | 🗓 | 3 registered addresses, ≥30 days active | Registry contract |
| 14-day continuous mainnet TVL > $1k with zero incidents | 🗓 | Public dashboard of TVL + volume + uptime | Dashboard |
| **Axelar ITS adapter** — any Axelar-wrapped asset on Stellar can be the destination leg of an OverSync swap (pulled forward from v2.1) | 🗓 | Reference resolver that unwraps via Axelar after our HTLC settles + e2e test on Stellar mainnet | Repo + Stellar Expert |
| **CCTP v2 composable fast path** — frontend can route the USDC leg of a swap through CCTP v2 while the native-asset leg uses OverSync HTLC (pulled forward from v2.1, ships behind a feature flag until CCTP v2 hits Stellar mainnet) | 🗓 | `ExternalBridgeRoute` adapter in `@oversync/sdk` + frontend toggle + integration test | Repo |

**Exit criterion:** all above shipped; we transition from "beta" to
"public release" in repo README.

## Q2–Q3 2027 — v2.1 deepening

With the headline ecosystem adapters delivered alongside mainnet, the
v2.1 work focuses on protocol depth rather than connectivity.

| Milestone | Status | Deliverable |
|---|---|---|
| Partial fills on the Soroban side (parity with EVM) | 🗓 | Updated `oversync-htlc` + tests |
| Soroban non-XLM Soroban asset support in the SDK | 🗓 | `@oversync/sdk` 2.1 with multi-asset orders |
| 1inch Fusion+ resolver mesh public integration | ⏳ | Joint announcement + co-published runner |
| DAO Timelock + Governor for `ResolverRegistry.owner` | 🗓 | Governance contracts deployed; multisig retires |
| Off-chain resolver auction protocol (replaces FCFS fills with sealed-bid auction) | 🗓 | Spec + reference resolver implementation |

These v2.1 items are deliberately optional and ship based on real
demand from integrators after mainnet.

---

## Cross-cutting commitments

- **Open source.** All code in this repository is MIT-licensed. The
  resolver runner image is on GitHub Container Registry.
- **No silent admin moves.** Every change to a privileged on-chain
  role (`ResolverRegistry.owner`, future DAO) is announced in `CHANGELOG.md`
  before the on-chain transaction is sent.
- **Audit-first.** No mainnet contract is deployed before its audit
  report is public. The exception is the testnet builds we already
  ship for review.
- **Real metrics only.** No uptime / volume / TVL claim appears in
  marketing material that is not verifiable on a public dashboard.

## Open dependencies and risks

For a comprehensive tracking of external blockers, audit schedules, resolver coldstart incentives, RPC dependencies, and tooling status, see the detailed [Roadmap Dependency Tracker](docs/ROADMAP_DEPENDENCIES.md).


# OverSync v2 — Mainnet Readiness Scorecard

**Mainnet (`VITE_MAINNET_ENABLED=true`) remains disabled until every gate
below reaches Green.** This is enforced at the code level (the frontend
network-mode hook hard-rejects the mainnet path) and documented in
[`docs/DEPLOYMENT.md`](DEPLOYMENT.md). No launch date is promised in this
document; dates below are targets that depend on audit scheduling and
finding-severity outcomes.

Update this file whenever gate status changes. Every change must link to
the on-chain transaction, audit report URL, or CI run that produced the
evidence.

---

## Status legend

| Colour | Meaning |
|---|---|
| Green | Criterion fully met; evidence link present |
| Yellow | Partially met or in-progress; specific gap described |
| Red | Not started or explicitly blocked |

---

## Gate 1 — Audit status

**Criterion.** Both in-scope contracts are independently audited, all
Medium-or-higher findings are remediated, and the public audit reports are
committed to this repository.

| Sub-criterion | Status | Evidence / blocker |
|---|---|---|
| `HTLCEscrow.sol` + `ResolverRegistry.sol` audited by an independent firm | Red | No audit engaged yet. Prerequisite: Q3 Foundry fuzz suite complete (see [ROADMAP.md §Q3](../ROADMAP.md)). |
| `oversync-htlc` + `oversync-resolver-registry` (Soroban) audited by an independent firm | Red | Same prerequisite. Soroban-specific audit capacity is limited; firm shortlist not yet finalised. |
| All Medium+ findings remediated; remediation diff linked in repo | Red | Depends on audits above. |
| Public audit reports committed under `docs/audits/` | Red | Depends on audits above. |
| EVM differential test (`e2e/cross-chain.test.ts`) passing in CI | Yellow | Harness exists ([`e2e/cross-chain.test.ts`](../e2e/cross-chain.test.ts)); differential hashlock parity test not yet wired in CI (see [SECURITY.md audit checklist](SECURITY.md)). |

**Green definition.** Two public audit reports in `docs/audits/`, zero open
Medium+ findings, differential test green in CI.

**Yellow definition.** One audit complete, one in progress, or all findings
are Low/Informational.

**Red definition.** No audits complete, or any open Medium+ finding without
a merged remediation.

**Current status: Red.**

---

## Gate 2 — Testnet uptime and swap count

**Criterion.** The v2 testnet stack (coordinator + reference resolver +
contracts) sustains a continuous 14-day window with measurable swap
throughput and no coordinator-caused fund-loss events.

| Sub-criterion | Status | Evidence / blocker |
|---|---|---|
| Coordinator hosted and publicly reachable | Green | Hosted on Render; source at [`coordinator/`](../coordinator/). |
| Soroban HTLC deployed on Stellar testnet | Green | [`CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK`](https://stellar.expert/explorer/testnet/contract/CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK) |
| `HTLCEscrow` deployed on Sepolia | Green | [`0xb352339BEb146f2699d28D736700B953988bB178`](https://sepolia.etherscan.io/address/0xb352339BEb146f2699d28D736700B953988bB178) |
| 14-day continuous testnet run with ≥ $1k equivalent TVL and zero incidents | Red | Soak test planned for Q3 2026 ([ROADMAP.md §Q3](../ROADMAP.md)). Harness exists at [`e2e/load-test/`](../e2e/); requires live executor. |
| Public testnet metrics dashboard (orders, refunds, latency) | Yellow | Prometheus + Grafana stack is a Q3 milestone; [`coordinator/ops/`](../coordinator/) not yet published publicly. |

**Green definition.** 14 consecutive days without a coordinator-caused
incident, metrics dashboard publicly accessible, TVL ≥ $1k sustained.

**Yellow definition.** Testnet live and processing swaps but < 14 days
continuous or no public dashboard.

**Red definition.** Testnet not live, or a coordinator-caused fund-loss
event recorded in the soak window.

**Current status: Yellow** — testnet contracts and coordinator are live,
but the 14-day soak run has not yet been executed.

---

## Gate 3 — Refund success

**Criterion.** All four refund layers work correctly under adversarial
conditions, demonstrated by automated tests and a clean soak window.

| Sub-criterion | Status | Evidence / blocker |
|---|---|---|
| On-chain `refundOrder` callable by anyone after timelock | Green | Covered in Hardhat test suite (`test/v2/HTLCEscrow.test.ts`) and Soroban tests (`soroban/contracts/htlc/`); CI-gated. |
| Frontend refund dialog triggers correct on-chain call | Green | [`frontend/src/features/refund/RefundDialog.tsx`](../frontend/src/features/refund/RefundDialog.tsx); covered in frontend unit tests. |
| Automatic XLM refund on ETH-leg failure | Green | [`relayer/src/xlm-refund.ts`](../relayer/src/xlm-refund.ts). |
| Background watchdog refunds XLM→ETH swaps pending > 5 min | Green | [`relayer/src/refund-watchdog.ts`](../relayer/src/refund-watchdog.ts); 60-second scan interval. |
| Refund success rate ≥ 99% over 14-day soak window | Red | Metric not yet collected; depends on Gate 2 soak run. |
| Mean refund time ≤ timelock + 30 min (coordinator SLO from [TRACTION.md §6](TRACTION.md)) | Red | No live data yet; depends on soak run. |

**Green definition.** All four refund layers pass automated tests, AND
soak-window data shows ≥ 99% refund success rate with mean refund time
within SLO.

**Yellow definition.** All four layers pass tests but no live soak data yet.

**Red definition.** Any refund layer failing its automated test, or soak
data showing < 99% refund success.

**Current status: Yellow** — all four layers implemented and unit-tested;
live soak data pending.

---

## Gate 4 — Resolver participation

**Criterion.** At least three independent community resolvers are actively
staked and filling orders before mainnet launch.

| Sub-criterion | Status | Evidence / blocker |
|---|---|---|
| Open resolver runner published and documented | Green | [`resolver/`](../resolver/) Docker image + [`docs/RESOLVERS.md`](RESOLVERS.md). |
| `ResolverRegistry` accepting stake registrations on testnet | Green | [`0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99`](https://sepolia.etherscan.io/address/0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99) |
| ≥ 3 distinct community resolver addresses staked on testnet | Red | Currently only the reference resolver is operational. Partner outreach in progress (see [`docs/PARTNER_MAP.md`](PARTNER_MAP.md)). |
| ≥ 3 resolvers active on mainnet for ≥ 30 days before public launch | Red | Depends on testnet participation first. |
| Resolver coldstart bootstrap grant pool approved | Red | Flagged as a Tranche 2 funding ask; not yet approved (see [`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md)). |

**Green definition.** ≥ 3 independent resolver addresses with active stake
on the mainnet `ResolverRegistry`, each having filled at least one order in
the preceding 30 days.

**Yellow definition.** ≥ 1 community resolver active on testnet; mainnet
onboarding not yet started.

**Red definition.** Only the reference resolver is operational; no community
resolvers have staked.

**Current status: Red.**

---

## Gate 5 — Observability

**Criterion.** Production coordinator exposes metrics that let operators
and users independently verify bridge health.

| Sub-criterion | Status | Evidence / blocker |
|---|---|---|
| Coordinator `/metrics` Prometheus endpoint | Yellow | Prometheus + Grafana stack is a Q3 2026 milestone; endpoint structure defined but not yet deployed publicly ([ROADMAP.md §Q3](../ROADMAP.md)). |
| Public Grafana (or equivalent) dashboard for TVL, volume, latency, refund rate | Red | Planned under `coordinator/ops/` Docker Compose; not yet live. |
| Coordinator behind CDN / WAF with rate-limiting | Red | Reference deployment (Render) lacks WAF; production hardening is a mainnet-launch prerequisite per [DEPLOYMENT.md](DEPLOYMENT.md). |
| p50 / p95 swap settlement latency published and meeting SLO | Red | No live data. |
| Coordinator Postgres migration path (replaces SQLite for production scale) | Red | Planned for Q3 2026 ([ROADMAP.md §Q3](../ROADMAP.md)). |

**Green definition.** `/metrics` endpoint live, public dashboard accessible,
coordinator behind CDN/WAF, p50/p95 latencies published and within SLO.

**Yellow definition.** Metrics endpoint exists but dashboard not public, or
CDN not yet in place.

**Red definition.** No metrics endpoint, no dashboard, coordinator exposed
directly to internet without rate-limiting.

**Current status: Red.**

---

## Gate 6 — Bug bounty

**Criterion.** A public bug bounty programme is live before mainnet
contracts are deployed, giving security researchers time to review with
financial incentive.

| Sub-criterion | Status | Evidence / blocker |
|---|---|---|
| Bug bounty platform selected (Immunefi or equivalent) | Red | Not yet contacted ([TRACTION.md §4](TRACTION.md)). |
| Bounty scope and reward tiers published | Red | Depends on audit completion (Gate 1); scope is defined post-audit. |
| Bounty programme live ≥ 14 days before mainnet activation | Red | Timing constraint; cannot be met until Gate 1 and Gate 5 are Green. |
| Responsible disclosure contact (`security@oversync.app`) published | Green | Documented in [SECURITY.md](SECURITY.md); 48h acknowledgement committed. |

**Green definition.** Bounty programme live on Immunefi (or equivalent)
with published scope and reward tiers, open for at least 14 days without
a critical report, and no outstanding critical findings.

**Yellow definition.** Platform selected and terms drafted; not yet
publicly live.

**Red definition.** No bounty programme planned or contact for responsible
disclosure not published.

**Current status: Red** — responsible disclosure contact is published;
formal bounty programme not yet opened.

---

## Gate 7 — Governance / multisig

**Criterion.** Privileged on-chain roles are transferred from the deploying
EOA to a multisig before any mainnet funds are accepted.

| Sub-criterion | Status | Evidence / blocker |
|---|---|---|
| `ResolverRegistry.owner` (EVM) transferred to a 2-of-3 multisig | Red | Currently the deploying EOA on testnet. Multisig migration is a Q4 2026 deliverable ([ROADMAP.md §Q4](../ROADMAP.md)). |
| Stellar equivalent governance role migrated to multisig | Red | Same timeline. |
| Multisig address committed to repo and verified on Etherscan + Stellar Expert | Red | Depends on multisig setup. |
| Slash beneficiary is not the deploying EOA | Red | On testnet the deploying address is the slash beneficiary; must change pre-mainnet ([TRUST_MODEL.md](TRUST_MODEL.md)). |
| DAO timelock + Governor contract deployed (v2.1 — optional for initial mainnet) | Red | Scoped to v2.1 ([ROADMAP.md §Q2-Q3 2027](../ROADMAP.md)); not required for initial mainnet launch, but must be on the public roadmap. |

**Green definition.** `ResolverRegistry.owner` on both chains is a
verifiable multisig address (≥ 2-of-3), slash beneficiary is not the
deploying EOA, and addresses are committed to `deployments.mainnet.json`.

**Yellow definition.** Multisig created and tested on testnet; mainnet
transfer not yet executed.

**Red definition.** Privileged roles still held by a single EOA.

**Current status: Red.**

---

## Known blockers (summary)

The following items are the hard prerequisites that determine when any gate
can turn Green. They are listed in dependency order.

| # | Blocker | Blocks gate(s) | Owner |
|---|---|---|---|
| B-1 | Foundry fuzz + invariant suite complete and CI-gated | Gate 1 (audit prerequisite) | Engineering |
| B-2 | EVM ↔ Soroban differential test wired into CI | Gate 1 | Engineering |
| B-3 | Audit firm(s) contracted and capacity reserved for Q4 2026 | Gate 1 | Business dev |
| B-4 | 14-day Sepolia soak run executed and dashboard published | Gate 2, Gate 3 | Engineering / DevOps |
| B-5 | ≥ 3 community resolvers onboarded to testnet | Gate 4 | Partnership / marketing |
| B-6 | Resolver bootstrap grant pool approved | Gate 4 | Funding |
| B-7 | Prometheus + Grafana stack deployed publicly | Gate 5 | Engineering |
| B-8 | Coordinator Postgres migration and CDN/WAF in place | Gate 5 | Engineering / DevOps |
| B-9 | Immunefi (or equivalent) programme configured and live | Gate 6 | Business dev |
| B-10 | Multisig wallets created and ownership transferred | Gate 7 | Engineering / governance |

No mainnet activation will proceed while any of B-1 through B-10 is open
for a gate that has not yet reached Green.

---

## Overall status

| Gate | Status |
|---|---|
| Gate 1 — Audit | Red |
| Gate 2 — Testnet uptime / swap count | Yellow |
| Gate 3 — Refund success | Yellow |
| Gate 4 — Resolver participation | Red |
| Gate 5 — Observability | Red |
| Gate 6 — Bug bounty | Red |
| Gate 7 — Governance / multisig | Red |

**Mainnet is disabled.** `VITE_MAINNET_ENABLED` is `false` in the
production Vercel deployment. It will not be set to `true` until every
gate above shows Green and the final checklist in
[`docs/DEPLOYMENT.md`](DEPLOYMENT.md) is signed off.

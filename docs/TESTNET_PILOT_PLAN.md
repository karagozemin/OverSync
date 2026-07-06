# OverSync 30-Day Testnet Pilot Plan

> **Scope.** This plan covers a structured 30-day community pilot on
> Sepolia + Stellar testnet only. No mainnet deployment is involved.
> No real assets are at risk: all ETH and XLM used are testnet tokens
> obtained from public faucets. The pilot does not require OverSync or
> any participant to take custody of user funds at any point — the HTLC
> contracts enforce this at the protocol level.
>
> Resolves [#95](https://github.com/karagozemin/OverSync/issues/95).

---

## 1. Purpose and Scope

### 1.1 What this plan is

A concrete, measurable programme for validating OverSync v2 testnet
readiness across four participant types. The pilot produces:

- a quantitative record of swap success rates, latency, and resolver
  uptime against the thresholds defined in
  [`docs/KPI_DASHBOARD_SPEC.md`](KPI_DASHBOARD_SPEC.md)
- a resolver onboarding record aligned with SCF Tranche 2 acceptance
  criteria in [`docs/SCF_TRANCHE_ACCEPTANCE.md`](SCF_TRANCHE_ACCEPTANCE.md)
- a public post-pilot report that SCF reviewers and investors can use
  to evaluate mainnet readiness

### 1.2 What this plan is not

- A mainnet launch plan. The public frontend keeps `VITE_MAINNET_ENABLED=false`
  for the duration. Mainnet remains gated on independent audit (Q1 2027).
- A fundraising or liquidity bootstrapping exercise. No resolver is asked
  to post real monetary stake. Testnet minimum stake is 100 XLM SAC
  (test tokens, zero monetary value).
- A user-acquisition campaign. The pilot is a controlled quality gate,
  not a growth sprint.

### 1.3 Networks

| Chain | Network | HTLC contract | Registry contract |
|---|---|---|---|
| Ethereum | Sepolia (chain ID 11155111) | `0xb352339BEb146f2699d28D736700B953988bB178` | `0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99` |
| Stellar | Testnet (`Test SDF Network ; September 2015`) | `CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK` | `CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF` |

Both are the v2 contracts from [`deployments.testnet.json`](../deployments.testnet.json).

---

## 2. Participant Types and Target Counts

### 2.1 Definitions

| Participant type | Who they are | What they do in the pilot |
|---|---|---|
| **Wallet user** | Anyone comfortable with MetaMask and a Stellar wallet (Freighter) | Connect wallets, fund via faucets, complete ETH↔XLM swaps on the public frontend, optionally trigger the refund path |
| **Resolver operator** | Team or individual with dedicated 24/7 server infrastructure; ideally an existing 1inch Fusion+ operator, Stellar validator, or MEV team | Register on-chain, run the resolver runner, fill orders in both directions, maintain uptime during the observation window |
| **Soroban developer** | Rust or TypeScript developer interested in Soroban contract integration or SDK usage | Run the contract test suite, explore the SDK, run the e2e harness, potentially build a thin integration against the testnet contracts |
| **DeFi power user** | Experienced cross-chain user willing to probe edge cases | Complete multiple swaps in both directions, deliberately exercise the refund path, report friction and anomalies |

### 2.2 Target counts and minimum viable pilot size

| Participant type | **Target** | **Minimum viable** | Rationale for minimum |
|---|---|---|---|
| Wallet users | 50 | 20 | Sufficient volume for a statistically meaningful swap success rate sample (≥ 100 swap attempts at 5 swaps/user average) |
| Resolver operators | 5 | 3 | Aligns with SCF Tranche 2 requirement; 3 operators proves the open registry model beyond a single-operator reference deployment |
| Soroban developers | 10 | 5 | Enough to catch documentation gaps and SDK integration friction before mainnet |
| DeFi power users | 15 | 8 | Power users generate the edge-case swap attempts that reveal refund-path and timelock-boundary behaviour |
| **Total** | **80** | **36** | |

**The pilot is considered viable if all four minimums are met simultaneously.**
Reaching the wallet user minimum alone does not constitute a valid pilot; resolver
and developer participation are required to validate the open-resolver model and
developer onboarding story.

---

## 3. Onboarding Flow

### 3.1 Pre-pilot checklist (all participant types)

Every participant completes these steps before their first swap or
dry-run. Steps that apply only to a specific type are marked.

#### Wallets and testnet funds

- [ ] Install **MetaMask** (or compatible EVM wallet) and create a
      Sepolia account.
- [ ] Fund Sepolia account with test ETH:
      `https://sepoliafaucet.com` or `https://faucet.quicknode.com/ethereum/sepolia`
- [ ] Install **Freighter** wallet and create a Stellar testnet account.
      Set network to **Testnet** in Freighter settings.
- [ ] Fund Stellar testnet account with test XLM via Friendbot:
      `https://friendbot.stellar.org?addr=<your_stellar_public_key>`
- [ ] Verify both wallets show non-zero testnet balances before
      attempting any swap.

#### Frontend access

- [ ] Open the public frontend at `https://testnet.oversync.app`.
- [ ] Confirm the network badge shows **Testnet** (not Mainnet).
      The frontend must never show the mainnet selector during the
      pilot — if it does, report it immediately as a bug.
- [ ] Connect MetaMask to Sepolia and Freighter to Stellar Testnet.
      If the `NetworkMismatchBanner` appears, use its one-click
      reconciliation before proceeding.

#### Resolver operators only

- [ ] Read [`docs/RESOLVERS.md`](RESOLVERS.md) and
      [`docs/RESOLVER_ONBOARDING_PACKET.md`](RESOLVER_ONBOARDING_PACKET.md)
      before starting.
- [ ] Provision a server meeting minimum requirements:
      2 vCPU, 4 GB RAM, 20 GB SSD, Node.js 20+, Docker.
- [ ] Clone the repository:
      ```bash
      git clone https://github.com/karagozemin/OverSync.git
      cd OverSync
      cp env.example .env
      ```
- [ ] Set `NETWORK_MODE=testnet` and fill in RPC endpoints and
      contract addresses from `deployments.testnet.json` per
      [`docs/RESOLVER_ONBOARDING_PACKET.md` §4.2](RESOLVER_ONBOARDING_PACKET.md#42-environment-setup).
- [ ] Build and verify wallet balances:
      ```bash
      cd resolver && pnpm install && pnpm build
      node dist/index.js status
      ```
- [ ] Register (stake 100 XLM testnet tokens, zero monetary value):
      ```bash
      node dist/index.js register
      ```
- [ ] Confirm registration: `node dist/index.js status` must show
      `registered: true`.

#### Soroban developers only

- [ ] Clone the repository (same as above).
- [ ] Install Rust + `stellar-cli` + Foundry per `CONTRIBUTING.md`.
- [ ] Run the full test suite to confirm a clean baseline:
      ```bash
      pnpm install
      pnpm --filter @oversync/sdk build
      cd soroban && cargo test --release && cd ..
      pnpm test:e2e
      ```
- [ ] All tests should pass. Any failure before you touch the code is
      a bug — open a GitHub issue.

---

### 3.2 Demo checklist (minimum transactions to count as "active")

A participant is counted as **active** in the pilot only if they
complete every item in the checklist appropriate to their type.
Partial completion is tracked but does not count toward the pilot
minimums in §2.2.

#### Wallet user demo checklist

- [ ] **Swap 1 — ETH → XLM.** Initiate a swap of at least 0.001 ETH.
      Observe both legs settle on-chain. Verify the transaction appears
      in the frontend history with a real Sepolia Etherscan and Stellar
      Expert link.
- [ ] **Swap 2 — XLM → ETH.** Initiate a swap of at least 100 XLM.
      Same verification.
- [ ] **Refund path.** Initiate a swap and then deliberately let its
      timelock expire without claiming. Verify that the frontend shows
      a **Refund ETH** button and that clicking it returns the funds
      on-chain without coordinator involvement.
- [ ] **Complete the feedback form** (see §8).

#### Resolver operator demo checklist

Complete all items in
[`docs/RESOLVER_ONBOARDING_PACKET.md` §5](RESOLVER_ONBOARDING_PACKET.md#5-dry-run-fill-checklist)
plus the following pilot-specific items:

- [ ] Fill at least **five orders in each direction** (ETH→XLM and
      XLM→ETH) during the 30-day window.
- [ ] Maintain ≥ 99% uptime for any **7 consecutive days** within the
      pilot (measured by coordinator heartbeats).
- [ ] Submit resolver evidence (see §9.2 report template) to the core
      team at the end of Week 3.
- [ ] Complete the resolver feedback form (see §8).

#### Soroban developer demo checklist

- [ ] **Run the test suite from scratch** (`cargo test`, `pnpm test:e2e`)
      and confirm all tests pass. Record the output.
- [ ] **Invoke one contract function directly** using `stellar-cli`
      against the testnet deployment. At minimum:
      ```bash
      stellar contract invoke \
        --id CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK \
        --rpc-url https://soroban-testnet.stellar.org \
        --network-passphrase "Test SDF Network ; September 2015" \
        --fn get_order -- --order_id 1
      ```
- [ ] **Write one test** (Rust or TypeScript) that exercises the SDK or
      contracts, even if minimal. Submit it as a GitHub issue or PR.
- [ ] Complete the developer feedback form (see §8).

#### DeFi power user demo checklist

- [ ] Complete all wallet user checklist items.
- [ ] Complete **at least 5 additional swaps**, mixing directions and
      amounts.
- [ ] Attempt a swap with the **minimum possible amount** and record
      whether the coordinator and resolver accepted it.
- [ ] Test the **NetworkMismatchBanner** by temporarily switching
      MetaMask to mainnet mid-flow and confirming the warning appears
      and the one-click fix works.
- [ ] Complete the power user feedback form (see §8).

---

## 4. Week-by-Week Activities (Weeks 1–4)

| Week | Theme | Core activities | Exit gate |
|---|---|---|---|
| **Week 1** | Launch and onboarding | Recruit participants through Stellar Dev Discord `#oversync`, OverSync GitHub, and direct outreach to resolver operators. Publish the onboarding guide and pre-pilot checklist. Support participants through wallet setup, faucet funding, and resolver registration. Core team monitors coordinator health and confirms contract state is clean. | ≥ 15 wallet users onboarded; ≥ 3 resolver operators registered on-chain; ≥ 3 Soroban developers have run the test suite successfully |
| **Week 2** | Volume and resolver dry-runs | All participant types begin executing swaps and dry-runs. Core team tracks swap success rate daily. Resolver operators complete their active fill dry-runs (both directions). Soroban developers submit their first test or issue. DeFi power users begin edge-case testing. Core team reviews coordinator logs for anomalies and publishes a mid-week status update in Discord. | Swap success rate ≥ 90% (Yellow threshold from KPI dashboard); ≥ 2 resolvers have completed fills in both directions |
| **Week 3** | Stress and edge cases | Power users execute refund-path scenarios and minimum-amount swaps. Resolver operators complete their 7-day uptime observation window. Core team runs a simulated coordinator-offline scenario to verify on-chain refund paths work independently. Soroban developers document any integration friction. Core team collects resolver evidence artifacts for the report. First-pass feedback forms distributed. | ≥ 5 refund-path transactions confirmed on-chain; ≥ 3 resolvers have completed 7-day uptime windows; no unresolved Red-threshold KPI breaches |
| **Week 4** | Data collection and report | All participants complete feedback forms. Core team aggregates coordinator metrics, on-chain event counts, and resolver evidence. Draft post-pilot report circulated internally for review. Participants receive a summary of aggregated findings (no individual-level data). Final public report published (see §9). | All feedback forms collected from active participants; report template (§9.2) fully populated; every acceptance criterion in §5 verified as met or explicitly flagged as missed |

---

## 5. Success Metrics and Failure Thresholds

Thresholds are inherited directly from
[`docs/KPI_DASHBOARD_SPEC.md`](KPI_DASHBOARD_SPEC.md) and applied to
the testnet pilot context. All metrics are measured on the
`network: testnet` network designation only.

### 5.1 Decision metrics (pilot outcome gating)

| Metric | Green — pilot passes | Yellow — investigate | Red — pilot paused |
|---|---|---|---|
| **Swap success rate** `(successful / initiated) × 100` | > 98% | 90–98% | < 90% |
| **Median time to finality** (swap initiated → funds delivered) | < 30 s | 30–60 s | > 60 s |
| **Active resolvers** (≥ 1 fill in a 7-day window) | ≥ 5 | 2–4 | < 2 |
| **Refund success rate** (on-chain refund completed / refund attempted) | 100% | n/a | < 100% (any failed refund is a critical bug) |
| **Resolver uptime** (coordinator heartbeats, per registered resolver) | ≥ 99% over any 7-day window | 95–99% | < 95% |

### 5.2 Informational metrics (tracked, do not gate outcome)

- Total swap volume (XLM and ETH denominated, testnet only)
- Total unique participants who completed the active demo checklist
- Number of GitHub issues opened by participants
- Number of SDK tests or integrations submitted by developers

### 5.3 Failure thresholds and stop criteria

The pilot is **paused** (not failed) if any Red-threshold breach
occurs and the root cause is not diagnosed within 48 hours. The pilot
is **failed** (the post-pilot report records an explicit "did not
pass" verdict) under any of the following conditions:

- Swap success rate stays below 90% for more than 3 consecutive days.
- Any on-chain refund fails to return funds to the correct
  `refundAddress` (a contract invariant violation — this would block
  mainnet progression regardless of pilot outcome).
- Fewer than 3 resolver operators complete their full 7-day uptime
  window, meaning the open-resolver model is not demonstrated beyond
  a single reference operator.
- Fewer than 20 wallet users complete the active demo checklist,
  meaning the sample size is too small to assess real-world swap
  reliability.

---

## 6. Data Collected vs. Intentionally Not Collected

### 6.1 Data collected

All collected data is derived from sources that are already public
or aggregated. No additional instrumentation is added to the
frontend or coordinator beyond what is already described in
[`docs/METRICS_SCHEMA.md`](METRICS_SCHEMA.md).

| Data point | Source | Granularity | Used for |
|---|---|---|---|
| Swap initiated count | Coordinator SQLite (`orders` table) | Per-day aggregate | Swap success rate KPI |
| Swap completed count | On-chain `OrderClaimed` events (Sepolia + Stellar testnet) | Per-day aggregate | Swap success rate KPI |
| Swap failed / expired count | On-chain `OrderRefunded` events | Per-day aggregate | Refund success rate |
| Median time to finality | Block timestamps from on-chain events | Per-swap, aggregated to weekly median | Time-to-finality KPI |
| Active resolver count | On-chain `ResolverRegistry` + coordinator heartbeats | Weekly count | Active resolvers KPI |
| Resolver uptime | Coordinator heartbeat pings | Per-resolver, aggregated to 7-day % | Resolver uptime KPI |
| Feedback form responses | Self-reported by participants | Anonymised aggregate | Qualitative findings in report |
| GitHub issues opened by participants | GitHub public API | Count + category | Developer experience findings |

### 6.2 Intentionally NOT collected

The following categories of data are explicitly out of scope. They
will not be collected, stored, logged, or published at any point
during the pilot.

| Category | Reason |
|---|---|
| **Wallet addresses of individual users** | On-chain addresses are public but we do not build a participant → address mapping; users are not identified by their address |
| **IP addresses or browser fingerprints** | The coordinator and frontend do not log IP addresses; no analytics SDK is added during the pilot |
| **User identity** (name, email, social handle) | Participation is pseudonymous; feedback forms are submitted without mandatory identification |
| **Secret preimages** | Preimages are revealed on-chain and are therefore public; the coordinator never logs them and neither does this pilot's reporting |
| **Individual swap amounts linked to individuals** | Swap amounts are emitted by the HTLC contracts and are on-chain public, but the pilot report publishes only aggregate volume figures |
| **Resolver private stake balances or keys** | Resolver evidence (§9.2) includes only aggregate uptime and fill counts, not internal wallet balances |
| **Off-chain financial data** | No USD conversion or fiat-equivalent calculation is published; all figures are testnet denominated |
| **Any mainnet data** | The pilot is testnet-only; no mainnet metrics are gathered, referenced, or mixed into pilot aggregates |

---

## 7. Support Process

### 7.1 Support channels

| Channel | Purpose | Response SLA |
|---|---|---|
| Stellar Dev Discord `#oversync` | Real-time help during onboarding; general questions | Same business day (UTC) |
| GitHub Issues [`karagozemin/OverSync`](https://github.com/karagozemin/OverSync/issues) | Bug reports, documentation gaps, feature requests | 24–48 hours |
| Email `resolver@oversync.app` | Resolver operator private queries; key-handling questions | 48 hours |

### 7.2 Issue severity tiers

| Tier | Definition | Response | Example |
|---|---|---|---|
| **P0 — Critical** | User funds at risk or an on-chain invariant violated | Immediate; pilot paused until resolved | Refund returns to wrong address; HTLC allows double-claim |
| **P1 — Blocker** | Swap path completely broken for one direction; resolver cannot register | Within 4 hours | `claimOrder` reverts on all inputs; resolver `register` fails on testnet |
| **P2 — Degraded** | Swap success rate in Yellow zone; coordinator lag > 30 s | Within 24 hours | RPC rate limits causing event drops; coordinator restarts under load |
| **P3 — Minor** | Documentation unclear; UI label misleading; feedback form broken | Within 48 hours | Incorrect contract address in a doc; confusing error message |

### 7.3 Escalation matrix

| Issue | First contact | Escalation if unresolved in SLA |
|---|---|---|
| Wallet / faucet setup | Discord `#oversync` | GitHub issue with error output |
| Resolver RPC connectivity | `docs/DEPLOYMENT.md` → Discord | GitHub issue |
| Resolver registration failure | `node dist/index.js status` → Discord | GitHub issue with full logs |
| Swap stuck or failed | Frontend order history → GitHub issue | Direct Discord ping to core team |
| Suspected contract bug | GitHub issue (label: `security`) | Email `resolver@oversync.app` |
| Coordinator not routing orders | Confirm at `/api/resolvers/active` → GitHub issue | Direct Discord ping |

---

## 8. Feedback Form Structure

Feedback is collected once per participant at the end of their
active participation, ideally in Week 4. Forms are submitted via a
linked Google Form or Typeform (link published in the pilot kick-off
Discord post). Responses are anonymised before inclusion in the
post-pilot report.

### 8.1 Common fields (all participant types)

| Field | Type | Options / format |
|---|---|---|
| Participant type | Single select | Wallet user / Resolver operator / Soroban developer / DeFi power user |
| Overall experience rating | 1–5 scale | 1 = very poor, 5 = excellent |
| Onboarding time to first swap or dry-run | Estimate | < 15 min / 15–30 min / 30–60 min / > 60 min |
| Was the documentation sufficient? | Yes / Partially / No | — |
| Single biggest friction point | Free text | — |
| Would you use OverSync on mainnet? | Yes / Maybe / No | — |

### 8.2 Wallet user specific fields

| Field | Type |
|---|---|
| Did both swaps (ETH→XLM and XLM→ETH) complete successfully? | Yes / One failed / Both failed |
| Did you test the refund path? | Yes / No |
| If yes — did the refund complete correctly? | Yes / No / Did not try |
| What was your median perceived swap time? | < 2 min / 2–5 min / > 5 min |

### 8.3 Resolver operator specific fields

| Field | Type |
|---|---|
| Infrastructure setup time (from clone to running) | Estimate (hours) |
| Did the resolver runner crash during the pilot? | Yes / No |
| If yes — was the crash self-recoverable? | Yes / No |
| Was the open-source resolver runner documentation clear? | Yes / Partially / No |
| What would prevent you from running a resolver on mainnet? | Free text |

### 8.4 Soroban developer specific fields

| Field | Type |
|---|---|
| Did all tests pass on first run? | Yes / No |
| Did you run the e2e harness? | Yes / No |
| Did you write any integration code or tests? | Yes / No |
| If yes — what did you build? | Free text |
| What is missing from the SDK or documentation for your use case? | Free text |

### 8.5 DeFi power user specific fields

| Field | Type |
|---|---|
| Total swaps completed | Number |
| Did you encounter any swap that did not settle and did not refund? | Yes / No |
| Did you observe any anomalies in the coordinator API responses? | Yes / No |
| Describe any edge-case behaviour you found | Free text |

---

## 9. Post-Pilot Public Report

At the end of Week 4 the core team publishes a public post-pilot
report in `docs/TESTNET_PILOT_REPORT_<YYYY-MM>.md`. This is the
primary accountability artifact for SCF reviewers and investors.

### 9.1 Publication criteria

The report is published regardless of whether the pilot passed or
failed all thresholds. A pilot that surfaces a critical bug is a
successful pilot. The report states outcomes honestly and maps each
KPI to its Green / Yellow / Red result.

### 9.2 Final pilot report template

Copy this template into `docs/TESTNET_PILOT_REPORT_<YYYY-MM>.md`
and fill in each field.

---

```markdown
# OverSync Testnet Pilot Report — <Month YYYY>

> **Pilot period:** <start date> to <end date>
> **Networks:** Sepolia (chain ID 11155111) + Stellar testnet
> **Status:** PASSED / FAILED / INCONCLUSIVE

---

## 1. Participant Summary

| Participant type | Target | Minimum viable | Actual | Met minimum? |
|---|---|---|---|---|
| Wallet users | 50 | 20 | <N> | Yes / No |
| Resolver operators | 5 | 3 | <N> | Yes / No |
| Soroban developers | 10 | 5 | <N> | Yes / No |
| DeFi power users | 15 | 8 | <N> | Yes / No |
| **Total** | **80** | **36** | **<N>** | Yes / No |

---

## 2. KPI Outcomes

| Metric | Target threshold | Result | Status |
|---|---|---|---|
| Swap success rate | > 98% (Green) | <X>% | 🟢 / 🟡 / 🔴 |
| Median time to finality | < 30 s (Green) | <X> s | 🟢 / 🟡 / 🔴 |
| Active resolvers (peak week) | ≥ 5 (Green) | <N> | 🟢 / 🟡 / 🔴 |
| Refund success rate | 100% | <X>% | 🟢 / 🔴 |
| Resolver uptime (best 7-day window) | ≥ 99% | <X>% | 🟢 / 🟡 / 🔴 |

---

## 3. Swap Volume Summary

> All figures are testnet-denominated. No mainnet data. No USD
> equivalents.

- Total swaps initiated: <N>
- Total swaps completed: <N>
- Total swaps refunded (on-chain): <N>
- ETH→XLM swaps: <N>
- XLM→ETH swaps: <N>
- Total testnet ETH swapped: <X> ETH (Sepolia)
- Total testnet XLM swapped: <X> XLM (Stellar testnet)

---

## 4. Resolver Evidence

For each resolver that completed the 7-day observation window:

### Resolver <N>

| Field | Value |
|---|---|
| EVM address | `0x...` |
| Stellar address | `G...` |
| Registration tx | `https://stellar.expert/explorer/testnet/tx/<hash>` |
| ETH→XLM fill (example) | Order ID `<id>` — `https://sepolia.etherscan.io/tx/<hash>` |
| XLM→ETH fill (example) | Order ID `<id>` — `https://stellar.expert/explorer/testnet/tx/<hash>` |
| 7-day uptime | <X>% |
| Total fills | <N> |
| Status | ✅ Onboarded / ❌ Did not complete |

---

## 5. Week-by-Week Summary

| Week | Theme | Exit gate met? | Notes |
|---|---|---|---|
| Week 1 | Launch and onboarding | Yes / No | |
| Week 2 | Volume and resolver dry-runs | Yes / No | |
| Week 3 | Stress and edge cases | Yes / No | |
| Week 4 | Data collection and report | Yes / No | |

---

## 6. Bugs and Issues Opened

| Issue # | Title | Severity | Status |
|---|---|---|---|
| [#<N>](https://github.com/karagozemin/OverSync/issues/<N>) | <title> | P0–P3 | Open / Resolved |

---

## 7. Qualitative Findings

### 7.1 Onboarding friction

> Summarise the most common friction points from feedback forms
> (aggregate only — no individual responses).

### 7.2 Developer experience

> Summarise what Soroban developers built, what they found missing,
> and any test or integration PRs submitted.

### 7.3 Resolver operator feedback

> Summarise resolver setup time, crash frequency, and mainnet
> readiness feedback.

---

## 8. Data collected vs. intentionally not collected

*Data collected:* on-chain event aggregates (swap count, refund
count, resolver registration), coordinator timing histograms,
anonymised feedback form aggregates, GitHub issue counts.

*Intentionally not collected:* wallet addresses linked to
individuals, IP addresses, user identity, secret preimages,
individual swap amounts linked to participants, off-chain financial
data, any mainnet data.

---

## 9. Overall Verdict

**PASSED / FAILED / INCONCLUSIVE**

State whether all four minimum participant counts were met and
whether all KPI decision metrics landed Green or Yellow. If any
Red-threshold breach occurred, describe it and its resolution or
the open action item.

---

## 10. Next Steps

- [ ] Open issues for any unresolved P1/P2 findings
- [ ] Update [`docs/KPI_DASHBOARD_SPEC.md`](KPI_DASHBOARD_SPEC.md)
      thresholds if empirical data warrants revision
- [ ] Share resolver evidence with SCF as Tranche 2 artefact
- [ ] Proceed to / defer mainnet audit gate per
      [`ROADMAP.md`](../ROADMAP.md)
```

---

*This plan is testnet-only. No mainnet deployment. No custody of user
funds. All ETH and XLM referenced are testnet tokens with no monetary
value.*

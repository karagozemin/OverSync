# OverSync — Traction Plan

Traction is the question every serious reviewer asks: *will anyone
actually use this?* This document is the honest plan for how OverSync
earns users, what we are willing to measure publicly, and how we
behave when the numbers are flat.

We deliberately keep this document free of vanity metrics. Numbers
quoted here are either current (with a source URL) or framed as
explicit targets.

---

## 1. Who is the user?

OverSync v2 targets four user segments, in priority order.

### 1.1 Trust-conscious power users

Users who explicitly want HTLC settlement rather than a validator-set
attestation. Today these users self-custody on Ethereum and find
themselves needing Stellar liquidity (or vice versa) for a specific
purpose. Their alternatives are:

- Centralised exchange (custody, KYC).
- A validator-set bridge (Allbridge / Axelar ITS) — accept the
  validator trust assumption.
- Manual atomic swap — high friction, low UX.

Our value to them: HTLC-grade settlement with a normal dApp UX.

### 1.2 Stellar-native protocols seeking ETH liquidity

DEXes, lending markets, and asset issuers on Stellar that want to
plug into ETH-side liquidity (1inch, Uniswap, Curve) atomically.
Allbridge and Axelar wrap the asset, which means downstream
protocols must integrate with a wrapped representation. OverSync
delivers the native asset, which means a Stellar protocol can
interact with the user's actual ETH or ERC-20 balance.

### 1.3 1inch Fusion+ resolver operators

Teams already running Fusion+ resolvers on EVM chains. Today their
inventory ends at the chains 1inch supports. OverSync's resolver
runner uses the same operational pattern (open registry, per-order
escrow, secret-reveal), so adding Stellar to their inventory is a
matter of running another instance of the runner.

### 1.4 Treasuries and OTC desks

Teams doing $25k–$500k cross-chain swaps where the per-swap gas
overhead is irrelevant compared to the trust savings. These users
care that funds cannot be intercepted by a compromised
intermediary; they accept the multi-block HTLC delay.

---

## 2. Why now

Three concurrent trends in the bridging space create the OverSync
opportunity window:

1. **Stellar's bridging surface area is rapidly expanding.** CCTP v2
   landed on Stellar testnet in April 2026 with mainnet imminent.
   Axelar ITS launched on Stellar mainnet in February 2026.
   Allbridge is established but holds only ~$0.45M on Stellar
   (DefiLlama, May 2026). New cross-chain liquidity is arriving on
   Stellar and the market is unsaturated for trust-minimised
   alternatives.
2. **Validator-set bridge fatigue.** $2B+ in cumulative losses to
   bridge hacks have made institutions and power users wary of
   committee-signed bridges. The same audience increasingly asks for
   "an actual HTLC" — a phrase we hear regularly in technical
   reviews.
3. **1inch Fusion+ is normalising the resolver pattern.** Open
   per-order escrows with secret-reveal mechanics are no longer an
   exotic design. The pattern is well-understood, audited, and
   operationally proven on EVM. We extend it to Stellar.

These three trends point at the same product, and to our knowledge no
other team is shipping it.

### 2.1 We are not the only Stellar bridge — and that is good for us

The most common pushback we expect is: *"Axelar ITS is already live
on Stellar, CCTP v2 is coming, Allbridge exists — why does OverSync
need to exist?"* The honest answer is that **none of them addresses
the segment we are aimed at**, and each of them growing strengthens
our position rather than weakening it.

| Bridge that just shipped on Stellar | What they take | What they leave on the table for OverSync |
|---|---|---|
| **CCTP v2** (testnet Apr 2026 → mainnet imminent) | Native USDC ↔ USDC across 15+ chains. Excellent for USDC-only flows. | Every swap that needs the *native* destination asset (XLM, ETH, arbitrary ERC-20) on the other side. CCTP v2 only bridges USDC. |
| **Axelar ITS** (live since Feb 2026) | Wrapped representations of any token, validated by Axelar's signer set. Institutional users who accept the trust model. | Users who refuse validator-set trust assumptions. Users who want the native asset, not a wrapped representation. |
| **Allbridge** (years on Stellar) | Retail wrap-and-bridge volume. | Trust-minimised treasury / OTC / power-user volume on Stellar. Allbridge's total Stellar TVL is ~$0.45M — they have not captured the segment we serve. |

Each of these bridges *adds* to the Stellar cross-chain market.
CCTP v2 going mainnet, in particular, brings significantly more USDC
to Stellar, which means more users land on Stellar wanting to swap
their USDC into native XLM — exactly the kind of atomic swap OverSync
specialises in. We see incumbent growth as our top-of-funnel.

We hard-committed to this thesis by **pulling the Axelar ITS adapter
and the CCTP v2 fast-path forward into our Q1 2027 mainnet launch
tranche** (see [`ROADMAP.md`](../ROADMAP.md)). When OverSync goes
live, it goes live as an integrated piece of the Stellar bridging
mesh, not as an isolated alternative.

---

## 3. Go-to-market

### 3.0 Current public testnet metrics snapshot

The current machine-readable SCF snapshot is committed at
[`docs/scf-testnet-metrics.json`](scf-testnet-metrics.json). It is a
point-in-time testnet evidence file, not a marketing dashboard. It
records deployed contract addresses, explorer links, optional
coordinator health if a public coordinator URL is provided, and explicit
`null` values with reasons for metrics that cannot be fetched reliably.

Regenerate it with:

```bash
pnpm scf:testnet-metrics
```

The script has no package dependencies, so the equivalent direct command
also works:

```bash
node scripts/scf-testnet-metrics.mjs
```

To include a coordinator health check:

```bash
SCF_COORDINATOR_URL=https://<public-coordinator-host> pnpm scf:testnet-metrics
```

Current measurements in the snapshot are deliberately narrow. We do
not report TVL, uptime, swap count, or volume unless the value is
independently verifiable from the snapshot source. The KPI table below
is the future public reporting target for mainnet and mature testnet
operations, not a claim that those numbers already exist today.

### 3.1 Stage 1 — pre-mainnet visibility (now → mainnet launch)

Goal: build a small but engaged audience that is paying attention when
mainnet launches.

| Activity | Cadence | Public artefact |
|---|---|---|
| Public testnet demo on `https://testnet.oversync.app` | Continuous | Live URL |
| Open testnet leaderboard — addresses that submit the most successful swaps | Weekly | Page on the demo site |
| Technical write-up on `oversync.app/blog` — one deep-dive every two weeks (e.g. *"Why we built our own Soroban HTLC"*, *"How the timelock ordering invariant guarantees atomicity"*) | Biweekly | Blog index |
| Office hours in the Stellar dev Discord | Weekly | Discord recording |
| Public dashboard of testnet metrics (orders, refunds, average latency) | Continuous | Grafana-style page |

### 3.2 Stage 2 — mainnet launch (audits cleared)

Goal: convert testnet attention into mainnet usage.

| Activity | Cadence | Deliverable |
|---|---|---|
| Coordinated launch post on Stellar Foundation channels | One-shot | Twitter + Discord + blog |
| Joint announcement with at least one Stellar-native protocol that will route OverSync swaps | One-shot | Partner blog post |
| Bug bounty live (Immunefi or comparable) | Continuous | Programme URL |
| Public mainnet status page with SLOs (uptime, p50/p95 settlement latency, failed-claim rate) | Continuous | Status URL |
| Per-week public reporting of TVL and volume | Weekly | Dashboard URL |

### 3.3 Stage 3 — ecosystem integration (6 months post-mainnet)

Goal: become the default trust-minimised path for Ethereum ↔ Stellar.

- 1inch Fusion+ resolver mesh integration (joint engineering with
  1inch).
- CCTP v2 composable fast path — users can opt into "USDC via CCTP +
  XLM via OverSync HTLC" in a single transaction.
- Axelar ITS adapter — Axelar-wrapped tokens can be the destination
  leg.
- At least one major Stellar wallet (Freighter, Lobstr) ships a
  built-in OverSync flow.

---

## 4. Partnerships we are pursuing

We will not pre-announce partnerships that have not signed an MoU; the
following are categories with named candidates we are in conversation
with as of May 2026. The list will be updated quarterly.

| Category | Why it matters | Conversation status |
|---|---|---|
| Stellar Foundation developer programmes | Credibility + ecosystem distribution | Active |
| 1inch Network | Fusion+ resolver mesh, distribution to EVM users | Initial outreach |
| One major Stellar DEX | Native asset delivery beats wrapping | Initial outreach |
| One Stellar wallet (Freighter / Lobstr) | Built-in bridge UX | Not yet contacted |
| One auditing firm specialising in HTLCs / Soroban | Required pre-mainnet | Shortlist drafted |
| Immunefi or comparable | Bounty programme infrastructure | Not yet contacted |

This document will be updated when any of these progress to formal
status.

---

## 5. KPIs we will publish

Two principles:

1. **No metric is reported unless it is independently verifiable.**
2. **No metric is reported as a smooth curve.** Daily, raw, and
   includes the failures.

| KPI | Source | Cadence |
|---|---|---|
| Total Value Locked (TVL) on mainnet | Sum of `HTLCEscrow` balance + `oversync-htlc` balance | Daily, public dashboard |
| 30-day swap volume | Sum of completed-claim event amounts in USD | Daily |
| Number of registered resolvers | `ResolverRegistry.activeCount()` | Daily |
| Failed-claim ratio (claims that reverted vs total attempts) | Coordinator metric, exposed via `/metrics` | Daily |
| p50 / p95 swap settlement latency | Source: coordinator event index | Daily |
| Mean refund time after timelock expiry | Source: coordinator event index | Weekly |
| Audit reports filed | Public auditor URLs | One-off |
| Open bounty severity findings | Immunefi feed | Continuous |

A flat or down month will be reported truthfully.

---

## 6. How we will know we are failing

These are the negative thresholds that will trigger a public
post-mortem and a roadmap revision. We commit to publishing the
post-mortem within two weeks of the trigger firing.

- TVL ≤ $1k for the first 60 days post-mainnet.
- Failed-claim ratio > 1% over any rolling 7-day window.
- Mean refund time > timelock + 30 minutes (suggests coordinator or
  resolver coordination failure).
- Fewer than 3 community resolvers actively filling orders 90 days
  after launch.
- An audit finding rated critical that we cannot remediate within 14
  days.

Setting these criteria publicly is the strongest commitment we can
make that the project is real.

---

## 7. References

- DefiLlama Allbridge Core protocol page (Stellar TVL, May 2026 snapshot).
- Stellar Foundation blog, *"Circle CCTP V2 is Coming to Stellar"*, April 2026.
- Axelar Network blog, *"Network Integrates Stellar"*, February 2026.
- 1inch Network, Fusion+ resolver documentation.

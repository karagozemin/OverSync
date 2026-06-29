# OverSync Partner & Referrer Map

This document maps target Stellar ecosystem stakeholders, explains why each
cares about trust-minimised HTLC swaps, identifies what they can evaluate
today, and captures the concrete ask plus follow-up state.

No private contact data is stored here. All entries reference public
organisations or ecosystem categories.

---

## How to use this document

| Field | Meaning |
|---|---|
| **Why they care** | The specific angle that makes HTLC atomicity valuable to this stakeholder |
| **Evaluate today** | A concrete link or artefact they can assess right now (testnet, docs, code) |
| **Ask** | The one thing we want from this conversation |
| **Status** | `not-contacted` · `outreach-sent` · `in-conversation` · `closed` |

Update **Status** and **Last touch** whenever a conversation moves.

---

## 1. Stellar Foundation — Developer Programmes

**Why they care.**
The Foundation runs grants, hackathon tracks, and ecosystem-distribution
channels. A non-custodial Soroban HTLC bridge with open-source contracts
is a flagship demonstration of what Soroban enables beyond simple token
transfers. Trust-minimised swaps are a gap they have explicitly flagged
in their developer relations materials.

**Evaluate today.**
- [Soroban HTLC contract](../soroban/contracts/htlc/src/lib.rs) — 10
  passing contract tests, deployed on Stellar testnet.
- [Testnet deployment](https://stellar.expert/explorer/testnet/contract/CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK)

**Ask.** Request a 30-minute technical review call and ask whether the
project qualifies for the Stellar Community Fund or a featured slot in
the developer newsletter.

**Status.** `not-contacted`
**Last touch.** —

---

## 2. Stellar Development Foundation — SCF Grants Committee

**Why they care.**
The Stellar Community Fund specifically funds infrastructure that grows
on-chain utility. An atomic bridge with no privileged signer set is
exactly the kind of permissionless infrastructure that SCF has funded
in previous rounds (anchor tooling, DEX aggregators).

**Evaluate today.**
- [ARCHITECTURE.md](../ARCHITECTURE.md) — invariant proofs, refund-layer
  stack, threat model summary.
- [TRUST_MODEL.md](TRUST_MODEL.md) — STRIDE analysis and per-actor
  trust guarantees.

**Ask.** Submit a grant application and request a reviewer introduction
from any existing SCF grantee who can vouch for the technical depth.

**Status.** `not-contacted`
**Last touch.** —

---

## 3. 1inch Network — Fusion+ Resolver Team

**Why they care.**
Fusion+ resolver operators already operate per-order escrow with
secret-reveal mechanics on EVM chains. OverSync extends that exact
pattern to Stellar. Adding the OverSync resolver runner gives them
XLM-side inventory without changing their operational model. The
`ResolverRegistry` (stake + slash) is directly analogous to the Fusion+
resolver whitelist.

**Evaluate today.**
- [resolver/](../resolver/) — open-source runner + Docker image.
- [docs/RESOLVERS.md](RESOLVERS.md) — how to stake and run against
  the testnet registry.
- [EVM ResolverRegistry](../contracts/contracts/v2/ResolverRegistry.sol)

**Ask.** Request a resolver trial: run the Docker image against testnet
and report whether the operational surface (stake, fill, claim, refund)
matches their existing Fusion+ runbook. Aim for a joint announcement on
the Fusion+ integration ahead of mainnet.

**Status.** `outreach-sent` (initial contact per TRACTION.md)
**Last touch.** May 2026

---

## 4. Freighter Wallet (Stellar Labs)

**Why they care.**
Freighter is the dominant Stellar browser wallet. A built-in OverSync
flow lets Freighter users bridge ETH into XLM without leaving the
wallet. The non-custodial guarantee (user always holds the refund path)
aligns with Freighter's self-custody positioning. No wrapped token sits
between the user and their funds.

**Evaluate today.**
- [Frontend flow](../frontend/src/) — React dApp UI on testnet; the
  Freighter adapter already wires Stellar signing.
- [SDK docs](../packages/sdk/) — `@oversync/sdk` exposes typed order
  primitives that a wallet integration can consume directly.

**Ask.** Request a UX feedback session: have a Freighter team member
complete a testnet swap end-to-end and report friction points. We will
act on every finding before mainnet.

**Status.** `not-contacted`
**Last touch.** —

---

## 5. Lobstr Wallet

**Why they care.**
Lobstr is Stellar's most widely used mobile wallet. Mobile users are
the largest XLM holder demographic. Embedding a trust-minimised bridge
flow natively avoids routing users to a third-party dApp — a common
support and retention concern for Lobstr.

**Evaluate today.**
- Live testnet frontend at `https://testnet.oversync.app` — accessible
  in a mobile browser as a bridge walkthrough.
- [ARCHITECTURE.md §6](../ARCHITECTURE.md) — four-layer refund stack
  that protects non-technical mobile users even if they close the app
  mid-swap.

**Ask.** Wallet UX feedback and an informal discussion on what a
Lobstr-native integration would require (WalletConnect support, deep
link scheme, SDK wrapper). No commitment asked.

**Status.** `not-contacted`
**Last touch.** —

---

## 6. Stellar DEXes — SDEX / Soroswap / Phoenix Protocol

**Why they care.**
DEXes on Stellar need cross-chain liquidity to grow their asset
catalogue. Validator-set bridges deliver wrapped representations
(`axlETH`, `allETH`) that add a layer of smart-contract dependency.
OverSync delivers the native ETH or ERC-20 token, which the DEX can
list directly without wrapping risk. For yield-bearing or rebasing
assets this difference is material.

**Evaluate today.**
- [DIFFERENTIATION.md](DIFFERENTIATION.md) — native vs wrapped asset
  comparison.
- [Soroban HTLC testnet](https://stellar.expert/explorer/testnet/contract/CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK) —
  live contract that DEX developers can inspect.

**Ask.** A technical call to understand their liquidity intake path and
confirm whether a native-asset delivery model opens new listing
categories they cannot support with wrapped assets today.

**Status.** `not-contacted`
**Last touch.** —

---

## 7. Stellar Anchors — MoneyGram, Cowrie, Anclap, Bitso

**Why they care.**
Anchors are the on/off-ramp layer for Stellar. They hold the fiat
settlement risk and need cross-chain capital efficiency. An anchor
serving remittance corridors between Ethereum-ecosystem users and
Stellar end-users benefits from an atomic swap path that does not
introduce a new custody relationship mid-flight.

**Evaluate today.**
- [TRUST_MODEL.md](TRUST_MODEL.md) — proof that coordinator and resolver
  never hold user funds (funds only move via sha256 preimage reveal or
  permissionless refund).
- [TRACTION.md §1.4](TRACTION.md) — treasury/OTC desk value proposition
  at the $25k–$500k swap size that anchors operate in.

**Ask.** A brief discovery call: do any of their corridor flows have an
ETH-side leg where trust-minimised settlement would reduce their
counterparty exposure? No product commitment required.

**Status.** `not-contacted`
**Last touch.** —

---

## 8. Smart Contract Auditing Firms — Trail of Bits, OtterSec, Certora, Kudelski

**Why they care.**
OverSync's Q4 2026 milestone explicitly requires two external audits
(one EVM, one Soroban). Soroban audit capability is rare — few firms
have shipped Soroban audit reports. Early engagement lets auditors
schedule capacity and optionally provide pre-audit guidance that
reduces remediation cycles.

**Evaluate today.**
- [contracts/contracts/v2/](../contracts/contracts/v2/) — 150 lines of
  Solidity; HTLCEscrow + ResolverRegistry. Surface is narrow by design.
- [soroban/contracts/htlc/src/lib.rs](../soroban/contracts/htlc/src/lib.rs)
  — Rust Soroban contract, 10 unit tests.
- [SECURITY.md](SECURITY.md) — STRIDE threat model and auditor checklist.

**Ask.** Request a scoping call to get a capacity commitment for Q4 2026
and an indication of whether the firm has Soroban-specific experience.

**Status.** `not-contacted` (shortlist drafted per TRACTION.md)
**Last touch.** —

---

## 9. Immunefi — Bug Bounty Platform

**Why they care.**
Immunefi hosts bounty programmes for DeFi protocols. A bridge with a
formal bounty programme signals security maturity to both users and
institutional partners. Immunefi benefits from on-boarding a technically
novel HTLC-based protocol — their audience of security researchers
finds HTLC edge-case exploration interesting.

**Evaluate today.**
- [SECURITY.md](SECURITY.md) — attack surface summary and existing
  STRIDE-level threat model.
- [ROADMAP.md §Q4 2026](../ROADMAP.md) — bounty programme is a
  milestone-gated deliverable.

**Ask.** Request a programme-setup consultation to understand scope
definition requirements, minimum bounty sizing, and the review timeline
so we can plan the Q4 launch window accurately.

**Status.** `not-contacted`
**Last touch.** —

---

## 10. Institutional OTC Desks Active on Stellar — Cumberland, Wintermute, GSR

**Why they care.**
OTC desks move large blocks and cannot absorb custodial bridge risk.
$500k crossing a validator-set bridge is $500k exposed to an attester
compromise. An HTLC swap where the worst-case outcome is a timelock
refund — not a validator compromise — is the correct trust model for
institutional settlement at this size.

**Evaluate today.**
- [README.md — Trust model in one paragraph](../README.md) — the clearest
  single-paragraph statement of the guarantee.
- [ARCHITECTURE.md — Refund layers](../ARCHITECTURE.md) — four
  independent recovery paths; even coordinator downtime cannot strand funds.

**Ask.** A short (15-minute) technical brief on the trust model with
focus on worst-case failure modes. No volume commitments asked; we want
a reference customer quote on the trust model for the mainnet launch.

**Status.** `not-contacted`
**Last touch.** —

---

## 11. Ethereum DeFi Protocols with Stellar Expansion Interest

**Why they care.**
Protocols like Aave, Compound, and Morpho have been fielding questions
about Stellar expansion as CCTP v2 and Axelar ITS bring Stellar into
the EVM composability conversation. An HTLC-backed bridge means they
can move collateral atomically — no wrapped-token discount to manage.

**Evaluate today.**
- [DIFFERENTIATION.md — CCTP v2 comparison](DIFFERENTIATION.md) — explains
  how OverSync and CCTP v2 are complementary in a single flow.
- [packages/sdk/](../packages/sdk/) — `@oversync/sdk` exposes an
  `ExternalBridgeRoute` abstraction that third-party protocols can
  implement without forking the core.

**Ask.** Request a 20-minute integration walkthrough and confirm whether
any team members are attending Meridian 2026 (Stellar conference) where
a live demo session is planned.

**Status.** `not-contacted`
**Last touch.** —

---

## 12. Stellar-Focused VC and Grant Funds — Bootstrapped.vc, SCF, Stellar Ventures

**Why they care.**
Investors in the Stellar ecosystem want bridge infrastructure that does
not inherit the catastrophic tail-risk of past bridge hacks. An HTLC-
only model with no admin escape hatch is a fundamentally different risk
profile from Ronin or Wormhole. Demonstrating a working testnet before
asking for capital reduces underwriting uncertainty.

**Evaluate today.**
- [deployments.testnet.json](../deployments.testnet.json) — live
  contract addresses, verifiable on block explorers today.
- [ROADMAP.md](../ROADMAP.md) — milestone-by-milestone delivery with
  verifiable artefacts; no un-evidenced claims.

**Ask.** Request a pitch meeting or written feedback on the technical
architecture, specifically whether the trust model is differentiated
enough to support a Tranche 2 grant application.

**Status.** `not-contacted`
**Last touch.** —

---

## Referral outreach template

Copy and adapt this template for any cold outreach. Replace the
bracketed fields. Keep the message under 200 words.

```
Subject: OverSync — trust-minimised ETH↔XLM bridge, testnet live

Hi [Name / Team],

I'm reaching out because [one sentence on why this specific group
is relevant — e.g. "you run a Fusion+ resolver" or "Freighter
users ask about ETH bridging regularly"].

We built OverSync: a non-custodial Ethereum ↔ Stellar bridge
where settlement is a sha256 preimage reveal — no validator set,
no admin keys, no wrapped tokens. The worst-case outcome for a
user is a permissionless timelock refund, not a multisig exploit.

The v2 contracts are live on testnet today:
  • Soroban HTLC: CDIKSJKVMX…WK2CTA6JK (Stellar testnet)
  • HTLCEscrow: 0xb352339B…bB178 (Sepolia)
  • Open-source code and docs: https://github.com/karagozemin/OverSync-1nchFusion

The one thing I'd like from you: [specific ask — e.g. "30 minutes
to walk through the resolver runner" or "a UX pass on the testnet
swap flow" or "an intro to your grants committee contact"].

Happy to send the architecture doc or set up a short call.

[Your name]
```

---

## Status tracker

| # | Stakeholder | Ask type | Status | Last touch |
|---|---|---|---|---|
| 1 | Stellar Foundation — Dev Programmes | Intro / review call | `not-contacted` | — |
| 2 | SCF Grants Committee | Grant application | `not-contacted` | — |
| 3 | 1inch Network — Fusion+ | Resolver trial | `outreach-sent` | May 2026 |
| 4 | Freighter Wallet | UX feedback | `not-contacted` | — |
| 5 | Lobstr Wallet | UX feedback | `not-contacted` | — |
| 6 | Stellar DEXes (SDEX / Soroswap / Phoenix) | Integration call | `not-contacted` | — |
| 7 | Stellar Anchors (MoneyGram et al.) | Discovery call | `not-contacted` | — |
| 8 | Audit firms (Trail of Bits, OtterSec, et al.) | Scoping call | `not-contacted` | — |
| 9 | Immunefi | Programme setup | `not-contacted` | — |
| 10 | Institutional OTC (Cumberland, Wintermute, GSR) | Technical brief | `not-contacted` | — |
| 11 | EVM DeFi protocols (Aave, Compound, Morpho) | Integration walkthrough | `not-contacted` | — |
| 12 | Stellar-focused VCs / grant funds | Pitch / feedback | `not-contacted` | — |

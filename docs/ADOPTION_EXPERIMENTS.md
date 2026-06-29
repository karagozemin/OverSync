# OverSync v2 — User Adoption Experiments

This document is the lightweight, evidence-first plan for testing
whether target users actually care about trust-minimised Stellar swaps.
It is intentionally lean: each experiment produces a single artefact
that can be cited in future traction claims, investor updates, or
governance proposals.

The experiments are grouped by target user segment, with at least one
experiment targeting resolver operators and one targeting end users.

---

## Experiment 1 — Resolver operator dry-run interviews

| Field | Detail |
|---|---|
| **Hypothesis** | Existing 1inch Fusion+ resolver operators will adopt Stellar as a new inventory leg if the operational model is meaningfully identical and the testnet ROI is positive after gas. |
| **Target participant** | 5–8 operators currently running Fusion+ resolvers on EVM chains; ideally at least one operator with no prior Stellar exposure. |
| **Success metric** | ≥ 60% of interviewed operators complete the `resolver/` dry-run setup (register, fill one testnet order, withdraw stake) within 60 minutes without external assistance, and rate operational familiarity ≥ 4/5. |
| **Required artefact** | Structured interview notes + NPS-style "would you run a Stellar resolver?" score from each participant. Minimum 5 responses. |
| **Timeline** | Weeks 2–4 of testnet phase. Recruit via 1inch Discord, Stellar dev Discord, and direct outreach. |

**What we are measuring:** Whether the "existing resolver operator" segment is real and frictionless. If operators need custom adapters or Stellar account management is a blocker, that is a product risk that investor claims about "Fusion+ compatibility" cannot paper over.

---

## Experiment 2 — Power-user testnet swap sessions

| Field | Detail |
|---|---|
| **Hypothesis** | Trust-conscious power users who currently self-custody Ethereum and need Stellar liquidity will prefer an HTLC settlement path over a validator-set bridge when the UX difference is ≤ 2 minutes of extra time. |
| **Target participant** | 10–15 Ethereum self-custody users who have performed a cross-chain swap in the last 90 days (via CCTP, Axelar, Allbridge, or similar). Exclude retail users whose primary wallet is a CEX. |
| **Success metric** | ≥ 70% of participants rate trust as "important" or "very important" in their bridge choice; ≥ 40% would choose a 20-minute HTLC path over a 2-minute validator-set path for the same fee if the trust model is explained. |
| **Required artefact** | Session recordings (with consent) + post-session survey scores, summarised into a single-page report with verbatim quotes. Target length: 8–12 pages. |
| **Timeline** | Weeks 3–6 of testnet phase. Recruit via Ethereum Discord servers, Twitter/X, and Stellar Foundation community channels. |

**What we are measuring:** Whether the trust-minimisation thesis resonates with actual users who have made bridge decisions before. A flat result here is a signal that the thesis is niche or the UX trade-off is mis-sized.

---

## Experiment 3 — Wallet UX friction review

| Field | Detail |
|---|---|
| **Hypothesis** | The current frontend flow (`testnet.oversync.app`) introduces no UX friction beyond the intrinsic HTLC asymmetry (source lock → destination claim) that cannot be reduced without changing the trust model. |
| **Target participant** | 8–12 users with zero prior OverSync exposure and mixed wallet familiarity (Freighter, MetaMask, WalletConnect). Recruit through user-testing platforms (e.g., UserTesting, User Interviews) or direct outreach. |
| **Success metric** | ≥ 80% of participants complete a successful testnet swap without a support prompt; average time-to-complete ≤ 8 minutes; no participant misses a recoverable state (refund path) due to UI ambiguity. |
| **Required artefact** | UX audit report with heat-map of drop-off points, a list of proposed UI improvements ranked by severity, and a 30-second explainer script that a non-technical tester can repeat back correctly. |
| **Timeline** | Weeks 4–7 of testnet phase. Overlap with Experiment 2; recruit separately to avoid bias. |

**What we are measuring:** Whether the trust-minimisation design is usable by the audience it is aimed at. Complex UX turns a protocol-level advantage into a marketing disadvantage.

---

## Experiment 4 — Developer integration feedback on `@oversync/sdk`

| Field | Detail |
|---|---|
| **Hypothesis** | A TypeScript developer can integrate the full swap flow (create → claim / refund) using `@oversync/sdk` in under 2 hours without reading any off-chain coordinator internals. |
| **Target participant** | 6–10 TypeScript / Node.js developers with prior DeFi integration experience (Uniswap, 1inch, Liquity, or comparable SDKs). Split: at least 3 with no prior Stellar or Soroban experience. |
| **Success metric** | ≥ 70% of participants complete the integration tutorial in ≤ 2 hours; ≥ 80% rate the SDK "easy" or "very easy" on a 5-point Likert scale; ≥ 50% of participants rate documentation completeness ≥ 4/5. |
| **Required artefact** | Structured developer diary entries (30-minute checkpoints) + final survey, aggregated into a report with verbatim pain points and a ranked list of documentation or API gaps. |
| **Timeline** | Weeks 5–8 of testnet phase. Recruit via Stellar dev Discord, TypeScript Telegram groups, and direct outreach to known integrators. |

**What we are measuring:** Whether the "integrate a trust-minimised bridge in an afternoon" story is true. If integrators stall on Soroban account management, chain ID disputes, or RPC configuration, that is a distribution risk that MVP code reviews will not catch.

---

## Experiment 5 — Comparison test against CCTP / Axelar routes for the right use case

| Field | Detail |
|---|---|
| **Hypothesis** | For a specific, well-defined transaction type — *native ETH moving into Stellar to be deposited into a Stellar-based yield position* — OverSync's trust-minimised path is measurably preferable (in terms of capital efficiency, settlement finality, and reversibility) against the nearest equivalent CCTP or Axelar route. |
| **Target participant** | 3–5 professional OTC desks, treasuries, or protocol operators who execute this specific flow 2+ times per month. |
| **Success metric** | In a side-by-side testnet simulation, ≥ 80% of participants identify at least one informational, capital-efficiency, or reversibility advantage for OverSync on this specific flow; ≥ 40% would consider routing ≥ 10% of that flow type through OverSync on mainnet if audit and liquidity conditions are met. |
| **Required artefact** | Comparison worksheet filled by each participant, plus a 2-page decision matrix that maps OverSync's attributes (settlement latency, refund path, wrapped-vs-native asset, attester dependency) against CCTP v2 and Axelar ITS for that specific use case. |
| **Timeline** | Weeks 6–9 of testnet phase. Recruit via existing Stellar Foundation and partner conversations; these participants are typically already known. |

**What we are measuring:** Whether the trust-minimisation thesis has a specific, defensible wedge against incumbents, not just a general "we are safer" pitch. If the wedge is big enough, it becomes the positioning anchor for every future pitch deck.

---

## Results format — evidence-backed traction claims

Every experiment produces one primary artefact stored in this repository
under `docs/experiments/` with a date-stamped filename (e.g.,
`2026-07-15-resolver-interviews.md`). The artefact template is:

```markdown
# [Experiment title] — Results

**Date:** YYYY-MM-DD
**Facilitator:** Name / handle
**Participants:** N (list anonymised handles or orgs with consent)

## Raw data
- [ ] Survey scores (table or inline)
- [ ] Verbatim quotes (anonymised)
- [ ] Session notes (summary, not transcript unless consented)

## Interpretation
One-paragraph answer to: "Does this support or refute the hypothesis?"

## Traction claim supported
> [Exact sentence that can be quoted in a pitch deck, blog post, or
> governance proposal.]
```

**Rules for future traction claims:**

1. Any claim of user demand, resolver willingness, or UX satisfaction must cite a specific experiment file and a specific participant count.
2. If an experiment result is negative or ambiguous, the report must state that plainly. We will not re-run an experiment until the underlying variable (e.g., UX, documentation) has been materially changed.
3. Aggregate claims (e.g., "80% of developers rate the SDK as easy") are only valid when at least N = 6 participants have completed the experiment.

---

## Timeline overview

| Week | Active experiments |
|---|---|
| 1–2 | Recruiting for all experiments |
| 2–4 | Experiment 1 (Resolver operators) |
| 3–6 | Experiment 2 (Power users) |
| 4–7 | Experiment 3 (Wallet UX) |
| 5–8 | Experiment 4 (SDK integators) |
| 6–9 | Experiment 5 (CCTP/Axelar comparison) |
| 10 | Synthesis: final 2-page report linking results to traction claims |

---

## When experiments change direction

If an experiment produces a strongly negative result (e.g., < 30%
success metric), we commit to:

1. Publishing the raw finding within 7 days.
2. Identifying the specific variable that changed (UX, documentation,
   chain configuration, fee sizing).
3. Re-running the experiment only after that variable has been
   materially altered and a second facilitator has validated the
   change.

No claim of user demand will be published unless it is supported by a
completed experiment file stored under `docs/experiments/`.

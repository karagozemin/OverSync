# Use of Funds — OverSync v2

This document maps every funding dollar to a concrete engineering
milestone, risk-reduction outcome, or ecosystem-adoption goal. It
separates three funding sources — **SCF grant**, **investor capital**,
and **non-dilutive ecosystem support** — and models conservative,
base, and stretch scenarios.

---

## 1. Funding sources

| Source | Type | Purpose | Status |
|--------|------|---------|--------|
| **SCF grant** | Dilution-free grant | Audit preparation, Soroban hardening, coordinator productionising, resolver onboarding, bug bounty | This proposal |
| **Investor capital** | Equity / SAFE | Audit procurement, runway extension, team expansion | Not yet raised |
| **Non-dilutive ecosystem support** | Stellar Foundation / ecosystem grants | Testnet pilot operations, observability infrastructure, community events | Conversations active (see [`TRACTION.md`](TRACTION.md)) |

Investor capital and ecosystem support are **not** required for Q3–Q4
2026 deliverables; they extend runway and accelerate v2.1 depth.

---

## 2. Budget by bucket

All figures are USD. Every line item references a concrete milestone in
[`ROADMAP.md`](../ROADMAP.md) and/or an issue in the tracker.

### 2.1 Tranche 1 — Audit preparation and launch hardening (Q3 2026)

| # | Bucket | Amount | Milestone(s) | Risk reduced |
|---|--------|--------|--------------|--------------|
| 1 | **Foundry fuzz + invariant suite** — property-based tests for `HTLCEscrow.sol` covering all state machines (create, claim, refund, emergency paths) | $4,000 | ROADMAP: Q3 — "Foundry fuzz + invariant suite for HTLCEscrow.sol" | EVM contract bugs that static analysis misses; differential fuzzing catches edge cases Solidity unit tests cannot |
| 2 | **Slither CI gate + static analysis hardening** — must-not-fail CI gate, suppress triaged findings with inline documentation, integrate into `contracts.yml` | $2,000 | ROADMAP: Q3 — "Slither must-not-fail CI gate" | Deployment of contracts with known-detectable vulnerabilities; regression in future PRs |
| 3 | **Differential test harness** — cross-chain EVM ↔ Soroban round-trip test (same hashlock, same preimage, both settlement paths) | $2,000 | ROADMAP: Q3 — "Differential test harness across EVM ↔ Soroban" | HTLC atomicity failure where the same secret does not unlock on both chains |
| 4 | **Soroban resolver-registry binding enforcement** — upgrade `oversync-htlc` to enforce that claims come from registered resolvers; add integration tests | $4,000 | ROADMAP: Q3 — "Soroban resolver-registry binding enforcement in HTLC" | Unregistered addresses claiming orders; resolver network cannot enforce stake requirements |
| 5 | **Soroban partial-fill support** — parity with EVM `HTLCEscrow` partial-fill semantics; update Soroban unit tests | $1,500 | ROADMAP: Q2–Q3 v2.1 — "Partial fills on the Soroban side" | Asymmetric fill behaviour between chains; integrator surprise |
| 6 | **Soroban unit test expansion + load test** — second round of Rust tests covering edge cases; Sepolia load test (1k concurrent orders, 2-week soak) | $1,500 | ROADMAP: Q3 — "Sepolia load test" + Soroban test coverage | Rust contract edge-case bugs; coordinator cannot handle concurrent order volume |
| 7 | **Coordinator Postgres migration** — replace SQLite with Postgres for concurrent-write safety; migration scaffolding | $2,500 | ROADMAP: Q3 — "Coordinator Postgres migration path" | SQLite concurrency limits under load; data loss on coordinator restart |
| 8 | **Coordinator observability stack** — Prometheus + Grafana dashboards; `GET /metrics` endpoint; alerting rules for order failure rate, refund latency | $2,500 | ROADMAP: Q3 — "Coordinator observability stack" | Blind operation during mainnet; no early warning of resolver-coordinator desync |
| | **Tranche 1 total** | **$20,000** | | |

### 2.2 Tranche 2 — Audit, remediation, resolver network, and beta (Q4 2026)

| # | Bucket | Amount | Milestone(s) | Risk reduced |
|---|--------|--------|--------------|--------------|
| 9 | **Independent audit — EVM contracts** | $0¹ | ROADMAP: Q4 — "Audit firm A — EVM contracts" | Unaudited contract risk |
| 10 | **Independent audit — Soroban contracts** | $0¹ | ROADMAP: Q4 — "Audit firm B — Soroban contracts" | Unaudited contract risk |
| 11 | **Audit remediation + re-audit pass** — engineer time to fix findings, produce annotated diff, coordinate re-audit | $0¹ | ROADMAP: Q4 — "Remediation diff and re-audit pass" | Findings left unpatched; re-audit not completed |
| 12 | **Bug bounty bootstrap** — initial pool for Immunefi or comparable programme | $5,000 | ROADMAP: Q4 — "Bug bounty programme launched" | No incentive for white-hat disclosure; silent critical flaws |
| 13 | **Resolver onboarding grants** — $3,000 each for first 3 community resolvers, paid on milestone (30 days active, ≥50 orders filled) | $9,000 | ROADMAP: Q1 2027 — "First three community resolvers onboarded" | Resolver network coldstart; zero competition on fill quality |
| 14 | **Bridge insurance fund** — catastrophic event coverage for beta users, returned to grant pool if unused at mainnet +6 months | $6,000 | No direct roadmap item; supports TRACTION.md KPI "failed-claim ratio < 1%" | First users bear smart-contract risk with no backstop |
| | **Tranche 2 total** | **$20,000** | | |

¹ Audit procurement, remediation, and re-audit are funded by **investor
capital** or paid directly by the project, not from the SCF grant. The
grant covers pre-audit hardening and post-audit incentives, not the
audit invoices themselves.

### 2.3 Total SCF grant request

| Component | Amount |
|-----------|--------|
| Tranche 1 — Audit preparation and launch hardening | $20,000 |
| Tranche 2 — Audit, remediation, resolver network, beta | $20,000 |
| **Total** | **$40,000** |

Tranche 2 releases only after all Tranche 1 deliverables ship (tranche-gated).

---

## 3. Funding scenarios

### 3.1 Conservative — $25,000 (Tranche 1 only)

If the grant is approved but capped:

| Priority | Bucket | Amount |
|----------|--------|--------|
| 1 (critical) | Foundry fuzz + invariant suite | $4,000 |
| 2 (critical) | Soroban resolver-registry binding | $4,000 |
| 3 (high) | Slither CI gate | $2,000 |
| 4 (high) | Differential test harness | $2,000 |
| 5 (high) | Coordinator Postgres migration | $2,500 |
| 6 (high) | Coordinator observability stack | $2,500 |
| 7 (medium) | Soroban tests + load test | $1,500 |
| 8 (medium) | Soroban partial-fill support | $1,500 |
| 9 (deferred) | Bug bounty bootstrap | $2,500¹ |
| 10 (deferred) | Resolver onboarding grants | $2,500¹ |
| | **Total** | **$25,000** |

¹ Funded at reduced level; remaining gap covered by ecosystem support or
investor capital.

### 3.2 Base — $40,000 (Tranche 1 + Tranche 2)

Full proposal as described in §2. All milestones funded.

### 3.3 Stretch — $60,000 (Tranche 1 + Tranche 2 + extension)

If additional funding is available:

| Extension bucket | Amount | What it unlocks |
|-----------------|--------|-----------------|
| Dedicated Soroban specialist (3-month contract) | $10,000 | Faster partial-fill implementation; Soroban non-XLM asset support in v2.1 |
| Coordinator production deployment (CDN/WAF + multi-region) | $5,000 | Mainnet-grade coordinator before audit completes; lower mainnet-launch risk |
| Extended resolver onboarding (3 additional resolvers) | $5,000 | 6 resolvers at launch instead of 3; competitive fill pricing from day one |
| **Total extension** | **$20,000** | |

---

## 4. Stellar / Soroban adoption impact

Each bucket is annotated by how directly it improves the Stellar and
Soroban ecosystem:

| Bucket | Directly improves Stellar/Soroban adoption? | Why |
|--------|---------------------------------------------|-----|
| Foundry fuzz + invariant suite | ❌ No | EVM-only tooling; raises confidence in the Ethereum contract |
| Slither CI gate | ❌ No | EVM-only static analysis |
| Differential test harness | ✅ Yes | Validates that Soroban contracts are first-class peers to EVM contracts; demonstrates Soroban production readiness |
| Soroban resolver-registry binding | ✅ Yes | Strengthens the Soroban contract's trust model; showcases Soroban's native access-control patterns |
| Soroban partial-fill support | ✅ Yes | Ships a Soroban-native feature that is a reference implementation for other Soroban projects |
| Soroban tests + load test | ✅ Yes | Directly improves Soroban code quality and demonstrates Soroban under real-world load |
| Coordinator Postgres migration | ❌ No | Infrastructure-only; no Soroban dependency |
| Coordinator observability | ❌ No | Operations tooling; chain-agnostic |
| Audit (EVM + Soroban) | ✅ Yes | Public audit of Soroban contracts is a reference for future Soroban audit engagements |
| Bug bounty | ✅ Yes | Incentivises Soroban security research; discovers Soroban-specific vulnerability patterns |
| Resolver onboarding grants | ✅ Yes | Onboards operators who learn Soroban integration; grows the Soroban developer pool |
| Bridge insurance fund | ⬜ Indirect | User assurance, not a Soroban adoption driver |
| Stretch: Soroban specialist | ✅ Yes | Directly funds Soroban development capacity |
| Stretch: extended resolver onboarding | ✅ Yes | Grows the Soroban operator community |

**Of the $40,000 base request, approximately $26,000 (65 %) directly
funds Soroban/Stellar engineering or ecosystem growth.** The remaining
$14,000 covers EVM-side and infrastructure items that are strictly
necessary for a secure cross-chain product.

---

## 5. What is explicitly not funded

The following are intentionally out of scope for this grant request.
They are either funded separately, deferred to post-mainnet revenue, or
not planned at all.

| Category | Rationale |
|----------|-----------|
| **Paid marketing / ads** | OverSync's go-to-market is organic: testnet leaderboard, technical blog, Discord office hours, and joint announcements with partners (see [`TRACTION.md §3`](TRACTION.md)). Paid acquisition before mainnet is wasteful. |
| **Influencer sponsorships** | Not measurable for a trust-minimised infrastructure project. No budget allocated. |
| **Team salaries (founding team)** | Founding developer is not drawing a salary from grant funds. |
| **Full-time hires (Tranche 1)** | Staffing is gated on Tranche 2 + investor capital. Solo-team model is sufficient for Q3 2026 scope. |
| **Legal / incorporation** | OverSync is an open-source project. Legal entity formation is deferred until investor capital is raised. |
| **Bug bounty programme operations** | Immunefi platform fees (if any) are paid from investor capital. The grant covers only the bounty pool. |
| **Audit firm fees** | Paid directly by the project or from investor capital. The grant covers pre-audit preparation and post-audit incentives, not audit invoices. |
| **Mainnet gas / deployment costs** | Estimated at <$2,000 for EVM L1 + Soroban; covered by existing operational budget. |
| **Non-Stellar chain support (Solana, Cosmos, etc.)** | Not in scope until v2.2 at the earliest. |
| **Centralised exchange listings** | Not applicable — OverSync is non-custodial; CEX listing is not a goal. |
| **NFT / gamification features** | Not relevant to the bridge use case. |

---

## 6. Runway assumptions

| Item | Monthly cost | Funded from | Duration |
|------|-------------|-------------|----------|
| Testnet RPC endpoints (Alchemy / QuickNode) | ~$200 | Operational budget | Indefinite |
| Stellar testnet node | $0 | Public testnet | Indefinite |
| Coordinator hosting (DigitalOcean app) | ~$25 | Operational budget | Indefinite |
| Frontend hosting (Vercel) | $0 (Pro tier, open-source) | Vercel OSS programme | Indefinite |
| CI/CD minutes (GitHub Actions) | $0 (public repo) | GitHub free tier | Indefinite |
| Domain + DNS (oversync.app) | ~$15/mo | Operational budget | Indefinite |
| Soroban specialist (stretch only) | ~$3,333/mo | Extension funding | 3-month contract |
| **Total committed monthly burn (non-stretch)** | **~$240** | | |

The project's operating costs are near-zero. The grant primarily funds
**engineering work, risk reduction, and network bootstrapping**, not
runway.

---

## 7. Tranche-gate checkpoints

| Gate | Condition | Triggers |
|------|-----------|----------|
| **Tranche 1 complete** | All Tranche 1 budget items shipped (fuzz suite, Slither CI gate, differential harness, Soroban binding, Postgres migration, observability, load test) | Release of Tranche 2 funds; public status update |
| **Audit procurement** | Two audit firms engaged, contracts signed | Audit begins (Q4 2026) |
| **Audit public** | Both reports published, all medium+ findings remediated | Bug bounty launched; mainnet deployment begins |
| **Resolver onboarding** | ≥3 community resolvers active for 30 days | Insurance fund activated; mainnet TVL target tracking begins |

Each gate has a public verification artefact (GitHub issue, published
report, on-chain registry query).

---

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Grant is capped at $25k (conservative) | Medium | Delays bug bounty and resolver grants | Prioritise audit-prep items; seek ecosystem support for bounty pool |
| Audit reveals critical flaws requiring re-architecture | Low | Delays mainnet by 1–2 quarters | Tranche-gated funding means no additional dollars spent until audit is clean |
| Resolver network coldstart even with grants | Medium | Mainnet launch with ≤3 resolvers | Self-resolve path always available; coordinator can fill as last resort |
| Solo-team developer leaves | Low (solo founder has 2+ year track record) | Project stalls | All contracts are open-source and documented; CI/CD preserves build integrity; coordinator-operator model means bridge continues functioning |
| Stellar Soroban SDK breaking changes | Medium | Rust contract needs rework | Pin Soroban SDK version in `Cargo.toml`; CI tests against pinned version; upgrade window in Q4 |

---

## References

- [`ROADMAP.md`](../ROADMAP.md) — milestone-by-milestone delivery timeline
- [`REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md) §9 — budget rationale and SCF
  reviewer response
- [`SECURITY.md`](SECURITY.md) — audit preparation checklist and threat
  model
- [`TRACTION.md`](TRACTION.md) — go-to-market plan and KPIs
- [`TRUST_MODEL.md`](TRUST_MODEL.md) — non-custodial guarantees
- [`DIFFERENTIATION.md`](DIFFERENTIATION.md) — competitive landscape

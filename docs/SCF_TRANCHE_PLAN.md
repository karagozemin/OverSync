# OverSync — SCF Tranche Plan

## Overview

OverSync v2 is structured into three SCF tranches to align funding with measurable security hardening, testnet reliability, and launch readiness.

Each tranche presents concrete deliverables that can be publicly verified and includes explicit non-goals to set clear boundaries.

---

## Tranche 1: Audit-Prep Hardening

**Funding focus:** Security hardening in preparation for external audits. Over 50% of the review process time is spent reviewing Foundry-generated fuzz/invariant suites and Slither analysis.

### Tranche 1 Deliverables

#### 1.1 Foundry fuzz/invariant suite for HTLCEscrow.sol
- **Deliverable:** Comprehensive fuzz/invariant testing in `contracts/test/foundry/` directory
- **Verification:** Run through CI in GitHub Actions, execute via `pnpm test:foundry`
- **Done means:** All invariant checks pass across 100+ random seed runs; no critical findings that prevent contract deployment
- **Non-goals:** Fuzz/EVM cross-contract interactions beyond HTLCEscrow (those are Tranche 2 scope)

#### 1.2 Slither must-fail CI gate
- **Deliverable:** Slither CI that breaks the build on issues in `scripts/slither-check.sh`
- **Verification:** Execute via `pnpm slither:ci` in GitHub Actions environment
- **Done means:** Slither returns zero severity issues in automated check; CI passes without manual override
- **Non-goals:** Advisory mode Slither scans (already exists in repo)

#### 1.3 EVM/Soroban differential harness expansion
- **Deliverable:** E2E differential testing harness in `e2e/cross-chain.test.ts` comparing EVM ↔ Soroban implementations
- **Verification:** Execute locally with `pnpm test:e2e` or CI runs on pull requests
- **Done means:** 24 hour continuous CI passes; same secret preimage hashlock produces identical behavior across chains
- **Non-goals:** Load/dos testing of the bridge (Tranche 2 scope)

---

## Tranche 2: Testnet Reliability and Resolver Readiness

**Funding focus:** Public testnet stability, resolver network formation, and operational readiness for production deployment.

### Tranche 2 Deliverables

#### 2.1 Public testnet metrics snapshot
- **Deliverable:** Grafana dashboard in `coordinator/ops/` with Sepolia metrics for 1k concurrent orders
- **Verification:** Access at `https://metrics.oversync.testnet` (placeholder); run via `pnpm load-test:live` for 2-week soak
- **Done means:** Dashboard shows <100ms p95 settlement latency, <1% failed-claim rate, stable TVL > $500 for minimum 48-hour period
- **Non-goals:** Mainnet metrics (Tranche 3 scope); live production monitoring (post-launch)

#### 2.2 Resolver dry-run/fill safety checks
- **Deliverable:** Automated resolver testing in `resolver/test/` + integration in CI
- **Verification:** Execute via `pnpm resolver:test` in GitHub Actions; pass with no unresolved race conditions
- **Done means:** All resolver test scenarios pass concurrently; no blocking safety issues detected in 1000+ simulated orders
- **Non-goals:** Resolver network coldstart funding program (referenced in `docs/REVIEW_RESPONSE.md`)

#### 2.3 Coordinator Postgres migration path or operational readiness checklist
- **Deliverable:** `coordinator/migrations/` directory with Alembic migrations or operational readiness checklist document
- **Verification:** `pnpm coordinator:migrate` runs successfully; document signed off by engineering
- **Done means:** Migration script passes migration tests; OR checklist includes: Coord-Parity environment parity, DNS/SSL setup, error alert routing
- **Non-goals:** Full production deployment of coordinator (Tranche 3 scope)

---

## Tranche 3: Launch Readiness

**Funding focus:** Final security and governance preparation for mainnet launch, with explicit gates before mainnet enablement.

### Tranche 3 Deliverables

#### 3.1 Audit report links/placeholders
- **Deliverable:** Audit reports linked in `docs/SECURITY.md` with findings summary
- **Verification:** CI checks `SECURITY.md` for valid audit report URLs; human verification at review time
- **Done means:** Two independent audits completed and publicly linked; no unresolved critical findings; remediation work in progress for all medium+ findings
- **Non-goals:** New security features beyond audit scope (v2.1 work after launch)

#### 3.2 Multisig ownership migration plan
- **Deliverable:** Multisig address committed to `contracts/utils/multisig-address.json` with governance plan
- **Verification:** Multisig ownership verified on Etherscan / Stellar Explorer; plan published in `docs/DEPLOYMENT.md`
- **Done means:** 2-of-3 multisig active on mainnet; formal governance timeline documented; owner key rotated out
- **Non-goals:** DAO Timelock + Governor implementation (v2.1 optional feature after launch)

#### 3.3 First community resolver onboarding checklist
- **Deliverable:** Resolver onboarding checklist in `docs/RESOLVERS.md` with first three invited operations
- **Verification:** Manual review during pre-launch gate; checklist uploaded to shared drive
- **Done means:** Three distinct technical teams have submitted signed resolver agreements; operational onboarding complete for 30 days
- **Non-goals:** Resolver network coldstart funding pool (Tranche 2 related); resolver auction protocol (v2.1 scope)

---

## Guardrails

- **Conservative dates:** All dates referenced are minimum targets, not optimistic commitments
- **No premature mainnet:** VITE_MAINNET_ENABLED remains `false` until all tranches complete
- **No budget promises:** All deliverables have concrete verification artifacts, not vague budget language
- **No uncosted items:** Each deliverable includes explicit verification methods

---

## Acceptance Criteria

- The plan maps naturally to SCF's three-tranche structure
- Each tranche has concrete, publicly verifiable artifacts
- Mainnet remains explicitly gated on completing all three tranches
- Document links out to existing docs instead of duplicating large sections

---

## References

- `ROADMAP.md` - High-level project timeline
- `docs/DEPLOYMENT.md` - Mainnet rollout checklist
- `docs/SECURITY.md` - Security controls and audit requirements
- `docs/RESOLVERS.md` - Resolver network operations
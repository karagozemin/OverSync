<!-- OverSync pull request template                                  -->
<!-- All PRs must complete the proof checklist below.                -->
<!-- Keep PRs small, focused, and reversible.                        -->

## What & Why

_One or two paragraph summary of the change and the problem it solves. Link the issue with `Closes #…` or `Refs #…`._

## Touched surface

Tick every layer this PR changes:

- [ ] `frontend/` — React + Vite bridge UI
- [ ] `packages/sdk/` — shared TypeScript SDK
- [ ] `coordinator/` — order book + REST/WS service
- [ ] `resolver/` — community resolver runner
- [ ] `relayer/` — legacy v1 listener / watchdog (changes here need extra scrutiny)
- [ ] `contracts/` — Solidity v2 (`HTLCEscrow`, `ResolverRegistry`)
- [ ] `soroban/` — Stellar Soroban contracts (`oversync-htlc`, `oversync-resolver-registry`)
- [ ] `docs/` — documentation only
- [ ] CI / config (`.github/workflows/`, `docker`, `env.example`)

## Settlement & refund semantics

Critical for SCF / investor review. If **any** box is checked, the PR **must** also update `docs/REVIEW_RESPONSE.md` and link the updated section in the PR description.

- [ ] **Bridge settlement semantics changed** (claim path, timelock ordering, preimage handling, hashlock type, asset routing)
- [ ] **Refund semantics changed** (who can refund, who receives refunds, timelock values, refund-address pinning)
- [ ] **Settlement-critical invariant changed** (e.g. non-custodial guarantee, no-admin-escape-hatch, permissionless refund)
- [ ] **None of the above** — this PR cannot move, hold, or release user funds

## Tests run

Tick the matches your change and paste the outcome below. Commands mirror the matrix in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

- [ ] `pnpm --filter @oversync/sdk build && pnpm --filter @oversync/sdk exec tsc --noEmit`
- [ ] `pnpm --filter @oversync/sdk test`
- [ ] `pnpm --filter @oversync/coordinator exec tsc --noEmit && pnpm --filter @oversync/coordinator test`
- [ ] `pnpm --filter @oversync/resolver exec tsc --noEmit && pnpm --filter @oversync/resolver test`
- [ ] `pnpm --filter @oversync/frontend exec tsc --noEmit && pnpm --filter @oversync/frontend test`
- [ ] `pnpm --filter @oversync/contracts compile && pnpm --filter @oversync/contracts exec hardhat test test/v2/HTLCEscrow.test.ts test/v2/ResolverRegistry.test.ts`
- [ ] `cd soroban && stellar contract build && cargo test --release`
- [ ] `(cd contracts && forge test --match-path "test/foundry/*" -v)` (Solidity fuzz / invariant)
- [ ] `pnpm test:e2e` (cross-chain differential harness)
- [ ] `node scripts/verify-addresses.mjs` — required if addresses, configs, or `env.example` change
- [ ] `node scripts/check-evidence-links.mjs` — advisory; required if docs links change

Free-form outcome:

```
# commands actually run + result (all green / specific failures + how fixed)
```

## UI / evidence artefacts

Required if the PR changes the frontend, observability, dashboards, or any docs that claim status, metrics, or addresses. Otherwise write `n/a`.

- [ ] **Frontend visible change** → screenshot or short clip attached (swap flow, refund dialog, history banner, wallet confirm)
- [ ] **Coordinator API change** → `curl` snippet + JSON response sample pasted below
- [ ] **Metrics / KPI change** → updated snapshot in `docs/examples/metrics-snapshot.example.json` (or new JSON in PR)
- [ ] **Status table / README change** → updated row(s) pasted below with the source link
- [ ] **None of the above** — no UI-observable artefact

## Secrets, logging, and PII risk

- [ ] No secrets, private keys, RPC credentials, `.env` content, wallet mnemonics, or preimages added to the repo
- [ ] No new `console.*` / `logger.*` line that prints secrets, preimages, signed payloads, or PII
- [ ] No new Vite/build flag that exposes devtools output in production (the `VITE_*` and `esbuild.drop` policy still holds)
- [ ] **None of the above** — explain why this PR cannot be a secrets / logging risk:

## Public proof links (SCF / investor evidence)

Only required for SCF tranche PRs or investor evidence packs. Otherwise write `n/a`.

- [ ] Sepolia Etherscan contract / tx link(s):
- [ ] Stellar Expert contract / tx link(s):
- [ ] Dashboard URL (coordinator `/metrics`, `/health`, public Grafana):
- [ ] CI run URL (`https://github.com/karagozemin/OverSync/actions/runs/…`):
- [ ] Screenshots, screen recordings, or PR-comment artefacts:

## Breaking change & rollback

- [ ] **Breaking change?** Yes / No — describe caller impact, data migrations, revert safety:
- [ ] **Migration or feature flag required?** Yes / No — describe the path:

## Reviewer checklist (for the PR author to self-verify)

- [ ] PR description and code comments are in English
- [ ] Linked issue or milestone
- [ ] No unrelated drive-by changes (reformatting, dep bumps, etc.)
- [ ] Tests touch the same files as the source change
- [ ] PR is reversible: a single `git revert` restores prior state

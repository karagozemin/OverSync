# Clean-worktree check after code generation

`scripts/check-codegen-clean.mjs` (`pnpm check:codegen-clean`) verifies that maintained generators and artifact checks leave zero uncommitted tracked changes in the worktree and that committed generated files stay synchronized with canonical manifests.

## Tracked generated artifacts

- `deployments.testnet.json` and `packages/sdk/src/deployment-evidence/deployments.testnet.json`
- `contracts/v2-bytecode-hashes.json`
- `packages/sdk/src/ethereum/abi.ts`

## Behavior

- Computes SHA-256 content snapshots before and after running maintained verification/generation steps (`validate-deployments`, `verify-addresses`).
- Inspects `git status --porcelain --untracked-files=no` (when `.git` is present) and fails if any tracked file is modified, added, or deleted.

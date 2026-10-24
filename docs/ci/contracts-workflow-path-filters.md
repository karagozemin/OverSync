# Contract workflow lockfile and manifest path filters

`scripts/check-contracts-path-filters.mjs` (`pnpm check:contracts-path-filters`) ensures the contract verification workflow (`.github/workflows/contracts.yml` Foundry and Slither jobs) triggers when root dependency resolution or workspace manifests change, in addition to changes under `contracts/**`.

## Required path filters (`push` and `pull_request`)

- `contracts/**`
- `pnpm-lock.yaml` (resolves `@openzeppelin/contracts`, `hardhat`, and Foundry/Slither workspace dependencies)
- `package.json`
- `pnpm-workspace.yaml`
- `.github/workflows/contracts.yml`

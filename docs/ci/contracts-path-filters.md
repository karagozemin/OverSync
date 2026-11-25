# Contracts workflow path filters

`.github/workflows/contracts.yml` runs Foundry and Slither when changes touch:

- `contracts/**`
- root `package.json`, `pnpm-lock.yaml`, or `pnpm-workspace.yaml`
- the workflow file itself

Root lockfile and workspace manifest changes matter because both jobs install with `pnpm install --frozen-lockfile` before compiling or analyzing contracts.

# Contributing to OverSync

Thanks for helping improve OverSync. This document explains how to get started, where the packages live, and how to prepare changes for review.

## Start here

1. Install prerequisites:
   - Node.js 18 or newer
   - pnpm 8 or newer
   - Git
   - Rust toolchain if you plan to work on `soroban/`

2. Clone the repository and install workspace dependencies:

   ```bash
   pnpm install
   ```

3. Copy example environment variables before running local services:

   ```bash
   cp env.example .env
   ```

4. Read the architecture and operational docs:
   - [`ARCHITECTURE.md`](ARCHITECTURE.md)
   - [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
   - [`docs/RESOLVERS.md`](docs/RESOLVERS.md)

## Repository layout

- `contracts/` — Solidity contracts, Hardhat configuration, deployment scripts, and contract tests.
- `coordinator/` — Node/TypeScript coordinator service, persistence adapters, state machine, and API.
- `relayer/` — Node/TypeScript relayer, event listeners, chain polling, and fill logic.
- `resolver/` — Resolver service source and runtime logic.
- `frontend/` — Web UI and integration with bridge contracts.
- `packages/sdk/` — Shared SDK utilities, asset mapping, and client helpers.
- `stellar/` — Legacy Stellar bridge client and Stellar-specific integration.
- `soroban/` — Rust-based Soroban smart contract code and scripts.
- `docs/` — Supporting design, security, deployment, trust, and resolver documentation.

## Working with branches

Use a descriptive branch name and include the issue number when available, for example:

```bash
git checkout -b feat/11-contributor-onboarding-guide
```

Suggested prefixes:
- `feat/` for new features
- `fix/` for bug fixes
- `docs/` for documentation updates
- `chore/` for maintenance tasks

## Tests and validation

Run tests before opening a pull request. The workspace supports package-scoped and full-workspace commands.

- Run all workspace tests:

  ```bash
  pnpm test
  ```

- Run lint checks:

  ```bash
  pnpm lint
  ```

- Run package-specific tests:

  ```bash
  pnpm --filter @oversync/sdk test
  pnpm --filter coordinator test
  ```

- Build workspace packages:

  ```bash
  pnpm build
  ```

If you modify deployment or runtime configuration, verify against `docs/DEPLOYMENT.md`.

## Pull request expectations

When preparing a PR:

- Keep changes focused and limited to the issue or feature.
- Include tests for new behavior or bug fixes.
- Update documentation for user-facing or operational changes.
- Reference the issue number in the title and description.
- Describe how to reproduce the issue and how your change fixes it.

## Code style and quality

- Follow existing TypeScript patterns used in the repository.
- Keep code readable, typed, and well-structured.
- Use existing helper modules where appropriate instead of duplicating logic.
- Run linting and formatting before submitting changes.

## Resolving and deployment guidance

For resolver-specific setup and operation, refer to [`docs/RESOLVERS.md`](docs/RESOLVERS.md).
For environment variable and deployment guidance, refer to [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Security and responsible disclosure

If you discover a security issue, do not publish it publicly. Share the details with the maintainers through the preferred private channel or GitHub if instructed.

## Thank you

Contributions help make OverSync stronger and more secure. If you're unsure where to start, open an issue or ask the maintainers for guidance.

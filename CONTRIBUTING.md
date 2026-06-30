# Contributing to OverSync

Thanks for helping improve OverSync. This guide is for developers opening pull
requests against the codebase. If you want to operate a resolver, use
[`docs/RESOLVERS.md`](docs/RESOLVERS.md) instead.

## Prerequisites

- Node.js 22.5+ and pnpm
- Rust with the `wasm32-unknown-unknown` and `wasm32v1-none` targets
- `stellar-cli` 22.8.1 for Soroban contract builds
- Foundry or Hardhat tooling for Solidity contract work

## Repository layout

- `packages/sdk` - shared TypeScript SDK
- `coordinator` - SQLite-backed v2 coordinator REST and WebSocket service
- `contracts` - Solidity contracts and Hardhat tests
- `soroban` - Rust workspace for Stellar Soroban contracts
- `frontend` - React and Vite bridge UI
- `resolver` - reference community resolver runner

## Local setup

```bash
pnpm install
cp env.example .env
pnpm --filter @oversync/sdk build
```

Run the parts of the stack you are changing. For example:

```bash
pnpm --filter @oversync/coordinator dev
pnpm --filter @oversync/frontend dev
```

## CI test matrix

Run the checks that match your change before opening a PR:

```bash
pnpm --filter @oversync/sdk build
pnpm --filter @oversync/sdk exec tsc --noEmit
pnpm --filter @oversync/coordinator exec tsc --noEmit
pnpm --filter @oversync/resolver exec tsc --noEmit
pnpm --filter @oversync/frontend exec tsc --noEmit
pnpm --filter @oversync/sdk test
pnpm --filter @oversync/coordinator test
pnpm --filter @oversync/contracts compile
pnpm --filter @oversync/contracts exec hardhat test test/v2/HTLCEscrow.test.ts test/v2/ResolverRegistry.test.ts
```

For Soroban changes:

```bash
cd soroban
stellar contract build
cargo test --release
```

For Solidity contract changes, the contracts workflow also runs Slither on
`contracts/contracts/v2`.

## Pull request expectations

- Write PR descriptions and code comments in English.
- Link the issue your PR addresses.
- Keep secrets, private keys, RPC credentials, and `.env` files out of commits.
- Include verification notes that list the commands you ran.
- Keep contributor docs focused on development. Resolver operations belong in
  [`docs/RESOLVERS.md`](docs/RESOLVERS.md).

### Contributor proof checklist

Every PR must complete the proof checklist in
[`.github/pull_request_template.md`](.github/pull_request_template.md). The
template is SCF / investor evidence oriented and specifically asks:

- which surface (`frontend`, `sdk`, `coordinator`, `resolver`, `relayer`,
  `contracts`, `soroban`, `docs`, `infra`) you touched;
- which tests you ran locally, matching the matrix above;
- whether you attached screenshots or `curl` / JSON output for any UI or
  evidence change;
- **whether bridge settlement or refund semantics changed** — if yes, the PR
  must also update [`docs/REVIEW_RESPONSE.md`](docs/REVIEW_RESPONSE.md) at the
  relevant section;
- whether secrets / logging risk changed (private keys, preimages, `console.*`
  output, Vite production builds);
- whether public proof links (Etherscan, Stellar Expert, CI run, dashboard)
  apply.

The checklist is the artefact reviewers will cite when assessing the change.
Filling it in once is cheaper than answering the same questions in review
comments.

## Security

Report security-sensitive issues privately using [`docs/SECURITY.md`](docs/SECURITY.md).
Do not open public issues or PRs that reveal exploitable details.

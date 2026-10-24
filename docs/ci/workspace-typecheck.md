# Aggregate workspace typecheck command

`pnpm typecheck` runs `tsc --noEmit` across every maintained TypeScript workspace in the same order as `.github/workflows/ci.yml`:

1. `@oversync/sdk`
2. `@oversync/coordinator`
3. `@oversync/resolver`
4. `@oversync/frontend`
5. `@oversync/relayer`

`scripts/lib/workspace-typecheck.test.mjs` verifies that the root `typecheck` script stays aligned with the workspaces typechecked in CI.

# Workspace private metadata check

`scripts/check-workspace-private.mjs` (`pnpm check:workspace-private`) verifies that root `package.json` and every non-published workspace `package.json` explicitly declare `"private": true`, preventing accidental registry publication.

If a workspace package is ever intentionally published to npm, add its package name to `PUBLISHED_WORKSPACES` in `scripts/lib/workspace-private.mjs`.

# Workspace repository metadata validation

`scripts/check-repository-metadata.mjs` (`pnpm check:repository-metadata`) and `scripts/lib/repository-metadata.test.mjs` verify that root `package.json` and every workspace `package.json` declare:

- `repository.type`: `"git"`
- `repository.url`: `"https://github.com/karagozemin/OverSync.git"`
- `repository.directory`: the workspace's relative path from the repository root (for example `"coordinator"` or `"packages/sdk"`)

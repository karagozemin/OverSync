# Deterministic workspace formatting check

`scripts/check-format.mjs` (`pnpm format:check`) runs a read-only formatting check across root `package.json` and every workspace manifest without rewriting files on disk.

## Rules

- `format:check` is strictly non-mutating (`--write`, `-w`, and `--fix` flags are rejected by `scripts/lib/format-check.mjs`).
- Workspace manifests must use canonical 2-space JSON indentation with no UTF-8 BOM, tab indentation, or trailing whitespace.

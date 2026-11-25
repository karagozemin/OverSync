# pnpm engine metadata alignment

Root `package.json` pins `"packageManager": "pnpm@8.15.0"` and `"engines": { "pnpm": "8.15.0" }` to match the exact pnpm version installed by `.github/workflows/ci.yml`.

`scripts/lib/pnpm-engine-metadata.test.mjs` (`pnpm test:scripts`) verifies that `engines.pnpm`, `packageManager`, and CI's `pnpm/action-setup` version stay aligned.

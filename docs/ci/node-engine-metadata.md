# Node engine metadata alignment

`scripts/check-node-engines.mjs` (`pnpm check:node-engines`) verifies that `.nvmrc`, every GitHub Actions `actions/setup-node` `node-version`, root `package.json`, and every workspace `package.json` declare the same reviewed Node major version (`22` / `>=22.0.0`).

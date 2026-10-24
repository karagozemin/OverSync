# Commit-specific Slither artifact naming

`scripts/check-slither-artifact-name.mjs` (`pnpm check:slither-artifact-name`) constructs and validates commit-specific artifact names (`slither-report-<short-sha>`) for the Slither static analysis report uploaded from `contracts/slither-results.json`.

## Convention

- Artifact name format: `slither-report-<short-sha>` where `<short-sha>` is the 7-character lowercase hexadecimal prefix of `GITHUB_SHA` (for example `slither-report-2c4f099`).
- Including the short commit SHA prevents ambiguity when comparing or downloading Slither JSON reports across workflow reruns and pull request updates.

# Release tag semantic version validation

`scripts/check-release-tag.mjs` (`pnpm check:release-tag`) validates release tag syntax before container registry login or image builds.

## Rules

- Release tags must match strict `vMAJOR.MINOR.PATCH` semantic versions (for example `v1.0.0` or `v1.2.3`) with no leading zeros on numeric identifiers and no `+build` metadata.
- Partial tags (`v1`, `v1.2`), unprefixed versions (`1.2.3`), and non-tag refs (`refs/heads/...`) are rejected.
- Prerelease tags (`v1.2.3-rc.1`) are rejected by default unless `ALLOW_PRERELEASE=true` is explicitly provided.

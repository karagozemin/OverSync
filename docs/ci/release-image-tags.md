# Release container image tag policy

`scripts/check-release-image-tags.mjs` (`pnpm check:release-image-tags`) verifies that `.github/workflows/release.yml` retains immutable version tags and does not publish un-gated mutable major-only container tags.

## Policy

- Every tagged release retains immutable exact-version tags: `type=ref,event=tag` (`vMAJOR.MINOR.PATCH`) and `type=semver,pattern={{version}}` (`MAJOR.MINOR.PATCH`).
- Mutable major-only tags (`pattern={{major}}` or `pattern=v{{major}}`) must remain omitted by default so resolver operators pinning a release tag never pull a silently mutated major line.
- If a moving major tag is ever needed, its `docker/metadata-action` rule must be explicitly gated with `enable=${{ inputs.publish_major_tag == true }}` (or `allowMovingMajorTag: true` in `computeReleaseContainerTags`).

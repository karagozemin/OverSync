# Release image tags

`.github/workflows/release.yml` publishes `ghcr.io/<owner>/oversync-resolver` only under immutable version tags: the git tag (`v1.2.3`) and the semver version (`1.2.3`).

It does not publish moving aliases such as `1`, `1.2` or `latest`, so a pinned tag always points to the same image. Pin deployments to a full version, or to a digest for the strongest guarantee.

`scripts/lib/release-image-tags.test.mjs` (run by `pnpm test:scripts`) fails if a moving tag is added back.

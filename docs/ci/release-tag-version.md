# Release tag vs package version

Before publishing the resolver image, `.github/workflows/release.yml` compares the pushed `v*` git tag with the root `package.json` `version` field.

The check runs immediately after checkout via `node scripts/check-release-tag-version.mjs` (`pnpm check:release-tag`), with `RELEASE_TAG` set to `${{ github.ref_name }}`. The tag must be a strict stable semantic version, exactly `vMAJOR.MINOR.PATCH` (for example `v1.2.3`). Partial (`v1`, `v1.2`), malformed (`v01.2.3`, `v1.2.3.4`, surrounding whitespace) and prerelease or build-metadata tags (`v1.2.3-rc.1`, `v1.2.3+build`) are rejected; prerelease publishing is not supported. A bad or mismatched tag fails the job with a clear diagnostic before registry login or image build.

Locally:

```bash
pnpm check:release-tag --tag v1.0.0
# or
RELEASE_TAG=v1.0.0 pnpm check:release-tag
```

`scripts/lib/release-tag-version.test.mjs` (`pnpm test:scripts`) covers match, mismatch, strict-semver rejection, and that the workflow step runs before login/build.

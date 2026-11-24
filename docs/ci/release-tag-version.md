# Release tag vs package version

Before publishing the resolver image, `.github/workflows/release.yml` compares the pushed `v*` git tag with the root `package.json` `version` field.

The check runs immediately after checkout via `node scripts/check-release-tag-version.mjs` (`pnpm check:release-tag`), with `RELEASE_TAG` set to `${{ github.ref_name }}`. A mismatch fails the job with a clear diagnostic before registry login or image build.

Locally:

```bash
pnpm check:release-tag --tag v1.0.0
# or
RELEASE_TAG=v1.0.0 pnpm check:release-tag
```

`scripts/lib/release-tag-version.test.mjs` (`pnpm test:scripts`) covers match, mismatch, and that the workflow step runs before login/build.

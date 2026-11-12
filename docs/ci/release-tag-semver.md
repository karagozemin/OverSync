# Release semantic version tag validation

`.github/workflows/release.yml` restricts tag triggers to `'v[0-9]*.[0-9]*.[0-9]*'` and runs `scripts/lib/release-tag-semver.mjs` immediately after checkout — before `docker/login-action` or `docker/build-push-action`.

## Supported tag format

- Strict `vMAJOR.MINOR.PATCH` semantic versions (for example `v1.0.0`, `v1.2.3`) with non-leading-zero integer components.
- Partial tags (`v1`, `v1.2`), malformed tags (`v01.2.3`), and prerelease or build-metadata suffixes (`v1.2.3-rc.1`, `v1.2.3+20260101`) are rejected before registry authentication or image build steps run.

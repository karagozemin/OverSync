# Release job timeout

The `resolver-docker` job in `.github/workflows/release.yml` sets `timeout-minutes: 45`.

Healthy multi-arch image builds finish well under that bound. A hung Buildx or registry push can no longer hold a runner indefinitely.

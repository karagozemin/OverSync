# Release job timeout and approval gate

The `resolver-docker` job in `.github/workflows/release.yml` sets `timeout-minutes: 45` and is attached to the GitHub `release` environment.

Healthy multi-arch image builds finish well under that bound. A hung Buildx or registry push can no longer hold a runner indefinitely.

To require manual approval before the image pushes to GHCR, configure the repository environment named `release` in GitHub with required reviewers enabled under Settings → Environments → `release`. That approval step is enforced before the workflow job can proceed to `docker/build-push-action`.

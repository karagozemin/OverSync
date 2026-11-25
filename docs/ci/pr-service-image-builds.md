# Pull-request service image builds

The `service-images` job in `.github/workflows/ci.yml` builds both `resolver` and `relayer` production Docker images with `push: false` (and `load: true`).

Broken Dockerfiles fail on pull requests (and pushes to protected branches) before a release tag publishes images to GHCR. The job never logs in to a registry and never pushes tags.

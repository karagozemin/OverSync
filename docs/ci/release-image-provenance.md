# Release image provenance

The `Build + push` step in `.github/workflows/release.yml` sets
`provenance: mode=max` on `docker/build-push-action`. Buildx publishes the
provenance attestation alongside the pushed image digest. Keep `push: true`
enabled so the attestation is included with the published image.

The `pnpm test:scripts` suite checks that max-mode provenance remains enabled
on this release step.

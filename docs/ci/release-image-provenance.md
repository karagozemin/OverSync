# Release image provenance attestations

`scripts/check-release-provenance.mjs` (`pnpm check:release-provenance`) verifies that the Buildx release step (`docker/build-push-action@v6`) is configured to emit a SLSA provenance attestation (`provenance: mode=max`) tied to the published container image digest (`sha256:...`).

## Configuration

- `provenance: mode=max` (`--provenance=mode=max`) records build inputs, source repository, commit revision, and builder environment in an in-toto SLSA provenance attestation attached to the pushed image digest in `ghcr.io`.
- `push: true` is required so BuildKit attaches the attestation manifest to the published multi-arch image digest.

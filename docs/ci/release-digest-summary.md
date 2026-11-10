# Release container image digest summary

After `docker/build-push-action` (`id: build`) pushes the multi-arch resolver image in `.github/workflows/release.yml`, the `Publish container image digest summary` step runs `scripts/lib/release-digest-summary.mjs` and appends the pushed `sha256` manifest digest (`steps.build.outputs.digest`) and full tag list (`steps.meta.outputs.tags`) to `$GITHUB_STEP_SUMMARY`.

Operators can copy the exact `ghcr.io/<owner>/oversync-resolver@sha256:...` digest reference directly from the GitHub Actions job summary for deployment pinning and provenance verification.

# Release image tags

`.github/workflows/release.yml` publishes the resolver image to GHCR when a
`v*` git tag is pushed. It publishes **immutable version tags only**:

| Tag | Source | Example |
| --- | --- | --- |
| `v<major>.<minor>.<patch>` | `type=ref,event=tag` | `v1.2.3` |
| `<major>.<minor>.<patch>` | `type=semver,pattern={{version}}` | `1.2.3` |

Both point at the same multi-arch image digest and are never repointed, so a
deployment can pin an exact release and reproduce it later.

## Policy

Do not add moving alias tags such as `{{major}}` (`:1`) or
`{{major}}.{{minor}}` (`:1.2`) to `docker/metadata-action`. Those tags are
reassigned on every later release, which means a tag alone no longer
identifies a specific image and consumers silently upgrade. Anyone who
previously pulled a `:1.2`-style tag should pin a full version (`:1.2.3`)
instead.

If a moving alias is ever needed, it must be gated behind an explicit,
documented `workflow_dispatch` input rather than published by default.

## Verification

`pnpm test:scripts` runs `scripts/lib/release-dry-run.test.mjs`, which fails if
`release.yml` reintroduces a `{{major}}` or `{{major}}.{{minor}}` rule, and
`pnpm release:dry-run --tag v1.2.3` prints the exact immutable tags the
workflow will push.

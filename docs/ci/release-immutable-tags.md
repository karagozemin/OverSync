# Immutable release container tags

`.github/workflows/release.yml` publishes immutable version tags (`type=ref,event=tag`, `type=semver,pattern={{version}}`, and `type=sha,prefix=sha-`) alongside `{{major}}.{{minor}}`.

Moving major-only tags (`pattern={{major}}`) are disabled on default tag pushes (`enable=${{ inputs.publish_major_tag == true }}`) and can only be emitted when an operator explicitly triggers `workflow_dispatch` with `publish_major_tag: true`.

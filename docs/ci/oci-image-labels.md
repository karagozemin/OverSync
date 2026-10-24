# OCI image source and revision labels

`scripts/check-oci-labels.mjs` (`pnpm check:oci-labels`) verifies that the service container definitions (`resolver/Dockerfile` and `relayer/Dockerfile`) and container build metadata populate the required OpenContainers (`org.opencontainers.image.*`) labels.

## Standard OCI labels

Every service image defines build arguments (`OCI_SOURCE`, `OCI_REVISION`, `OCI_VERSION`, `OCI_LICENSES`) and sets:

- `org.opencontainers.image.source` — canonical repository URL (`https://github.com/karagozemin/OverSync`)
- `org.opencontainers.image.revision` — Git commit SHA (`GITHUB_SHA`)
- `org.opencontainers.image.version` — semantic version (`1.0.0` / release version)
- `org.opencontainers.image.licenses` — SPDX license identifier (`MIT`)

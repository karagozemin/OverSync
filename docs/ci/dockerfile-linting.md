# Dockerfile linting (`resolver` and `relayer`)

`scripts/check-dockerfiles.mjs` (`pnpm lint:docker`) lints `resolver/Dockerfile` and `relayer/Dockerfile` using the reviewed `.hadolint.yaml` policy and makes high-severity (`error` and `warning`) findings blocking.

## Reviewed configuration (`.hadolint.yaml`)

- `failure-threshold: warning` — any `error` or `warning` rule violation fails the check.
- `trustedRegistries` — restricts base images to `docker.io` and `ghcr.io`.
- Enforces explicit image version tags (`DL3006`, `DL3007`), absolute `WORKDIR` paths (`DL3000`), `COPY` over `ADD` (`DL3020`), valid multi-stage `--from` aliases (`DL3022`), no `sudo` (`DL3004`), and JSON exec form for `CMD`/`ENTRYPOINT` (`DL3025`).

## OCI image labels (issue #400)

The final build stage of each service Dockerfile must declare the standard OCI labels, checked by `scripts/lib/dockerfile-oci-labels.mjs` (part of `pnpm lint:docker` and `pnpm test:scripts`):

| Label | Build arg | Local default |
| --- | --- | --- |
| `org.opencontainers.image.source` | `OCI_SOURCE` | `https://github.com/karagozemin/OverSync` |
| `org.opencontainers.image.revision` | `OCI_REVISION` | `unknown` |
| `org.opencontainers.image.version` | `OCI_VERSION` | `dev` |
| `org.opencontainers.image.licenses` | — | `MIT` |

Source, revision, and version must come from an `ARG` declared earlier in the final stage. `.github/workflows/release.yml` passes the repository URL, `github.sha`, and the release version from `docker/metadata-action`. For local builds, pass them yourself:

```sh
docker build \
  --build-arg OCI_REVISION="$(git rev-parse HEAD)" \
  --build-arg OCI_VERSION="$(git describe --tags --always)" \
  -f resolver/Dockerfile resolver
```

# Dockerfile linting (`resolver` and `relayer`)

`scripts/check-dockerfiles.mjs` (`pnpm lint:docker`) lints `resolver/Dockerfile` and `relayer/Dockerfile` using the reviewed `.hadolint.yaml` policy and makes high-severity (`error` and `warning`) findings blocking.

## Reviewed configuration (`.hadolint.yaml`)

- `failure-threshold: warning` — any `error` or `warning` rule violation fails the check.
- `trustedRegistries` — restricts base images to `docker.io` and `ghcr.io`.
- Enforces explicit image version tags (`DL3006`, `DL3007`), absolute `WORKDIR` paths (`DL3000`), `COPY` over `ADD` (`DL3020`), valid multi-stage `--from` aliases (`DL3022`), no `sudo` (`DL3004`), and JSON exec form for `CMD`/`ENTRYPOINT` (`DL3025`).

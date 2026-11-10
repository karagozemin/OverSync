# Pre-publication resolver image vulnerability scan

Before `.github/workflows/release.yml` pushes the multi-arch resolver image to GHCR via `docker/build-push-action@v6`, the workflow:

1. Builds and loads a local resolver container image (`oversync-resolver:scan`) from `./resolver/Dockerfile`.
2. Scans `oversync-resolver:scan` with `aquasecurity/trivy-action@0.28.0` across `os,library` packages for `HIGH,CRITICAL` vulnerabilities with `exit-code: '1'` and `ignore-unfixed: true`.

Any fixable `HIGH` or `CRITICAL` vulnerability fails the job before the image can be pushed to `ghcr.io`.

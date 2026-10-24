# Pull-request service container image builds

`scripts/check-pr-service-images.mjs` (`pnpm check:pr-images`) validates and executes no-push Docker builds for both `resolver` (`./resolver/Dockerfile`) and `relayer` (`./relayer/Dockerfile`) so broken production images are caught on pull requests before release.

## Usage

```bash
# Validate both service Dockerfiles, COPY inputs, and no-push Buildx plans
pnpm check:pr-images

# Build both resolver and relayer images locally with push=false (--load)
node scripts/check-pr-service-images.mjs --build
```

## Policy

- Both `resolver` and `relayer` must be included in pull-request container verification.
- Every pull-request build runs with `push: false` (`--load`) and never pushes tags to `ghcr.io`.

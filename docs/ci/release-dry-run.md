# Release dry-run path

`scripts/release-dry-run.mjs` (`pnpm release:dry-run`) provides a no-login, no-push release dry-run mode that validates release metadata against `.github/workflows/release.yml` and builds the exact resolver release image locally.

## Usage

```bash
# Validate release metadata and print the exact local Buildx command (defaults to v<package.json version>)
pnpm release:dry-run

# Validate a specific release tag
node scripts/release-dry-run.mjs --tag v1.2.3

# Validate metadata and run the local multi-arch Docker Buildx build without logging in or pushing
node scripts/release-dry-run.mjs --tag v1.2.3 --build
```

## Behavior

- Never calls `docker login` or authenticates to `ghcr.io`.
- Validates that the release tag matches `vMAJOR.MINOR.PATCH` and that the build context (`./resolver`) and Dockerfile (`./resolver/Dockerfile`) declared in `.github/workflows/release.yml` exist.
- Constructs the exact `docker buildx build` invocation with target platforms (`linux/amd64,linux/arm64`), image tags, and OCI labels while keeping `--push` disabled.

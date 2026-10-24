# Lockfile dependency source validation

`scripts/check-lockfile-sources.mjs` (`pnpm check:lockfile-sources`) inspects every workspace importer and resolved package entry in `pnpm-lock.yaml` before `pnpm install --frozen-lockfile` runs in CI.

## Policy

- All external packages in `pnpm-lock.yaml` must resolve from the npm registry with a `sha256`, `sha384`, or `sha512` `integrity` digest.
- Unreviewed `git+` / `git://` / `github:` / `gitlab:` / `bitbucket:` sources, `http://` / `https://` tarball URLs, and external `file:` / `link:` / `directory:` local paths are rejected.
- Internal workspace dependencies (`workspace:*` and `link:` paths that resolve to a declared workspace importer in `pnpm-lock.yaml`) are permitted.

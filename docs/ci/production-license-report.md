# Production dependency license report

`scripts/generate-license-report.mjs` (`pnpm license:report`) generates a compact JSON license report (`license-report.json`) for workspace runtime (`dependencies`) packages and embeds a concise summary into the CI evidence artifact (`evidence-summary.md`) with a short 14-day retention period.

## Usage

```bash
# Write license-report.json in the current directory (default 14-day retention metadata)
pnpm license:report

# Custom output path and retention period (1–30 days)
node scripts/generate-license-report.mjs --out license-report.json --retention-days 14
```

## Behavior

- Inspects only `dependencies` across all workspace importers in `pnpm-lock.yaml`; `devDependencies` (test runners, linters, compilers) are excluded.
- Deduplicates shared `name@version` entries and records which workspace packages depend on each runtime package.
- Enforces a short retention window (`1 <= retentionDays <= 30`, default `14` days).

# Slither report upload on analysis failure

`scripts/check-slither-report-upload.mjs` (`pnpm check:slither-report-upload`) validates that `.github/workflows/contracts.yml` uploads `contracts/slither-results.json` under an `if: always()` guard and produces a clear, non-masking diagnostic if the JSON report file is absent.

## Behavior

- **Upload when analysis fails:** The `Upload Slither report` step uses `if: always()` so detector findings in `contracts/slither-results.json` are uploaded as an artifact even when `slither` exits non-zero.
- **Clear diagnostic on missing report:** If an earlier step (such as contract compilation) fails before `contracts/slither-results.json` is written, `inspectSlitherReportFile` emits an explicit diagnostic naming the missing path and preserves the upstream failure status rather than masking it with an upload error.

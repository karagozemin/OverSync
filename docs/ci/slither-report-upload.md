# Slither report upload on analysis failure

The Slither job in `.github/workflows/contracts.yml` uploads `contracts/slither-results.json` under `if: always()`, so detector findings remain available as a CI artifact when `slither` exits non-zero.

If the report file is missing or empty (for example after a compile failure before analysis writes JSON), the pre-upload check emits a `::warning` diagnostic and the upload step uses `if-no-files-found: warn`. That keeps the job failure tied to the upstream analysis or build step instead of masking it with an upload error.

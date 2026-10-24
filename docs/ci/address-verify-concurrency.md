# Address verification concurrency cancellation

`scripts/check-address-verify-concurrency.mjs` (`pnpm check:address-verify-concurrency`) validates the branch-scoped concurrency cancellation policy for `.github/workflows/address-verify.yml`.

## Policy

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

- Scoping the concurrency group by `github.workflow` and `github.ref` ensures rapid pushes to the same branch or pull request cancel superseded address consistency runs while independent branches continue to run in parallel.

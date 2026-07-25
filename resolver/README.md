# OverSync Resolver

Reference resolver runner for the OverSync cross-chain bridge.

## Preflight Command

Before registering or staking as an operator, you can run the read-only preflight check to validate your local configuration (`.env`), check RPC reachability, verify testnet configurations, and ensure the resolver status is queryable.

This command is strictly read-only: it performs no contract writes, sends no transactions, and requires no fund movement.

### Running Preflight

Run the command from the root of the repository:

```bash
pnpm --filter @oversync/resolver run start preflight
```

Or directly inside the `resolver` directory:

```bash
pnpm start preflight
```

### Outputs

The command will output the PASS/FAIL/SKIPPED status for each check:

* **PASS**: Check passed successfully.
* **FAIL**: Check failed; prints actionable next steps (e.g. `Configure REGISTRY_ADDRESS`).
* **SKIPPED**: Check was skipped due to missing configuration.

# Coordinator Health API Specification

The `/health` endpoint provides operators, orchestrators (like Kubernetes or Docker), and automated monitoring tools a secure way to verify the deployment state, active build metadata, and core downstream dependency status of the OverSync Coordinator.

---

## Endpoint Configuration

- **Route:** `/health`
- **Method:** `GET`
- **Content-Type:** `application/json`
- **Authentication:** None (Publicly accessible for infrastructure probes)

---

## Response Schema Architecture

The payload is structurally split into a high-level backward-compatible layer, an isolated environment context block, and a secure dependency check status object.

### Fields and Types

| Field Path                               | Type             | Description                                                                                                                              |
| :--------------------------------------- | :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                 | `string`         | General operational status. Always returns `"ok"` if the Express server is handling requests.                                            |
| `service`                                | `string`         | The hardcoded identity signature of this workspace layer (`"oversync-coordinator"`).                                                     |
| `version`                                | `string`         | The active software version fetched directly from the coordinator workspace's `package.json` context.                                    |
| `uptimeSeconds`                          | `number`         | Number of elapsed seconds since this specific coordinator instance was booted.                                                           |
| `timestamp`                              | `string`         | Automated ISO 8601 string representation of the node's current system clock.                                                             |
| `build.env`                              | `string`         | Target network environment mode parsed from the host machine's `NETWORK_MODE` (`"testnet"` or `"mainnet"`).                              |
| `build.commit`                           | `string \| null` | The exact deployment Git commit SHA injected dynamically during build time via standard CI variables (`GIT_COMMIT`, `COMMIT_SHA`, etc.). |
| `dependencies.database.mode`             | `string`         | The active persistence layer layout parsed from the connection string schema (`"sqlite"`, `"postgres"`, or `"unknown"`).                 |
| `dependencies.ethereum.rpcUrlConfigured` | `boolean`        | Flag signaling whether an EVM blockchain connection string or API token layer is actively loaded.                                        |
| `dependencies.ethereum.rpcUrl`           | `string \| null` | Sanitized protocol and host domain origin of the EVM endpoint. Sub-paths, keys, and authorization details are aggressively stripped.     |
| `dependencies.soroban.rpcUrlConfigured`  | `boolean`        | Flag signaling whether a Stellar/Soroban smart contract event poller link is explicitly active.                                          |
| `dependencies.soroban.rpcUrl`            | `string \| null` | Sanitized protocol and host domain origin of the Stellar/Horizon infrastructure network endpoint.                                        |

---

## Security & Redaction Protocols

To enforce absolute data privacy and prevent operational infrastructure leaks, the route processes all raw connection components through a native parsing engine before rendering the final JSON payload:

1. **Token Stripping:** Query parameters, API keys, and endpoint paths (such as Infura project tokens or Horizon path strings) are completely sliced out.
2. **Credential Masking:** Embedded inline basic authentication items (`//user:password@host`) are automatically removed, exposing only clean network domains.
3. **Fallback Actions:** If a connection string is structurally malformed or unparseable by standard URL specifications, the route forcefully falls back to a safe text mask (`"[REDACTED]"`).

---

## Sample Payloads

### 1. Default Local Development (SQLite)

```json
{
  "status": "ok",
  "service": "oversync-coordinator",
  "version": "0.1.0",
  "uptimeSeconds": 42,
  "timestamp": "2026-06-28T23:35:00.123Z",
  "build": {
    "env": "testnet",
    "commit": null
  },
  "dependencies": {
    "database": {
      "mode": "sqlite"
    },
    "ethereum": {
      "rpcUrlConfigured": true,
      "rpcUrl": "[https://sepolia.infura.io](https://sepolia.infura.io)"
    },
    "soroban": {
      "rpcUrlConfigured": true,
      "rpcUrl": "[https://horizon-testnet.stellar.org](https://horizon-testnet.stellar.org)"
    }
  }
}
```

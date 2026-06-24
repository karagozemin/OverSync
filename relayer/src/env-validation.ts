/**
 * Strict environment validation for the relayer service.
 *
 * Called once at startup — any missing or malformed variable causes a
 * descriptive fatal error instead of silently using placeholder values
 * that produce wrong behaviour at runtime.
 */

function requireEnv(errors: string[], name: string, description: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "" || v.includes("YOUR_") || v.includes("SAMPLE")) {
    errors.push(`  ${name}: ${description}`);
    return "";
  }
  return v.trim();
}

function requireEthPrivateKey(errors: string[], name: string, description: string): string {
  const v = requireEnv(errors, name, description);
  if (v && !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    errors.push(`  ${name}: must be a 0x-prefixed 32-byte private key`);
  }
  return v;
}

function requirePositiveInt(errors: string[], name: string, description: string, defaultVal: number): number {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    errors.push(`  ${name}: must be a positive integer (got "${raw}")`);
    return defaultVal;
  }
  return n;
}

export interface ValidatedRelayerEnv {
  networkMode: "testnet" | "mainnet";
  mainnetAuditConfirmed: boolean;
  ethereumRpcUrl: string;
  relayerPrivateKey: string;
  stellarSecret: string;
  stellarPublicKey: string;
  rpcTimeoutMs: number;
  port: number;
}

/**
 * Parse and validate relayer environment variables.
 * Throws a single error listing every problem found.
 */
export function validateRelayerEnv(): ValidatedRelayerEnv {
  const errors: string[] = [];

  const networkMode = (process.env.NETWORK_MODE ?? "testnet") as "testnet" | "mainnet";
  if (networkMode !== "testnet" && networkMode !== "mainnet") {
    errors.push(`  NETWORK_MODE: must be 'testnet' or 'mainnet' (got "${networkMode}")`);
  }

  const mainnetAuditConfirmed = process.env.MAINNET_AUDIT_CONFIRMED === "true";
  if (networkMode === "mainnet" && !mainnetAuditConfirmed) {
    errors.push(
      "  MAINNET_AUDIT_CONFIRMED: must be 'true' when NETWORK_MODE=mainnet. " +
        "Read docs/DEPLOYMENT.md#mainnet-rollout-checklist before enabling."
    );
  }

  // RPC URL — accept explicit var first, then fall back to Infura if key is set.
  const explicitRpc =
    networkMode === "mainnet"
      ? process.env.MAINNET_RPC_URL
      : process.env.SEPOLIA_RPC_URL ?? process.env.ETHEREUM_RPC_URL;
  const infuraKey = process.env.INFURA_API_KEY;
  const ethereumRpcUrl =
    explicitRpc?.trim() ||
    (infuraKey
      ? networkMode === "mainnet"
        ? `https://mainnet.infura.io/v3/${infuraKey}`
        : `https://sepolia.infura.io/v3/${infuraKey}`
      : "");

  if (!ethereumRpcUrl) {
    errors.push(
      "  SEPOLIA_RPC_URL / MAINNET_RPC_URL / INFURA_API_KEY: at least one Ethereum RPC source is required"
    );
  } else if (!ethereumRpcUrl.startsWith("http://") && !ethereumRpcUrl.startsWith("https://")) {
    errors.push(`  Ethereum RPC URL: must be a valid HTTP(S) URL (got "${ethereumRpcUrl}")`);
  }

  const relayerPrivateKey = requireEthPrivateKey(errors, "RELAYER_PRIVATE_KEY", "required to sign ETH release transactions");
  const stellarSecret = requireEnv(errors, "RELAYER_STELLAR_SECRET", "required to sign Stellar payment transactions");
  const stellarPublicKey = requireEnv(errors, "RELAYER_STELLAR_PUBLIC", "required to monitor incoming Stellar payments");
  const rpcTimeoutMs = requirePositiveInt(errors, "RELAYER_RPC_TIMEOUT_MS", "must be a positive integer (milliseconds)", 30_000);
  const port = requirePositiveInt(errors, "RELAYER_PORT", "must be a positive integer", 3001);

  if (errors.length > 0) {
    throw new Error(
      `Relayer configuration invalid — fix these env vars before starting:\n${errors.join("\n")}`
    );
  }

  return {
    networkMode,
    mainnetAuditConfirmed,
    ethereumRpcUrl,
    relayerPrivateKey,
    stellarSecret,
    stellarPublicKey,
    rpcTimeoutMs,
    port,
  };
}

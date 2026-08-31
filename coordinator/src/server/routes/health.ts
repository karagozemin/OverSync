import { Router } from "express";
import { createHash } from "node:crypto";

function getBuildEnv(): "testnet" | "mainnet" {
  const v = (process.env.NETWORK_MODE ?? "testnet").toLowerCase();
  return v === "mainnet" ? "mainnet" : "testnet";
}

function redactRpcUrl(maybeUrl: string | undefined): string | null {
  const raw = (maybeUrl ?? "").trim();
  if (!raw) return null;

  // Handle special static mock flags from our route config
  if (raw === "[CONFIGURED_VIA_INFURA_API_KEY]") return raw;

  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "[REDACTED]";
  }
}

function inferDatabaseMode(
  databaseUrl: string | undefined,
): "sqlite" | "postgres" | "unknown" {
  const url = (databaseUrl ?? "").trim();
  if (!url) return "unknown";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://"))
    return "postgres";
  if (url.startsWith("file:")) return "sqlite";
  return "unknown";
}

/**
 * Derive a human-readable Ethereum chain name from a chain id.
 * Used only by /readiness — does not affect /health.
 */
function ethChainName(chainId: number | undefined): string | null {
  if (!chainId) return null;
  const known: Record<number, string> = {
    1: "mainnet",
    11_155_111: "sepolia",
    5: "goerli",
    17_000: "holesky",
  };
  return known[chainId] ?? `chain-${chainId}`;
}

/**
 * Derive a human-readable Stellar network label from a configured
 * passphrase, without ever emitting the passphrase itself.
 * Used only by /readiness — does not affect /health.
 */
function stellarNetworkLabel(passphrase: string | undefined): string {
  const p = passphrase ?? "";
  if (p.includes("Test SDF")) return "testnet";
  if (p.includes("Public Global")) return "mainnet";
  return "unknown";
}

function networkPassphraseHash(passphrase: string | undefined): string | null {
  const value = (passphrase ?? "").trim();
  if (!value) return null;
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function configuredStellarPassphrase(): string {
  return (
    process.env.STELLAR_NETWORK_PASSPHRASE ??
    (getBuildEnv() === "mainnet"
      ? "Public Global Stellar Network ; September 2015"
      : "Test SDF Network ; September 2015")
  );
}

export function healthRoutes(): Router {
  const router = Router();
  const startedAt = Date.now();

  // ── GET /health — existing contract, unchanged ───────────────────────────
  router.get("/health", (_req, res) => {
    const version = process.env.npm_package_version ?? "0.1.0";
    const buildEnv = getBuildEnv();

    const commit =
      process.env.GIT_COMMIT ??
      process.env.COMMIT_SHA ??
      process.env.SOURCE_VERSION ??
      null;

    const databaseMode = inferDatabaseMode(process.env.DATABASE_URL);

    const ethereumRpcUrl =
      (process.env.ETHEREUM_RPC_URL ??
      process.env.SEPOLIA_RPC_URL ??
      process.env.MAINNET_RPC_URL ??
      process.env.INFURA_API_KEY)
        ? "[CONFIGURED_VIA_INFURA_API_KEY]"
        : undefined;

    const sorobanRpcUrl = process.env.SOROBAN_RPC_URL ?? undefined;

    res.json({
      status: "ok",
      service: "oversync-coordinator",

      version,

      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),

      build: {
        env: buildEnv,
        commit: commit || null,
      },

      dependencies: {
        database: {
          mode: databaseMode,
        },
        ethereum: {
          rpcUrlConfigured: Boolean(
            process.env.ETHEREUM_RPC_URL ||
            process.env.SEPOLIA_RPC_URL ||
            process.env.MAINNET_RPC_URL ||
            process.env.INFURA_API_KEY,
          ),
          rpcUrl: redactRpcUrl(
            process.env.ETHEREUM_RPC_URL ||
              process.env.SEPOLIA_RPC_URL ||
              process.env.MAINNET_RPC_URL ||
              ethereumRpcUrl,
          ),
        },
        soroban: {
          rpcUrlConfigured: Boolean(sorobanRpcUrl),
          rpcUrl: redactRpcUrl(sorobanRpcUrl),
        },
      },
    });
  });

  // ── GET /readiness — new, additive, env-driven like /health ─────────────
  router.get("/readiness", (_req, res) => {
    const version = process.env.npm_package_version ?? "0.1.0";
    const networkMode = getBuildEnv();

    const ethChainId = process.env.ETHEREUM_CHAIN_ID
      ? Number(process.env.ETHEREUM_CHAIN_ID)
      : networkMode === "mainnet"
        ? 1
        : 11_155_111; // default to Sepolia for testnet mode

    const sorobanRpcUrl = process.env.SOROBAN_RPC_URL ?? undefined;
    const sorobanPassphrase = configuredStellarPassphrase();

    const databaseMode = inferDatabaseMode(process.env.DATABASE_URL);
    // We only report reachability, never the connection string itself.
    const databaseReachable = databaseMode !== "unknown";

    const wsEnabled =
      (process.env.WS_ENABLED ?? process.env.WEBSOCKET_ENABLED ?? "false")
        .toLowerCase() === "true";

    res.json({
      service: "oversync-coordinator",
      version,
      networkMode,
      ethereum: {
        chainId: ethChainId,
        chainName: ethChainName(ethChainId),
      },
      stellar: {
        network: stellarNetworkLabel(sorobanPassphrase),
        // Expose a comparison-safe fingerprint rather than the passphrase.
        networkPassphraseHash: networkPassphraseHash(sorobanPassphrase),
        rpcConfigured: Boolean(sorobanRpcUrl),
      },
      database: {
        reachable: databaseReachable,
      },
      websocket: {
        enabled: wsEnabled,
      },
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

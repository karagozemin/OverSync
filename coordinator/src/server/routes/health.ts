import { Router } from "express";

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

export function healthRoutes(): Router {
  const router = Router();
  const startedAt = Date.now();

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

  return router;
}

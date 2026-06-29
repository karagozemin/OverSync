import { Router } from "express";
import type { CoordinatorConfig } from "../../config.js";

/**
 * Minimal interface for any db-like object that lets us test reachability
 * without importing the full database module.
 */
export interface DbProbe {
  /** Returns true when the database can be reached. */
  isReady(): boolean;
}

export interface HealthRouteDeps {
  config: CoordinatorConfig;
  db: DbProbe;
  wsEnabled?: boolean;
}

/**
 * Derive a human-readable Stellar network label from the passphrase so we
 * never expose the full passphrase string in the response.
 */
function stellarNetworkLabel(passphrase: string): string {
  if (passphrase.includes("Test SDF")) return "testnet";
  if (passphrase.includes("Public Global")) return "mainnet";
  return "custom";
}

/**
 * Derive a chain name from the numeric Ethereum chain id.
 */
function ethChainName(chainId: number): string {
  const known: Record<number, string> = {
    1: "mainnet",
    11_155_111: "sepolia",
    5: "goerli",
    17_000: "holesky",
  };
  return known[chainId] ?? `chain-${chainId}`;
}

export function healthRoutes(deps?: HealthRouteDeps): Router {
  const router = Router();
  const startedAt = Date.now();

  // ── GET /health — existing lightweight ping ─────────────────────────────
  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "oversync-coordinator",
      version: process.env.npm_package_version ?? "0.1.0",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  // ── GET /readiness — richer public readiness signal ─────────────────────
  router.get("/readiness", (_req, res) => {
    const cfg = deps?.config;
    const dbReady = deps?.db.isReady() ?? true;

    const payload: Record<string, unknown> = {
      service: "oversync-coordinator",
      version: process.env.npm_package_version ?? "0.1.0",
      networkMode: cfg?.network ?? process.env.NETWORK_MODE ?? "testnet",
      ethereum: cfg
        ? {
            chainId: cfg.ethereum.chainId,
            chainName: ethChainName(cfg.ethereum.chainId),
          }
        : null,
      stellar: cfg
        ? {
            network: stellarNetworkLabel(cfg.soroban.networkPassphrase),
          }
        : null,
      database: { reachable: dbReady },
      websocket: { enabled: deps?.wsEnabled ?? false },
      timestamp: new Date().toISOString(),
    };

    // Return 503 when the database is not reachable so load-balancers and
    // healthcheck probes can act on it, but still return JSON so callers
    // can read the payload.
    const status = dbReady ? 200 : 503;
    res.status(status).json(payload);
  });

  return router;
}
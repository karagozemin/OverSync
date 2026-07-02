import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { getLogger } from "./logger.js"; // Import the updated logger framework

dotenvConfig({ path: resolve(process.cwd(), ".env") });

export type Network = "testnet" | "mainnet";

export interface EthereumConfig {
  rpcUrl: string;
  chainId: number;
  htlcEscrow: `0x${string}` | null;
  resolverRegistry: `0x${string}` | null;
  resolverPrivateKey: `0x${string}` | null;
}

export interface SorobanConfig {
  rpcUrl: string;
  networkPassphrase: string;
  horizonUrl: string;
  htlc: string | null;
  resolverRegistry: string | null;
  resolverSecret: string | null;
}

export interface ResolverConfig {
  network: Network;
  pollIntervalMs: number;
  coordinatorUrl: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
  ethereum: EthereumConfig;
  soroban: SorobanConfig;
}

import { resolveEthereumRpcUrl } from "./ethereum-rpc-url.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optionalAddress(name: string): `0x${string}` | null {
  const v = process.env[name];
  if (!v) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`${name} is not a 0x-prefixed 20-byte address`);
  }
  return v as `0x${string}`;
}

export function loadConfig(): ResolverConfig {
  const network = (process.env.NETWORK_MODE ?? "testnet") as Network;
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(`NETWORK_MODE must be 'testnet' or 'mainnet', got: ${network}`);
  }

  const isMainnet = network === "mainnet";

  const config: ResolverConfig = {
    network,
    pollIntervalMs: Number(process.env.RESOLVER_POLL_INTERVAL_MS ?? 15_000),
    coordinatorUrl: process.env.COORDINATOR_URL ?? "http://localhost:3001",
    logLevel: (process.env.LOG_LEVEL as ResolverConfig["logLevel"]) ?? "info",
    ethereum: {
      rpcUrl: resolveEthereumRpcUrl(isMainnet ? "mainnet" : "testnet"),
      chainId: isMainnet ? 1 : 11_155_111,
      htlcEscrow: optionalAddress(isMainnet ? "ETH_HTLC_ESCROW_MAINNET" : "ETH_HTLC_ESCROW_TESTNET"),
      resolverRegistry: optionalAddress(
        isMainnet ? "ETH_RESOLVER_REGISTRY_MAINNET" : "ETH_RESOLVER_REGISTRY_TESTNET"
      ),
      resolverPrivateKey:
        (process.env.RESOLVER_ETH_PRIVATE_KEY as `0x${string}` | undefined) ?? null
    },
    soroban: {
      rpcUrl:
        process.env.SOROBAN_RPC_URL ??
        (isMainnet ? "https://mainnet.sorobanrpc.com" : "https://soroban-testnet.stellar.org"),
      horizonUrl:
        process.env.STELLAR_HORIZON_URL ??
        (isMainnet ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org"),
      networkPassphrase: isMainnet
        ? "Public Global Stellar Network ; September 2015"
        : "Test SDF Network ; September 2015",
      htlc: process.env[isMainnet ? "SOROBAN_HTLC_MAINNET" : "SOROBAN_HTLC_TESTNET"] ?? null,
      resolverRegistry:
        process.env[
          isMainnet ? "SOROBAN_RESOLVER_REGISTRY_MAINNET" : "SOROBAN_RESOLVER_REGISTRY_TESTNET"
        ] ?? null,
      resolverSecret: process.env.RESOLVER_STELLAR_SECRET ?? null
    }
  };

  // Instantiate logger configuration context
  const logger = getLogger(config.logLevel);

  // Print startup configuration indicators safely
  logger.info("Initializing OverSync Resolver engine instance configurations...");
  logger.info(`Network operating target: ${config.network}`);
  logger.info(`Coordinator upstream mapping endpoint: ${config.coordinatorUrl}`);
  logger.info(`Polling cycle state intervals: ${config.pollIntervalMs}ms`);

  // Emits complete settings object topology (The deep hook in logger.ts strips secret keys instantly)
  logger.info({ msg: "OverSync active module runtime mappings configuration payload", runtimeConfig: config });

  return config;
}
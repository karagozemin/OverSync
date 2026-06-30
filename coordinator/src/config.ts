import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";
import { resolveEthereumRpcUrl } from "./ethereum-rpc-url.js";

dotenvConfig({ path: resolve(process.cwd(), ".env") });

const networkSchema = z.enum(["testnet", "mainnet"]);
export type Network = z.infer<typeof networkSchema>;

const configSchema = z.object({
  network: networkSchema.default("testnet"),
  port: z.coerce.number().int().positive().default(3001),
  databaseUrl: z.string().default("file:./oversync.db"),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  corsOrigins: z
    .string()
    .default("http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173"),
  pollIntervalMs: z.coerce.number().int().positive().default(15_000),
  /** Maximum allowed JSON request body size in bytes. Default: 64 KiB. */
  maxRequestBodyBytes: z.coerce.number().int().positive().default(65_536),
  ethereum: z.object({
    rpcUrl: z.string().url(),
    chainId: z.number().int(),
    htlcEscrow: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? (v as `0x${string}`) : null)),
    resolverRegistry: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? (v as `0x${string}`) : null))
  }),
  soroban: z.object({
    rpcUrl: z.string().url(),
    horizonUrl: z.string().url(),
    networkPassphrase: z.string(),
    htlcContract: z.string().optional().transform((v) => v ?? null),
    resolverRegistry: z.string().optional().transform((v) => v ?? null)
  })
});

export type CoordinatorConfig = z.infer<typeof configSchema>;

export function loadConfig(): CoordinatorConfig {
  const network = (process.env.NETWORK_MODE ?? "testnet") as Network;
  const isMainnet = network === "mainnet";

  const raw = {
    network,
    port: process.env.COORDINATOR_PORT ?? process.env.RELAYER_PORT ?? "3001",
    databaseUrl: process.env.DATABASE_URL ?? "file:./oversync.db",
    logLevel: process.env.LOG_LEVEL ?? "info",
    corsOrigins:
      process.env.COORDINATOR_CORS_ORIGINS ??
      process.env.CORS_ORIGIN ??
      "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173",
    pollIntervalMs: process.env.COORDINATOR_POLL_INTERVAL_MS ?? "15000",
    maxRequestBodyBytes: process.env.COORDINATOR_MAX_BODY_BYTES ?? "65536",
    ethereum: {
      rpcUrl: resolveEthereumRpcUrl(isMainnet ? "mainnet" : "testnet"),
      chainId: isMainnet ? 1 : 11_155_111,
      htlcEscrow: process.env[isMainnet ? "ETH_HTLC_ESCROW_MAINNET" : "ETH_HTLC_ESCROW_TESTNET"] ?? "",
      resolverRegistry:
        process.env[isMainnet ? "ETH_RESOLVER_REGISTRY_MAINNET" : "ETH_RESOLVER_REGISTRY_TESTNET"] ?? ""
    },
    soroban: {
      rpcUrl: process.env.SOROBAN_RPC_URL ?? (isMainnet ? "https://mainnet.sorobanrpc.com" : "https://soroban-testnet.stellar.org"),
      horizonUrl: process.env.STELLAR_HORIZON_URL ?? (isMainnet ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org"),
      networkPassphrase: isMainnet
        ? "Public Global Stellar Network ; September 2015"
        : "Test SDF Network ; September 2015",
      htlcContract: process.env[isMainnet ? "SOROBAN_HTLC_MAINNET" : "SOROBAN_HTLC_TESTNET"],
      resolverRegistry:
        process.env[isMainnet ? "SOROBAN_RESOLVER_REGISTRY_MAINNET" : "SOROBAN_RESOLVER_REGISTRY_TESTNET"]
    }
  };

  return configSchema.parse(raw);
}

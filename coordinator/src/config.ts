import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";
import { resolveEthereumRpcUrl } from "./ethereum-rpc-url.js";

dotenvConfig({ path: resolve(process.cwd(), ".env") });

const networkSchema = z.enum(["testnet", "mainnet"]);
export type Network = z.infer<typeof networkSchema>;

/** Ethereum address: 0x + 40 hex chars */
const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address");

/**
 * Coordinator configuration schema.
 *
 * Validation rules:
 *  - All RPC / Horizon URLs must be valid HTTPS (or HTTP for local dev).
 *  - Testnet contract IDs are recommended but not hard-required so the
 *    coordinator can start in read-only mode before contracts are deployed.
 *  - Mainnet is explicitly gated: NETWORK_MODE=mainnet requires
 *    MAINNET_AUDIT_CONFIRMED=true to prevent accidental production deploys.
 */
const configSchema = z
  .object({
    network: networkSchema.default("testnet"),
    mainnetAuditConfirmed: z.boolean().default(false),
    port: z.coerce.number().int().positive().default(3001),
    databaseUrl: z.string().min(1).default("file:./oversync.db"),
    logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
    corsOrigin: z.string().default("*"),
    pollIntervalMs: z.coerce.number().int().positive().default(15_000),
    ethereum: z.object({
      rpcUrl: z.string().url("ETH_RPC_URL must be a valid URL"),
      chainId: z.number().int(),
      htlcEscrow: addressSchema
        .optional()
        .or(z.literal(""))
        .transform((v) => (v ? (v as `0x${string}`) : null)),
      resolverRegistry: addressSchema
        .optional()
        .or(z.literal(""))
        .transform((v) => (v ? (v as `0x${string}`) : null)),
    }),
    soroban: z.object({
      rpcUrl: z.string().url("SOROBAN_RPC_URL must be a valid URL"),
      horizonUrl: z.string().url("STELLAR_HORIZON_URL must be a valid URL"),
      networkPassphrase: z.string().min(1),
      htlcContract: z.string().optional().transform((v) => v ?? null),
      resolverRegistry: z.string().optional().transform((v) => v ?? null),
    }),
  })
  .superRefine((cfg, ctx) => {
    // Mainnet requires explicit audit confirmation.
    if (cfg.network === "mainnet" && !cfg.mainnetAuditConfirmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mainnetAuditConfirmed"],
        message:
          "NETWORK_MODE=mainnet requires MAINNET_AUDIT_CONFIRMED=true. " +
          "Read docs/DEPLOYMENT.md#mainnet-rollout-checklist before enabling.",
      });
    }
  });

export type CoordinatorConfig = z.infer<typeof configSchema>;

export function loadConfig(): CoordinatorConfig {
  const network = (process.env.NETWORK_MODE ?? "testnet") as Network;
  const isMainnet = network === "mainnet";

  const raw = {
    network,
    mainnetAuditConfirmed: process.env.MAINNET_AUDIT_CONFIRMED === "true",
    port: process.env.COORDINATOR_PORT ?? process.env.RELAYER_PORT ?? "3001",
    databaseUrl: process.env.DATABASE_URL ?? "file:./oversync.db",
    logLevel: process.env.LOG_LEVEL ?? "info",
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    pollIntervalMs: process.env.COORDINATOR_POLL_INTERVAL_MS ?? "15000",
    ethereum: {
      rpcUrl: resolveEthereumRpcUrl(isMainnet ? "mainnet" : "testnet"),
      chainId: isMainnet ? 1 : 11_155_111,
      htlcEscrow:
        process.env[isMainnet ? "ETH_HTLC_ESCROW_MAINNET" : "ETH_HTLC_ESCROW_TESTNET"] ?? "",
      resolverRegistry:
        process.env[
          isMainnet ? "ETH_RESOLVER_REGISTRY_MAINNET" : "ETH_RESOLVER_REGISTRY_TESTNET"
        ] ?? "",
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
      htlcContract:
        process.env[isMainnet ? "SOROBAN_HTLC_MAINNET" : "SOROBAN_HTLC_TESTNET"],
      resolverRegistry:
        process.env[
          isMainnet ? "SOROBAN_RESOLVER_REGISTRY_MAINNET" : "SOROBAN_RESOLVER_REGISTRY_TESTNET"
        ],
    },
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `  [${i.path.join(".")}] ${i.message}`)
      .join("\n");
    throw new Error(`Coordinator configuration invalid:\n${messages}`);
  }
  return result.data;
}

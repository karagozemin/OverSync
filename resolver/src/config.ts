import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";
import { getLogger } from "./logger.js"; // Import the updated logger framework
import { resolveEthereumRpcUrl } from "./ethereum-rpc-url.js";

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

const configSchema = z.object({
  network: z.enum(["testnet", "mainnet"]).default("testnet"),
  pollIntervalMs: z.coerce.number().int().positive().default(15_000),
  coordinatorUrl: z.string().url().default("http://localhost:3001"),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  // Mainnet requires explicit audit confirmation to prevent accidental enablement
  mainnetAuditConfirmed: z.preprocess(
    (v) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        return s === "true" || s === "1" || s === "yes" || s === "on";
      }
      return false;
    },
    z.boolean().default(false)
  ),
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
      .transform((v) => (v ? (v as `0x${string}`) : null)),
    resolverPrivateKey: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? (v as `0x${string}`) : null))
  }),
  soroban: z.object({
    rpcUrl: z.string().url(),
    horizonUrl: z.string().url(),
    networkPassphrase: z.string(),
    htlc: z.string().optional().transform((v) => v ?? null),
    resolverRegistry: z.string().optional().transform((v) => v ?? null),
    resolverSecret: z.string().optional().transform((v) => v ?? null)
  })
});

export type ResolverConfigValidated = z.infer<typeof configSchema>;

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

  // Mainnet requires explicit audit confirmation
  if (isMainnet) {
    const auditConfirmed = process.env.MAINNET_AUDIT_CONFIRMED === "true";
    if (!auditConfirmed) {
      throw new Error(
        "MAINNET DEPLOYMENT BLOCKED: Set MAINNET_AUDIT_CONFIRMED=true only after " +
        "completing the mainnet readiness checklist in docs/DEPLOYMENT.md. " +
        "This includes audit completion, multisig ownership, and bug bounty."
      );
    }
  }

  const raw = {
    network,
    pollIntervalMs: process.env.RESOLVER_POLL_INTERVAL_MS ?? "15000",
    coordinatorUrl: process.env.COORDINATOR_URL ?? "http://localhost:3001",
    logLevel: process.env.LOG_LEVEL ?? "info",
    mainnetAuditConfirmed: process.env.MAINNET_AUDIT_CONFIRMED,
    ethereum: {
      rpcUrl: resolveEthereumRpcUrl(isMainnet ? "mainnet" : "testnet"),
      chainId: isMainnet ? 1 : 11_155_111,
      htlcEscrow: process.env[isMainnet ? "ETH_HTLC_ESCROW_MAINNET" : "ETH_HTLC_ESCROW_TESTNET"] ?? "",
      resolverRegistry:
        process.env[isMainnet ? "ETH_RESOLVER_REGISTRY_MAINNET" : "ETH_RESOLVER_REGISTRY_TESTNET"] ?? "",
      resolverPrivateKey:
        (process.env.RESOLVER_ETH_PRIVATE_KEY as `0x${string}` | undefined) ?? ""
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
      htlc: process.env[isMainnet ? "SOROBAN_HTLC_MAINNET" : "SOROBAN_HTLC_TESTNET"] ?? "",
      resolverRegistry:
        process.env[
          isMainnet ? "SOROBAN_RESOLVER_REGISTRY_MAINNET" : "SOROBAN_RESOLVER_REGISTRY_TESTNET"
        ] ?? "",
      resolverSecret: process.env.RESOLVER_STELLAR_SECRET ?? ""
    }
  };

  const result = configSchema.parse(raw);

  // Additional validation: testnet requires contract addresses
  if (!isMainnet) {
    const missingTestnetContracts = [];
    if (!result.ethereum.htlcEscrow) {
      missingTestnetContracts.push("ETH_HTLC_ESCROW_TESTNET");
    }
    if (!result.ethereum.resolverRegistry) {
      missingTestnetContracts.push("ETH_RESOLVER_REGISTRY_TESTNET");
    }
    if (!result.soroban.htlc) {
      missingTestnetContracts.push("SOROBAN_HTLC_TESTNET");
    }
    if (!result.soroban.resolverRegistry) {
      missingTestnetContracts.push("SOROBAN_RESOLVER_REGISTRY_TESTNET");
    }

    if (missingTestnetContracts.length > 0) {
      throw new Error(
        `TESTNET DEPLOYMENT INCOMPLETE: Missing required testnet contract addresses: ` +
        missingTestnetContracts.join(", ") +
        ". Deploy contracts first (see docs/DEPLOYMENT.md) or check env.example for variable names."
      );
    }
  }

  // Convert to legacy ResolverConfig format for backward compatibility
  const config: ResolverConfig = {
    network: result.network,
    pollIntervalMs: result.pollIntervalMs,
    coordinatorUrl: result.coordinatorUrl,
    logLevel: result.logLevel,
    ethereum: {
      rpcUrl: result.ethereum.rpcUrl,
      chainId: result.ethereum.chainId,
      htlcEscrow: result.ethereum.htlcEscrow,
      resolverRegistry: result.ethereum.resolverRegistry,
      resolverPrivateKey: result.ethereum.resolverPrivateKey
    },
    soroban: {
      rpcUrl: result.soroban.rpcUrl,
      networkPassphrase: result.soroban.networkPassphrase,
      horizonUrl: result.soroban.horizonUrl,
      htlc: result.soroban.htlc,
      resolverRegistry: result.soroban.resolverRegistry,
      resolverSecret: result.soroban.resolverSecret
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

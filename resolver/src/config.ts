import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";
import { resolveEthereumRpcUrl } from "./ethereum-rpc-url.js";

dotenvConfig({ path: resolve(process.cwd(), ".env") });

export type Network = "testnet" | "mainnet";

/** 0x-prefixed 20-byte Ethereum address */
const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address")
  .transform((v) => v as `0x${string}`);

/** 0x-prefixed 32-byte Ethereum private key */
const privateKeySchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte private key")
  .transform((v) => v as `0x${string}`);

const resolverConfigSchema = z
  .object({
    network: z.enum(["testnet", "mainnet"]).default("testnet"),
    mainnetAuditConfirmed: z.boolean().default(false),
    pollIntervalMs: z.coerce.number().int().positive().default(15_000),
    coordinatorUrl: z.string().url("COORDINATOR_URL must be a valid URL").default("http://localhost:3001"),
    logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
    ethereum: z.object({
      rpcUrl: z.string().url("Ethereum RPC URL must be a valid URL"),
      chainId: z.number().int(),
      htlcEscrow: addressSchema.nullable().default(null),
      resolverRegistry: addressSchema.nullable().default(null),
      resolverPrivateKey: privateKeySchema.nullable().default(null),
    }),
    soroban: z.object({
      rpcUrl: z.string().url("SOROBAN_RPC_URL must be a valid URL"),
      horizonUrl: z.string().url("STELLAR_HORIZON_URL must be a valid URL"),
      networkPassphrase: z.string().min(1),
      htlc: z.string().nullable().default(null),
      resolverRegistry: z.string().nullable().default(null),
      resolverSecret: z.string().nullable().default(null),
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
    // Running mode requires a private key.
    if (!cfg.ethereum.resolverPrivateKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ethereum", "resolverPrivateKey"],
        message:
          "RESOLVER_ETH_PRIVATE_KEY is required. " +
          "The resolver must be able to sign claim/refund transactions.",
      });
    }
  });

export type ResolverConfig = z.infer<typeof resolverConfigSchema>;
// Re-export sub-shapes for callers that type-annotate them.
export type EthereumConfig = ResolverConfig["ethereum"];
export type SorobanConfig = ResolverConfig["soroban"];

function optionalAddress(name: string): string | null {
  const v = process.env[name];
  if (!v) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`${name} is not a 0x-prefixed 20-byte address`);
  }
  return v;
}

export function loadConfig(): ResolverConfig {
  const network = (process.env.NETWORK_MODE ?? "testnet") as Network;
  const isMainnet = network === "mainnet";

  const raw = {
    network,
    mainnetAuditConfirmed: process.env.MAINNET_AUDIT_CONFIRMED === "true",
    pollIntervalMs: process.env.RESOLVER_POLL_INTERVAL_MS,
    coordinatorUrl: process.env.COORDINATOR_URL,
    logLevel: process.env.LOG_LEVEL,
    ethereum: {
      rpcUrl: resolveEthereumRpcUrl(isMainnet ? "mainnet" : "testnet"),
      chainId: isMainnet ? 1 : 11_155_111,
      htlcEscrow:
        optionalAddress(isMainnet ? "ETH_HTLC_ESCROW_MAINNET" : "ETH_HTLC_ESCROW_TESTNET"),
      resolverRegistry: optionalAddress(
        isMainnet ? "ETH_RESOLVER_REGISTRY_MAINNET" : "ETH_RESOLVER_REGISTRY_TESTNET"
      ),
      resolverPrivateKey: process.env.RESOLVER_ETH_PRIVATE_KEY ?? null,
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
      resolverSecret: process.env.RESOLVER_STELLAR_SECRET ?? null,
    },
  };

  const result = resolverConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `  [${i.path.join(".")}] ${i.message}`)
      .join("\n");
    throw new Error(`Resolver configuration invalid:\n${messages}`);
  }
  return result.data;
}

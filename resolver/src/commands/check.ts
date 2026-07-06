import { createPublicClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet } from "viem/chains";
import { rpc, Contract, Keypair, TransactionBuilder, Networks, nativeToScVal } from "@stellar/stellar-sdk";
import { loadConfig, type ResolverConfig } from "../config.js";
import { getLogger } from "../logger.js";

const REGISTRY_ABI = parseAbi([
  "function isActive(address resolver) view returns (bool)"
]);

export type CheckResult = {
  chain: string;
  configured: boolean;
  active: boolean | "unknown";
  reason?: string;
};

export type JsonNetworkResult = {
  chain: string;
  configured: boolean;
  rpcReachable: boolean;
  registryConfigured: boolean;
  resolverAddress: string | null;
  active: boolean | "unknown";
  warnings: string[];
};

export type JsonCheckOutput = {
  generatedAt: string;
  networks: JsonNetworkResult[];
  warnings: string[];
  status: "healthy" | "degraded" | "error";
};

export async function checkPreflight(): Promise<CheckResult[]> {
  const cfg = loadConfig();
  const results: CheckResult[] = [];

  // 1. Check EVM
  if (!cfg.ethereum.resolverRegistry || !cfg.ethereum.resolverPrivateKey) {
    results.push({
      chain: "ethereum",
      configured: false,
      active: "unknown",
      reason: "Missing ETH_RESOLVER_REGISTRY or RESOLVER_ETH_PRIVATE_KEY"
    });
  } else {
    try {
      const account = privateKeyToAccount(cfg.ethereum.resolverPrivateKey);
      const chain = cfg.ethereum.chainId === 1 ? mainnet : sepolia;
      const client = createPublicClient({ chain, transport: http(cfg.ethereum.rpcUrl) });

      const active = await client.readContract({
        address: cfg.ethereum.resolverRegistry as Address,
        abi: REGISTRY_ABI,
        functionName: "isActive",
        args: [account.address]
      });
      results.push({ chain: "ethereum", configured: true, active: Boolean(active) });
    } catch (err: any) {
      results.push({
        chain: "ethereum",
        configured: true,
        active: "unknown",
        reason: `RPC error: ${err.message || String(err)}`
      });
    }
  }

  // 2. Check Soroban
  if (!cfg.soroban.resolverRegistry || !cfg.soroban.resolverSecret) {
    results.push({
      chain: "soroban",
      configured: false,
      active: "unknown",
      reason: "Missing SOROBAN_RESOLVER_REGISTRY or RESOLVER_STELLAR_SECRET"
    });
  } else {
    try {
      const kp = Keypair.fromSecret(cfg.soroban.resolverSecret);
      const server = new rpc.Server(cfg.soroban.rpcUrl, { allowHttp: cfg.soroban.rpcUrl.startsWith("http://") });
      const contract = new Contract(cfg.soroban.resolverRegistry);

      // Build a simple read transaction
      const source = await server.getAccount(kp.publicKey());
      const tx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase: cfg.soroban.networkPassphrase
      })
        .addOperation(contract.call("is_active", nativeToScVal(kp.publicKey(), { type: "address" })))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) {
        throw new Error(sim.error);
      }

      let activeStatus: boolean | "unknown" = "unknown";
      if (sim.result?.retval) {
        // Simple boolean decoding from XDR (scvBool)
        activeStatus = sim.result.retval.switch().name === "scvBool" ? sim.result.retval.b() : "unknown";
      }

      results.push({ chain: "soroban", configured: true, active: activeStatus });
    } catch (err: any) {
      results.push({
        chain: "soroban",
        configured: true,
        active: "unknown",
        reason: `RPC or simulate error: ${err.message || String(err)}`
      });
    }
  }

  return results;
}

function deriveResolverAddress(config: ResolverConfig): { ethereum: string | null; soroban: string | null } {
  let ethAddr: string | null = null;
  let sorobanAddr: string | null = null;

  if (config.ethereum.resolverPrivateKey) {
    try {
      const account = privateKeyToAccount(config.ethereum.resolverPrivateKey);
      ethAddr = account.address;
    } catch {
      // Cannot derive address; skip
    }
  }

  if (config.soroban.resolverSecret) {
    try {
      const kp = Keypair.fromSecret(config.soroban.resolverSecret);
      sorobanAddr = kp.publicKey();
    } catch {
      // Cannot derive address; skip
    }
  }

  return { ethereum: ethAddr, soroban: sorobanAddr };
}

export function buildJsonOutput(results: CheckResult[], config: ResolverConfig): JsonCheckOutput {
  const addresses = deriveResolverAddress(config);
  const globalWarnings: string[] = [];
  const networks: JsonNetworkResult[] = [];

  for (const r of results) {
    const networkWarnings: string[] = [];

    if (!r.configured) {
      networkWarnings.push(r.reason || "Not configured");
    } else if (r.active === "unknown") {
      if (r.reason) networkWarnings.push(r.reason);
    } else if (r.active === false) {
      networkWarnings.push("Resolver is not active. May need to stake/register.");
    }

    globalWarnings.push(...networkWarnings);

    const addr = r.chain === "ethereum" ? addresses.ethereum : addresses.soroban;

    networks.push({
      chain: r.chain,
      configured: r.configured,
      rpcReachable: r.configured && r.active !== "unknown",
      registryConfigured: r.configured,
      resolverAddress: addr,
      active: r.active,
      warnings: networkWarnings,
    });
  }

  let status: JsonCheckOutput["status"] = "healthy";
  for (const n of networks) {
    if (!n.configured) { status = "error"; break; }
    if (n.active === false || n.active === "unknown") { status = "degraded"; }
  }

  return {
    generatedAt: new Date().toISOString(),
    networks,
    warnings: globalWarnings,
    status,
  };
}

export async function checkCommand(options?: { json?: boolean }): Promise<void> {
  if (options?.json) {
    await checkCommandJson();
    return;
  }

  const cfg = loadConfig();
  const log = getLogger(cfg.logLevel);
  log.info("Running resolver preflight checks...");
  const results = await checkPreflight();

  for (const r of results) {
    if (!r.configured) {
      log.warn({ chain: r.chain, reason: r.reason }, "Resolver registry not fully configured");
    } else if (r.active === "unknown") {
      log.warn({ chain: r.chain, reason: r.reason }, "Could not determine active status");
    } else if (r.active === false) {
      log.warn({ chain: r.chain }, "Resolver is NOT ACTIVE. You may need to stake/register.");
    } else {
      log.info({ chain: r.chain }, "Resolver is ACTIVE.");
    }
  }
}

async function checkCommandJson(): Promise<void> {
  try {
    const cfg = loadConfig();
    const results = await checkPreflight();
    const output = buildJsonOutput(results, cfg);
    console.log(JSON.stringify(output, null, 2));
    process.exit(output.status === "healthy" ? 0 : output.status === "degraded" ? 1 : 2);
  } catch (err: any) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      networks: [],
      warnings: [`Fatal error: ${err.message || String(err)}`],
      status: "error",
    }, null, 2));
    process.exit(2);
  }
}

import { createPublicClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet } from "viem/chains";
import { rpc, Contract, Keypair, TransactionBuilder, Networks, nativeToScVal } from "@stellar/stellar-sdk";
import { loadConfig } from "../config.js";
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

export async function checkCommand(): Promise<void> {
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

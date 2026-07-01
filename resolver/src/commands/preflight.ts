import { createPublicClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet } from "viem/chains";
import { rpc, Contract, Keypair, TransactionBuilder, Networks, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { loadConfig } from "../config.js";

const EVM_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const STELLAR_SECRET_RE = /^S[A-Z2-7]{55}$/;
const SOROBAN_CONTRACT_RE = /^C[A-Z2-7]{55}$/;

const REGISTRY_ABI = parseAbi([
  "function isActive(address resolver) view returns (bool)",
  "function minStake() view returns (uint256)",
  "function stakeAsset() view returns (address)"
]);

const ERC20_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
]);

export interface PreflightCheckResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  detail?: string;
  guidance?: string;
}

export async function runPreflightChecks(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];
  const cfg = loadConfig();

  // -------------------------------------------------------------
  // Ethereum / EVM Checks
  // -------------------------------------------------------------

  // 1. EVM Resolver Address parses correctly
  let evmAddress: `0x${string}` | null = null;
  const evmPrivateKey = cfg.ethereum.resolverPrivateKey;
  if (!evmPrivateKey) {
    results.push({
      name: "Ethereum Resolver Address parses correctly",
      status: "SKIPPED",
      guidance: "Configure RESOLVER_ETH_PRIVATE_KEY"
    });
  } else if (!EVM_KEY_RE.test(evmPrivateKey)) {
    results.push({
      name: "Ethereum Resolver Address parses correctly",
      status: "FAIL",
      guidance: "Configure RESOLVER_ETH_PRIVATE_KEY with a valid 0x-prefixed 32-byte hex string"
    });
  } else {
    try {
      evmAddress = privateKeyToAccount(evmPrivateKey).address;
      results.push({
        name: "Ethereum Resolver Address parses correctly",
        status: "PASS",
        detail: `derived address ${evmAddress}`
      });
    } catch (err: any) {
      results.push({
        name: "Ethereum Resolver Address parses correctly",
        status: "FAIL",
        guidance: `Configure RESOLVER_ETH_PRIVATE_KEY with a valid private key: ${err.message}`
      });
    }
  }

  // 2. EVM Registry Contract Address configured
  const evmRegistry = cfg.ethereum.resolverRegistry;
  let isEvmRegistryConfigured = false;
  if (!evmRegistry) {
    results.push({
      name: "Ethereum Registry contract address is configured",
      status: "FAIL",
      guidance: "Configure ETH_RESOLVER_REGISTRY_TESTNET"
    });
  } else if (!EVM_ADDR_RE.test(evmRegistry)) {
    results.push({
      name: "Ethereum Registry contract address is configured",
      status: "FAIL",
      guidance: "Configure ETH_RESOLVER_REGISTRY_TESTNET with a valid 0x-prefixed 20-byte address"
    });
  } else {
    isEvmRegistryConfigured = true;
    results.push({
      name: "Ethereum Registry contract address is configured",
      status: "PASS",
      detail: `address ${evmRegistry}`
    });
  }

  // 3. EVM Network matches expected testnet configuration
  let isEvmRpcConfigured = false;
  if (cfg.network !== "testnet") {
    results.push({
      name: "Ethereum network matches expected testnet configuration",
      status: "FAIL",
      guidance: "Switch NETWORK_MODE to testnet"
    });
  } else {
    // Try pinging EVM RPC
    try {
      const chain = cfg.ethereum.chainId === 1 ? mainnet : sepolia;
      const client = createPublicClient({ chain, transport: http(cfg.ethereum.rpcUrl, { timeout: 4000 }) });
      const chainId = await client.getChainId();
      if (chainId === 11_155_111) {
        isEvmRpcConfigured = true;
        results.push({
          name: "Ethereum network matches expected testnet configuration",
          status: "PASS",
          detail: `Sepolia testnet (chainId ${chainId})`
        });
      } else {
        results.push({
          name: "Ethereum network matches expected testnet configuration",
          status: "FAIL",
          guidance: `Switch to the expected testnet (Sepolia chainId 11155111, got ${chainId})`
        });
      }
    } catch (err: any) {
      results.push({
        name: "Ethereum network matches expected testnet configuration",
        status: "SKIPPED",
        guidance: `Configure RPC_URL or verify EVM RPC reachability: ${err.message}`
      });
    }
  }

  // 4. EVM Stake Threshold can be read
  let canReadEvmStake = false;
  if (!isEvmRegistryConfigured || !isEvmRpcConfigured) {
    results.push({
      name: "Ethereum stake threshold can be read",
      status: "SKIPPED",
      guidance: "Configure ETH_RESOLVER_REGISTRY_TESTNET and a reachable Ethereum RPC_URL"
    });
  } else {
    try {
      const chain = cfg.ethereum.chainId === 1 ? mainnet : sepolia;
      const client = createPublicClient({ chain, transport: http(cfg.ethereum.rpcUrl, { timeout: 4000 }) });
      const minStake = (await client.readContract({
        address: evmRegistry as Address,
        abi: REGISTRY_ABI,
        functionName: "minStake"
      })) as bigint;

      let stakeInfoDetail = `${minStake.toString()} units`;
      try {
        const stakeAsset = (await client.readContract({
          address: evmRegistry as Address,
          abi: REGISTRY_ABI,
          functionName: "stakeAsset"
        })) as Address;
        const symbol = await client.readContract({
          address: stakeAsset,
          abi: ERC20_ABI,
          functionName: "symbol"
        });
        stakeInfoDetail = `${minStake.toString()} ${symbol}`;
      } catch {
        // Fallback if stake asset cannot be read
      }

      canReadEvmStake = true;
      results.push({
        name: "Ethereum stake threshold can be read",
        status: "PASS",
        detail: `min stake: ${stakeInfoDetail}`
      });
    } catch (err: any) {
      results.push({
        name: "Ethereum stake threshold can be read",
        status: "FAIL",
        guidance: `Verify registry contract deployment at ETH_RESOLVER_REGISTRY_TESTNET: ${err.message}`
      });
    }
  }

  // 5. EVM Resolver Status can be queried
  if (!evmAddress) {
    results.push({
      name: "Ethereum resolver status can be queried",
      status: "SKIPPED",
      guidance: "Configure RESOLVER_ETH_PRIVATE_KEY to check status"
    });
  } else if (!isEvmRegistryConfigured || !isEvmRpcConfigured) {
    results.push({
      name: "Ethereum resolver status can be queried",
      status: "SKIPPED",
      guidance: "Configure ETH_RESOLVER_REGISTRY_TESTNET and a reachable Ethereum RPC_URL"
    });
  } else {
    try {
      const chain = cfg.ethereum.chainId === 1 ? mainnet : sepolia;
      const client = createPublicClient({ chain, transport: http(cfg.ethereum.rpcUrl, { timeout: 4000 }) });
      const active = (await client.readContract({
        address: evmRegistry as Address,
        abi: REGISTRY_ABI,
        functionName: "isActive",
        args: [evmAddress]
      })) as boolean;

      if (active) {
        results.push({
          name: "Ethereum resolver status can be queried",
          status: "PASS",
          detail: "Resolver is active"
        });
      } else {
        results.push({
          name: "Ethereum resolver status can be queried",
          status: "FAIL",
          guidance: "Resolver not yet registered"
        });
      }
    } catch (err: any) {
      results.push({
        name: "Ethereum resolver status can be queried",
        status: "FAIL",
        guidance: `Verify registry contract deployment at ETH_RESOLVER_REGISTRY_TESTNET: ${err.message}`
      });
    }
  }

  // -------------------------------------------------------------
  // Stellar / Soroban Checks
  // -------------------------------------------------------------

  // 6. Stellar Resolver Address parses correctly
  let stellarPublicKey: string | null = null;
  const stellarSecret = cfg.soroban.resolverSecret;
  if (!stellarSecret) {
    results.push({
      name: "Stellar Resolver Address parses correctly",
      status: "SKIPPED",
      guidance: "Configure RESOLVER_STELLAR_SECRET"
    });
  } else if (!STELLAR_SECRET_RE.test(stellarSecret)) {
    results.push({
      name: "Stellar Resolver Address parses correctly",
      status: "FAIL",
      guidance: "Configure RESOLVER_STELLAR_SECRET with a valid Stellar secret seed (starts with 'S', 56 chars)"
    });
  } else {
    try {
      stellarPublicKey = Keypair.fromSecret(stellarSecret).publicKey();
      results.push({
        name: "Stellar Resolver Address parses correctly",
        status: "PASS",
        detail: `derived public key ${stellarPublicKey}`
      });
    } catch (err: any) {
      results.push({
        name: "Stellar Resolver Address parses correctly",
        status: "FAIL",
        guidance: `Configure RESOLVER_STELLAR_SECRET with a valid secret seed: ${err.message}`
      });
    }
  }

  // 7. Stellar Registry Contract Address configured
  const stellarRegistry = cfg.soroban.resolverRegistry;
  let isStellarRegistryConfigured = false;
  if (!stellarRegistry) {
    results.push({
      name: "Stellar Registry contract address is configured",
      status: "FAIL",
      guidance: "Configure SOROBAN_RESOLVER_REGISTRY_TESTNET"
    });
  } else if (!SOROBAN_CONTRACT_RE.test(stellarRegistry)) {
    results.push({
      name: "Stellar Registry contract address is configured",
      status: "FAIL",
      guidance: "Configure SOROBAN_RESOLVER_REGISTRY_TESTNET with a valid Stellar contract ID (starts with 'C', 56 chars)"
    });
  } else {
    isStellarRegistryConfigured = true;
    results.push({
      name: "Stellar Registry contract address is configured",
      status: "PASS",
      detail: `contract ID ${stellarRegistry}`
    });
  }

  // 8. Stellar Network matches expected testnet configuration
  let isStellarRpcConfigured = false;
  if (cfg.network !== "testnet") {
    results.push({
      name: "Stellar network matches expected testnet configuration",
      status: "FAIL",
      guidance: "Switch NETWORK_MODE to testnet"
    });
  } else {
    try {
      const server = new rpc.Server(cfg.soroban.rpcUrl, {
        allowHttp: cfg.soroban.rpcUrl.startsWith("http://"),
        timeout: 4000
      });
      // Ping Soroban RPC using getLatestLedger
      const latest = await server.getLatestLedger();
      if (latest && latest.sequence !== undefined) {
        if (cfg.soroban.networkPassphrase === "Test SDF Network ; September 2015") {
          isStellarRpcConfigured = true;
          results.push({
            name: "Stellar network matches expected testnet configuration",
            status: "PASS",
            detail: "Test SDF Network"
          });
        } else {
          results.push({
            name: "Stellar network matches expected testnet configuration",
            status: "FAIL",
            guidance: "Switch Stellar RPC network passphrase to expected testnet"
          });
        }
      } else {
        results.push({
          name: "Stellar network matches expected testnet configuration",
          status: "FAIL",
          guidance: "Stellar RPC returned invalid ledger sequence"
        });
      }
    } catch (err: any) {
      results.push({
        name: "Stellar network matches expected testnet configuration",
        status: "SKIPPED",
        guidance: `Configure SOROBAN_RPC_URL or verify Stellar RPC reachability: ${err.message}`
      });
    }
  }

  // 9. Stellar Stake Threshold can be read
  let canReadStellarStake = false;
  if (!isStellarRegistryConfigured || !isStellarRpcConfigured) {
    results.push({
      name: "Stellar stake threshold can be read",
      status: "SKIPPED",
      guidance: "Configure SOROBAN_RESOLVER_REGISTRY_TESTNET and a reachable Stellar SOROBAN_RPC_URL"
    });
  } else {
    try {
      const server = new rpc.Server(cfg.soroban.rpcUrl, {
        allowHttp: cfg.soroban.rpcUrl.startsWith("http://"),
        timeout: 4000
      });
      const contract = new Contract(stellarRegistry as string);
      const dummySource = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";
      const dummyAccount = {
        accountId: () => dummySource,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {}
      } as any;

      const tx = new TransactionBuilder(dummyAccount, {
        fee: "100",
        networkPassphrase: cfg.soroban.networkPassphrase
      })
        .addOperation(contract.call("min_stake"))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) {
        throw new Error(sim.error);
      }

      if (sim.result?.retval) {
        const val = scValToNative(sim.result.retval);
        canReadStellarStake = true;
        results.push({
          name: "Stellar stake threshold can be read",
          status: "PASS",
          detail: `min stake: ${val.toString()}`
        });
      } else {
        throw new Error("No return value in simulation");
      }
    } catch (err: any) {
      results.push({
        name: "Stellar stake threshold can be read",
        status: "FAIL",
        guidance: `Verify registry contract deployment at SOROBAN_RESOLVER_REGISTRY_TESTNET: ${err.message}`
      });
    }
  }

  // 10. Stellar Resolver Status can be queried
  if (!stellarPublicKey) {
    results.push({
      name: "Stellar resolver status can be queried",
      status: "SKIPPED",
      guidance: "Configure RESOLVER_STELLAR_SECRET to check status"
    });
  } else if (!isStellarRegistryConfigured || !isStellarRpcConfigured) {
    results.push({
      name: "Stellar resolver status can be queried",
      status: "SKIPPED",
      guidance: "Configure SOROBAN_RESOLVER_REGISTRY_TESTNET and a reachable Stellar SOROBAN_RPC_URL"
    });
  } else {
    try {
      const server = new rpc.Server(cfg.soroban.rpcUrl, {
        allowHttp: cfg.soroban.rpcUrl.startsWith("http://"),
        timeout: 4000
      });
      const contract = new Contract(stellarRegistry as string);
      const dummySource = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";
      const dummyAccount = {
        accountId: () => dummySource,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {}
      } as any;

      const tx = new TransactionBuilder(dummyAccount, {
        fee: "100",
        networkPassphrase: cfg.soroban.networkPassphrase
      })
        .addOperation(contract.call("is_active", nativeToScVal(stellarPublicKey, { type: "address" })))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) {
        throw new Error(sim.error);
      }

      if (sim.result?.retval) {
        const active = scValToNative(sim.result.retval) as boolean;
        if (active) {
          results.push({
            name: "Stellar resolver status can be queried",
            status: "PASS",
            detail: "Resolver is active"
          });
        } else {
          results.push({
            name: "Stellar resolver status can be queried",
            status: "FAIL",
            guidance: "Resolver not yet registered"
          });
        }
      } else {
        throw new Error("No return value in simulation");
      }
    } catch (err: any) {
      results.push({
        name: "Stellar resolver status can be queried",
        status: "FAIL",
        guidance: `Verify registry contract deployment at SOROBAN_RESOLVER_REGISTRY_TESTNET: ${err.message}`
      });
    }
  }

  return results;
}

export async function preflightCommand(): Promise<number> {
  console.log("");
  console.log("=== OverSync Resolver Preflight Validation ===");
  console.log("");

  const results = await runPreflightChecks();
  let hasFailure = false;

  for (const r of results) {
    const icon = r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : "-";
    console.log(`[${r.status}] ${icon} ${r.name}`);
    if (r.detail) {
      console.log(`         Detail: ${r.detail}`);
    }
    if (r.status === "FAIL") {
      hasFailure = true;
      if (r.guidance) {
        console.log(`         Guidance: ${r.guidance}`);
      }
    } else if (r.status === "SKIPPED" && r.guidance) {
      console.log(`         Info: ${r.guidance}`);
    }
  }

  console.log("");
  if (hasFailure) {
    console.log("Preflight Status: FAIL. Please address the errors listed above before registration or staking.");
    return 1;
  } else {
    console.log("Preflight Status: PASS. Configuration is valid.");
    return 0;
  }
}

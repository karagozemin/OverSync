import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  parseUnits,
  getAddress,
  type Address
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet } from "viem/chains";
import {
  rpc,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  type SorobanRpc,
} from "@stellar/stellar-sdk";
import { loadConfig } from "../config.js";
import { getLogger } from "../logger.js";
import { checkResolverNetworkAgreement } from "../network-agreement.js";
import { createJsonRpcFetch, createSorobanRpcServer } from "@oversync/sdk";

// ---------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------

const REGISTRY_ABI = parseAbi([
  "function register(uint256 stake)",
  "function increaseStake(uint256 additional)",
  "function unregister()",
  "function isActive(address resolver) view returns (bool)",
  "function get(address resolver) view returns ((address resolver,uint256 stake,uint64 registeredAt,uint64 lastSlashAt,uint256 totalSlashed,bool active))",
  "function minStake() view returns (uint256)",
  "function stakeAsset() view returns (address)"
]);

const ESCROW_ABI = parseAbi([
  "function resolverRegistry() view returns (address)"
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
]);

// ---------------------------------------------------------------
// Options
// ---------------------------------------------------------------

export interface RegisterOptions {
  /** Print the plan to stdout but do NOT submit any transactions. */
  dryRun?: boolean;
  /** Override the amount to stake (default: on-chain minStake). */
  amount?: string;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/** Normalise an Ethereum address string to a checksummed form so that
 *  comparisons work regardless of casing differences. */
function normaliseEthAddress(addr: string): string {
  return getAddress(addr);
}

// ---------------------------------------------------------------
// EVM side
// ---------------------------------------------------------------

/**
 * Validate the EVM side:
 *  1. If `cfg.ethereum.htlcEscrow` is configured, read its
 *     `resolverRegistry()` pointer and compare to `cfg.ethereum.resolverRegistry`.
 *     Throw if they disagree.
 *  2. Return whether the resolver is already active in the EVM registry.
 */
async function validateEvmRegistry(
  publicClient: ReturnType<typeof createPublicClient>,
  cfg: ReturnType<typeof loadConfig>,
  resolverAddress: Address,
  log: ReturnType<typeof import("../logger.js").getLogger>
): Promise<{ alreadyActive: boolean }> {
  const configRegistry = cfg.ethereum.resolverRegistry as Address;

  // Check that the HTLCEscrow's registry pointer matches config if escrow is configured
  if (cfg.ethereum.htlcEscrow) {
    log.debug({ escrow: cfg.ethereum.htlcEscrow }, "reading EVM HTLCEscrow.resolverRegistry() for validation");
    const onChainRegistry = (await publicClient.readContract({
      address: cfg.ethereum.htlcEscrow as Address,
      abi: ESCROW_ABI,
      functionName: "resolverRegistry"
    })) as Address;

    const normalizedOnChain = normaliseEthAddress(onChainRegistry);
    const normalizedConfig = normaliseEthAddress(configRegistry);

    if (normalizedOnChain !== normalizedConfig) {
      throw new Error(
        `EVM address mismatch: HTLCEscrow.resolverRegistry() is ${normalizedOnChain} ` +
        `but config has ${normalizedConfig}. ` +
        `Update ETH_RESOLVER_REGISTRY_TESTNET / ETH_RESOLVER_REGISTRY_MAINNET to match the deployed escrow.`
      );
    }
    log.debug({ onChainRegistry: normalizedOnChain }, "EVM registry address validated against escrow");
  }

  // Check if the resolver is already active
  const alreadyActive = (await publicClient.readContract({
    address: configRegistry,
    abi: REGISTRY_ABI,
    functionName: "isActive",
    args: [resolverAddress]
  })) as boolean;

  return { alreadyActive };
}

/**
 * Perform the EVM registration: approve the stake asset, then call
 * `register(stake)` on the EVM ResolverRegistry.
 */
async function registerEvm(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  cfg: ReturnType<typeof loadConfig>,
  resolverAddress: Address,
  amountInput: string | undefined,
  log: ReturnType<typeof import("../logger.js").getLogger>
): Promise<void> {
  const registry = cfg.ethereum.resolverRegistry as Address;

  const stakeAsset = (await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "stakeAsset"
  })) as Address;

  const [decimals, symbol, minStake] = await Promise.all([
    publicClient.readContract({ address: stakeAsset, abi: ERC20_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: stakeAsset, abi: ERC20_ABI, functionName: "symbol" }),
    publicClient.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "minStake" })
  ]);

  const stake = amountInput
    ? parseUnits(amountInput, decimals as number)
    : (minStake as bigint);

  if (stake < (minStake as bigint)) {
    throw new Error(`Stake ${stake} is below EVM minimum ${minStake}`);
  }

  log.info({ stakeAsset, symbol, stake: stake.toString() }, "EVM: approving stake transfer");
  const approveTx = await (walletClient as any).writeContract({
    address: stakeAsset,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [registry, stake]
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  log.info({ stake: stake.toString() }, "EVM: calling registry.register");
  const tx = await (walletClient as any).writeContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "register",
    args: [stake]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  log.info({ tx, gasUsed: receipt.gasUsed.toString() }, "EVM: registered as resolver");
  log.info(`EVM: Resolver ${resolverAddress} is now registered with ${stake} ${symbol}.`);
}

// ---------------------------------------------------------------
// Soroban side
// ---------------------------------------------------------------

/**
 * Check whether the resolver is already active in the Soroban registry.
 * Returns `{ alreadyActive: boolean }`.
 */
async function validateSorobanRegistry(
  cfg: ReturnType<typeof loadConfig>,
  resolverPublicKey: string,
  log: ReturnType<typeof import("../logger.js").getLogger>
): Promise<{ alreadyActive: boolean }> {
  if (!cfg.soroban.resolverRegistry) {
    throw new Error("SOROBAN_RESOLVER_REGISTRY is not configured");
  }
  if (!cfg.soroban.resolverSecret) {
    throw new Error("RESOLVER_STELLAR_SECRET env var is required for Soroban registry actions");
  }

  const server = createSorobanRpcServer(cfg.soroban.rpcUrl, {
    allowHttp: cfg.soroban.rpcUrl.startsWith("http://")
  });
  const contract = new Contract(cfg.soroban.resolverRegistry);
  const source = await server.getAccount(resolverPublicKey);

  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: cfg.soroban.networkPassphrase
  })
    .addOperation(
      contract.call("is_active", nativeToScVal(resolverPublicKey, { type: "address" }))
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Soroban is_active simulation failed: ${(sim as any).error}`);
  }

  let alreadyActive = false;
  const retval = (sim as SorobanRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  if (retval && retval.switch().name === "scvBool") {
    alreadyActive = retval.b();
  }

  log.debug({ resolverPublicKey, alreadyActive }, "Soroban registry active status");
  return { alreadyActive };
}

/**
 * Perform the Soroban registration by calling `register(resolver, stake)`
 * on the Soroban ResolverRegistry contract.
 */
async function registerSoroban(
  cfg: ReturnType<typeof loadConfig>,
  resolverPublicKey: string,
  stakeAmount: string,
  log: ReturnType<typeof import("../logger.js").getLogger>
): Promise<void> {
  if (!cfg.soroban.resolverRegistry) {
    throw new Error("SOROBAN_RESOLVER_REGISTRY is not configured");
  }
  if (!cfg.soroban.resolverSecret) {
    throw new Error("RESOLVER_STELLAR_SECRET env var is required for Soroban registry actions");
  }

  const kp = Keypair.fromSecret(cfg.soroban.resolverSecret);
  const server = createSorobanRpcServer(cfg.soroban.rpcUrl, {
    allowHttp: cfg.soroban.rpcUrl.startsWith("http://")
  });
  const contract = new Contract(cfg.soroban.resolverRegistry);
  const source = await server.getAccount(kp.publicKey());

  // stake is expressed as i128 strops (base units)
  const stakeI128 = BigInt(stakeAmount);
  const stakeTx = new TransactionBuilder(source, {
    fee: "1000000",
    networkPassphrase: cfg.soroban.networkPassphrase
  })
    .addOperation(
      contract.call(
        "register",
        nativeToScVal(kp.publicKey(), { type: "address" }),
        nativeToScVal(stakeI128, { type: "i128" })
      )
    )
    .setTimeout(60)
    .build();

  const simResult = await server.simulateTransaction(stakeTx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Soroban register simulation failed: ${(simResult as any).error}`);
  }

  const preparedTx = rpc.assembleTransaction(stakeTx, simResult).build();
  preparedTx.sign(kp);

  const sendResult = await server.sendTransaction(preparedTx);
  if (sendResult.status === "ERROR") {
    throw new Error(`Soroban register transaction failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // Poll for confirmation
  let finalStatus = sendResult.status;
  const txHash = sendResult.hash;
  log.info({ txHash }, "Soroban: register transaction submitted, polling for confirmation");

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollResult = await server.getTransaction(txHash);
    if (pollResult.status === "SUCCESS") {
      finalStatus = "SUCCESS";
      log.info({ txHash }, "Soroban: resolver registered successfully");
      break;
    }
    if (pollResult.status === "FAILED") {
      throw new Error(`Soroban register transaction failed on-chain: ${JSON.stringify(pollResult)}`);
    }
    // NOT_FOUND means still pending — keep polling
  }

  if (finalStatus !== "SUCCESS") {
    throw new Error(`Soroban register transaction did not confirm after 60s (hash: ${txHash})`);
  }

  log.info(`Soroban: Resolver ${resolverPublicKey} is now registered.`);
}

// ---------------------------------------------------------------
// Public commands
// ---------------------------------------------------------------

/**
 * Register this resolver on both chains.
 *
 * Algorithm:
 *  1. Read both registries.
 *  2. If `htlcEscrow` is configured on EVM, validate the escrow's
 *     `resolverRegistry()` pointer matches config. Fail hard on mismatch.
 *  3. Skip a chain if the resolver is already active there.
 *  4. Register only the chain(s) that are missing.
 *  5. In dry-run mode, print the plan and do nothing.
 */
export async function registerCommand(
  amountInput?: string,
  opts: RegisterOptions = {}
): Promise<void> {
  const dryRun = opts.dryRun ?? false;
  const cfg = loadConfig();
  const log = getLogger(cfg.logLevel);

  // ---------------------------------------------------------------
  // 1. Build EVM context
  // ---------------------------------------------------------------

  if (!cfg.ethereum.resolverRegistry) {
    throw new Error("ETH_RESOLVER_REGISTRY contract address is not configured");
  }
  if (!cfg.ethereum.resolverPrivateKey) {
    throw new Error("RESOLVER_ETH_PRIVATE_KEY env var is required for registry actions");
  }

  const chain = cfg.ethereum.chainId === 1 ? mainnet : sepolia;
  const account = privateKeyToAccount(cfg.ethereum.resolverPrivateKey);
  const publicClient = createPublicClient({
    chain,
    transport: http(cfg.ethereum.rpcUrl, { fetchFn: createJsonRpcFetch() })
  });
  const walletClient = createWalletClient({
    chain,
    account,
    transport: http(cfg.ethereum.rpcUrl, { fetchFn: createJsonRpcFetch() })
  });

  // ---------------------------------------------------------------
  // 2. Validate EVM registry address against the deployed escrow
  // ---------------------------------------------------------------

  log.info("Validating EVM registry configuration against on-chain state...");
  const { alreadyActive: evmAlreadyActive } = await validateEvmRegistry(
    publicClient,
    cfg,
    account.address,
    log
  );

  // ---------------------------------------------------------------
  // 3. Validate Soroban registry (if configured)
  // ---------------------------------------------------------------

  let sorobanPublicKey: string | null = null;
  let sorobanAlreadyActive: boolean | null = null;

  const hasSoroban =
    Boolean(cfg.soroban.resolverRegistry) && Boolean(cfg.soroban.resolverSecret);

  if (hasSoroban) {
    log.info("Validating Soroban registry configuration against on-chain state...");
    const kp = Keypair.fromSecret(cfg.soroban.resolverSecret!);
    sorobanPublicKey = kp.publicKey();
    const result = await validateSorobanRegistry(cfg, sorobanPublicKey, log);
    sorobanAlreadyActive = result.alreadyActive;
  } else {
    log.warn(
      "Soroban registry is not fully configured (SOROBAN_RESOLVER_REGISTRY or RESOLVER_STELLAR_SECRET missing). " +
      "Skipping Soroban registration."
    );
  }

  // ---------------------------------------------------------------
  // 4. Decide what needs to be done
  // ---------------------------------------------------------------

  const needsEvmRegister = !evmAlreadyActive;
  const needsSorobanRegister = hasSoroban && !sorobanAlreadyActive;

  log.info(
    {
      evmAlreadyActive,
      sorobanAlreadyActive: hasSoroban ? sorobanAlreadyActive : "skipped",
      needsEvmRegister,
      needsSorobanRegister
    },
    "Registration plan"
  );

  // ---------------------------------------------------------------
  // 5. Dry-run: print plan, do nothing
  // ---------------------------------------------------------------

  if (dryRun) {
    const lines: string[] = ["[dry-run] Registration plan:"];
    if (needsEvmRegister) {
      lines.push(`  - EVM (${chain.name}): register resolver ${account.address} on registry ${cfg.ethereum.resolverRegistry}`);
      if (cfg.ethereum.htlcEscrow) {
        lines.push(`    HTLCEscrow.resolverRegistry() matches config ✓`);
      }
    } else {
      lines.push(`  - EVM: already registered and active — skipping`);
    }
    if (hasSoroban) {
      if (needsSorobanRegister) {
        lines.push(`  - Soroban: register resolver ${sorobanPublicKey} on registry ${cfg.soroban.resolverRegistry}`);
      } else {
        lines.push(`  - Soroban: already registered and active — skipping`);
      }
    } else {
      lines.push(`  - Soroban: not configured — skipping`);
    }
    lines.push("[dry-run] No transactions submitted.");
    log.info(lines.join("\n"));
    return;
  }

  // ---------------------------------------------------------------
  // 6. Nothing to do?
  // ---------------------------------------------------------------

  if (!needsEvmRegister && !needsSorobanRegister) {
    log.info("Resolver is already registered and active on both chains. Nothing to do.");
    return;
  }

  // ---------------------------------------------------------------
  // 7. Register each chain that needs it
  // ---------------------------------------------------------------

  if (needsEvmRegister) {
    await registerEvm(publicClient, walletClient, cfg, account.address, amountInput, log);
  } else {
    log.info("EVM: resolver is already registered and active — skipping EVM registration");
  }

  if (needsSorobanRegister && sorobanPublicKey !== null) {
    // Derive a default stake: use "0" which the contract interprets as
    // minStake if provided. Caller can pass an explicit amount.
    // For Soroban the stake is in base token units (i128 strops).
    const sorobanStake = amountInput ?? "0";
    await registerSoroban(cfg, sorobanPublicKey, sorobanStake, log);
  } else if (hasSoroban && !needsSorobanRegister) {
    log.info("Soroban: resolver is already registered and active — skipping Soroban registration");
  }
}

// ---------------------------------------------------------------
// Other commands (unchanged from before)
// ---------------------------------------------------------------

function ensureEvmContext() {
  const cfg = loadConfig();
  const log = getLogger(cfg.logLevel);

  if (!cfg.ethereum.resolverRegistry) {
    throw new Error("ETH_RESOLVER_REGISTRY contract address is not configured");
  }
  if (!cfg.ethereum.resolverPrivateKey) {
    throw new Error("RESOLVER_ETH_PRIVATE_KEY env var is required for registry actions");
  }

  const chain = cfg.ethereum.chainId === 1 ? mainnet : sepolia;
  const account = privateKeyToAccount(cfg.ethereum.resolverPrivateKey);
  const publicClient = createPublicClient({
    chain,
    transport: http(cfg.ethereum.rpcUrl, { fetchFn: createJsonRpcFetch() })
  });
  const walletClient = createWalletClient({
    chain,
    account,
    transport: http(cfg.ethereum.rpcUrl, { fetchFn: createJsonRpcFetch() })
  });

  return { cfg, log, account, publicClient, walletClient };
}

export async function registerCommand(amountInput?: string): Promise<void> {
  const cfg = loadConfig();
  
  // Check network agreement before any transaction
  const agreement = await checkResolverNetworkAgreement(
    cfg.network,
    cfg.ethereum.rpcUrl,
    cfg.soroban.rpcUrl,
    cfg.soroban.networkPassphrase
  );
  if (agreement.status === "fail") {
    throw new Error(`Network agreement failed: ${agreement.detail}. Observed: EVM=${agreement.observed.evm.rpcUrl} (chainId=${agreement.observed.evm.chainId}), Soroban=${agreement.observed.soroban.rpcUrl} (passphrase=${agreement.observed.soroban.networkPassphrase})`);
  }

  const { cfg: config, log, account, publicClient, walletClient } = ensureEvmContext();
  const registry = config.ethereum.resolverRegistry as Address;

  const stakeAsset = (await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "stakeAsset"
  })) as Address;
  const decimals = await publicClient.readContract({
    address: stakeAsset,
    abi: ERC20_ABI,
    functionName: "decimals"
  });
  const symbol = await publicClient.readContract({
    address: stakeAsset,
    abi: ERC20_ABI,
    functionName: "symbol"
  });

  const minStake = (await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "minStake"
  })) as bigint;

  const stake = amountInput
    ? parseUnits(amountInput, decimals as number)
    : minStake;

  if (stake < minStake) {
    throw new Error(`Stake ${stake} is below minimum ${minStake}`);
  }

  log.info({ stakeAsset, symbol, stake: stake.toString() }, "approving stake transfer");
  const approveTx = await walletClient.writeContract({
    address: stakeAsset,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [registry, stake]
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  log.info({ stake: stake.toString() }, "calling registry.register");
  const tx = await walletClient.writeContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "register",
    args: [stake]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  log.info({ tx, gasUsed: receipt.gasUsed.toString() }, "registered as resolver");
  log.info(`Resolver ${account.address} is now registered with ${stake} ${symbol}.`);
}

export async function statusCommand(): Promise<void> {
  const { cfg, log, account, publicClient } = ensureEvmContext();
  const registry = cfg.ethereum.resolverRegistry as Address;

  const [info, active, minStake] = await Promise.all([
    publicClient.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "get",
      args: [account.address]
    }),
    publicClient.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "isActive",
      args: [account.address]
    }),
    publicClient.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "minStake"
    })
  ]);
  log.info({ info, active, minStake: (minStake as bigint).toString() }, "resolver status");
}

export async function unregisterCommand(): Promise<void> {
  const { cfg, log, account, publicClient, walletClient } = ensureEvmContext();
  const registry = cfg.ethereum.resolverRegistry as Address;
  const tx = await (walletClient as any).writeContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "unregister"
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  log.info({ tx, resolver: account.address }, "unregistered");
}

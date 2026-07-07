/**
 * Resolver readiness (dry-run) command — pre-flight check for operator onboarding.
 *
 * SECURITY CONTRACT (do not violate):
 *   This module MUST NEVER log the values of:
 *     - process.env.RESOLVER_ETH_PRIVATE_KEY
 *     - process.env.RESOLVER_STELLAR_SECRET
 *     - any other secret / private-key env var
 *   Only derived PUBLIC values (EVM address from private key, Stellar public
 *   key from secret) may appear in output. Tests enforce this.
 *
 * This command performs NO contract writes, NO transaction signing, and moves
 * no funds. It only reads env, calls read-only RPC endpoints (`eth_chainId`,
 * `getLatestLedger`), and derives addresses from private input. It is safe to
 * point at mainnet URLs as long as you do not broadcast signed transactions.
 */
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet } from "viem/chains";
import { rpc, Keypair } from "@stellar/stellar-sdk";
import { resolveEthereumRpcUrl } from "../ethereum-rpc-url.js";

// Load .env from CWD. dotenv is a no-op if the file is missing, so this is
// safe for tests and prod. Existing env vars take precedence over .env.
dotenvConfig({ path: resolve(process.cwd(), ".env") });

export type ReadinessStatus = "ok" | "warn" | "fail";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}

export interface ReadinessResult {
  network: "testnet" | "mainnet";
  ready: boolean;
  evm: { address: `0x${string}`; chainId: number } | null;
  stellar: { publicKey: string } | null;
  checks: ReadinessCheck[];
}

const EVM_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const STELLAR_SECRET_RE = /^S[A-Z2-7]{55}$/;
const SOROBAN_CONTRACT_RE = /^C[A-Z2-7]{55}$/;

const RPC_TIMEOUT_MS = 4000;

function checkNetwork(): { network: "testnet" | "mainnet"; check: ReadinessCheck } {
  const raw = process.env.NETWORK_MODE ?? "testnet";
  if (raw === "testnet" || raw === "mainnet") {
    return {
      network: raw,
      check: { id: "network-mode", label: "NETWORK_MODE", status: "ok", detail: raw }
    };
  }
  return {
    network: "testnet",
    check: {
      id: "network-mode",
      label: "NETWORK_MODE",
      status: "fail",
      detail: `must be 'testnet' or 'mainnet' (got: '${raw}')`
    }
  };
}

async function pingEvmRpc(network: "testnet" | "mainnet"): Promise<{
  ok: boolean;
  url: string;
  chainId: number | null;
  detail: string;
}> {
  const url = resolveEthereumRpcUrl(network);
  const chain = network === "mainnet" ? mainnet : sepolia;
  const expectedChainId = network === "mainnet" ? 1 : 11_155_111;
  try {
    const client = createPublicClient({
      chain,
      transport: http(url, { timeout: RPC_TIMEOUT_MS })
    });
    const cid = await client.getChainId();
    if (cid === expectedChainId) {
      return {
        ok: true,
        url,
        chainId: cid,
        detail: `URL=${url} chainId=${cid}`
      };
    }
    return {
      ok: false,
      url,
      chainId: cid,
      detail: `URL=${url} — RPC reported chainId=${cid}, expected ${expectedChainId}`
    };
  } catch (err: any) {
    return {
      ok: false,
      url,
      chainId: null,
      detail: `URL=${url} — error: ${err?.shortMessage ?? err?.message ?? String(err)}`
    };
  }
}

async function pingSorobanRpc(network: "testnet" | "mainnet"): Promise<{
  ok: boolean;
  url: string;
  detail: string;
}> {
  const url =
    process.env.SOROBAN_RPC_URL?.trim() ||
    (network === "mainnet" ? "https://mainnet.sorobanrpc.com" : "https://soroban-testnet.stellar.org");
  try {
    const server = new rpc.Server(url, {
      allowHttp: url.startsWith("http://"),
      timeout: RPC_TIMEOUT_MS
    });
    const latest = await server.getLatestLedger();
    const seq = latest?.sequence;
    return {
      ok: seq !== undefined && seq !== null,
      url,
      detail: `URL=${url} latestLedger=${seq}`
    };
  } catch (err: any) {
    return {
      ok: false,
      url,
      detail: `URL=${url} — error: ${err?.message ?? String(err)}`
    };
  }
}

export async function assessReadiness(): Promise<ReadinessResult> {
  const checks: ReadinessCheck[] = [];
  const { network, check: networkCheck } = checkNetwork();
  checks.push(networkCheck);

  const isMainnet = network === "mainnet";
  const evmChainId = isMainnet ? 1 : 11_155_111;
  const evmRegistryEnv = isMainnet ? "ETH_RESOLVER_REGISTRY_MAINNET" : "ETH_RESOLVER_REGISTRY_TESTNET";
  const sorobanRegistryEnv = isMainnet ? "SOROBAN_RESOLVER_REGISTRY_MAINNET" : "SOROBAN_RESOLVER_REGISTRY_TESTNET";

  // ===== EVM side =====
  const evmPing = await pingEvmRpc(network);
  checks.push({
    id: "evm-rpc",
    label: "Ethereum RPC reachable",
    status: evmPing.ok ? "ok" : "fail",
    detail: evmPing.detail
  });

  const evmRegistry = process.env[evmRegistryEnv];
  const evmRegistryOk = !!evmRegistry && EVM_ADDR_RE.test(evmRegistry);
  checks.push({
    id: "evm-registry",
    label: `EVM registry address (${evmRegistryEnv})`,
    status: evmRegistryOk ? "ok" : "fail",
    detail: evmRegistryOk
      ? evmRegistry
      : !evmRegistry
        ? "unset — fill this with the address from deployments.<network>.json"
        : "set but does not match a 0x-prefixed 20-byte hex address"
  });

  let evmAddress: `0x${string}` | null = null;
  const evmKey = process.env.RESOLVER_ETH_PRIVATE_KEY;
  if (!evmKey) {
    checks.push({
      id: "evm-private-key",
      label: "RESOLVER_ETH_PRIVATE_KEY",
      status: "fail",
      detail: "unset — set to a 0x-prefixed 32-byte hex string for your hot wallet"
    });
  } else if (!EVM_KEY_RE.test(evmKey)) {
    checks.push({
      id: "evm-private-key",
      label: "RESOLVER_ETH_PRIVATE_KEY",
      status: "fail",
      detail: "set but does not match a 0x-prefixed 32-byte hex value"
    });
  } else {
    try {
      evmAddress = privateKeyToAccount(evmKey as `0x${string}`).address;
      checks.push({
        id: "evm-private-key",
        label: "RESOLVER_ETH_PRIVATE_KEY",
        status: "ok",
        detail: `derives address ${evmAddress} (key value NOT displayed)`
      });
    } catch (err: any) {
      checks.push({
        id: "evm-private-key",
        label: "RESOLVER_ETH_PRIVATE_KEY",
        status: "fail",
        detail: `unparseable: ${err?.shortMessage ?? err?.message ?? String(err)}`
      });
    }
  }

  // ===== Stellar / Soroban side =====
  const sorobanPing = await pingSorobanRpc(network);
  checks.push({
    id: "soroban-rpc",
    label: "Stellar / Soroban RPC reachable",
    status: sorobanPing.ok ? "ok" : "fail",
    detail: sorobanPing.detail
  });

  const sorobanRegistry = process.env[sorobanRegistryEnv];
  const sorobanRegistryOk = !!sorobanRegistry && SOROBAN_CONTRACT_RE.test(sorobanRegistry);
  checks.push({
    id: "soroban-registry",
    label: `Soroban registry id (${sorobanRegistryEnv})`,
    status: sorobanRegistryOk ? "ok" : "fail",
    detail: sorobanRegistryOk
      ? sorobanRegistry
      : !sorobanRegistry
        ? "unset — fill this with the contract id from deployments.<network>.json"
        : "set but does not match a Stellar contract id (C...)"
  });

  let stellarPublicKey: string | null = null;
  const stellarSecret = process.env.RESOLVER_STELLAR_SECRET;
  if (!stellarSecret) {
    checks.push({
      id: "stellar-secret",
      label: "RESOLVER_STELLAR_SECRET",
      status: "fail",
      detail: "unset — set to your Stellar secret seed starting with 'S'"
    });
  } else if (!STELLAR_SECRET_RE.test(stellarSecret)) {
    checks.push({
      id: "stellar-secret",
      label: "RESOLVER_STELLAR_SECRET",
      status: "fail",
      detail: "set but does not match a Stellar secret seed (S + 55 base32 chars)"
    });
  } else {
    try {
      stellarPublicKey = Keypair.fromSecret(stellarSecret).publicKey();
      checks.push({
        id: "stellar-secret",
        label: "RESOLVER_STELLAR_SECRET",
        status: "ok",
        detail: `derives publicKey ${stellarPublicKey} (secret value NOT displayed)`
      });
    } catch (err: any) {
      checks.push({
        id: "stellar-secret",
        label: "RESOLVER_STELLAR_SECRET",
        status: "fail",
        detail: `unparseable: ${err?.message ?? String(err)}`
      });
    }
  }

  // ===== Informational / dry-run assertion =====
  const rawCoordUrl = process.env.COORDINATOR_URL?.trim();
  const coordUrlDisplay = rawCoordUrl || "(default http://localhost:3001)";
  checks.push({
    id: "coordinator-url",
    label: "COORDINATOR_URL",
    status: rawCoordUrl ? "ok" : "warn",
    detail: coordUrlDisplay
  });

  checks.push({
    id: "dry-run-mode",
    label: "Dry-run mode",
    status: "ok",
    detail:
      "This command only reads env + makes read-only RPC calls (eth_chainId, " +
      "getLatestLedger). No transactions are signed, sent, or paid for. No funds move."
  });

  const ready = checks.every((c) => c.status !== "fail");

  return {
    network,
    ready,
    evm: evmAddress ? { address: evmAddress, chainId: evmChainId } : null,
    stellar: stellarPublicKey ? { publicKey: stellarPublicKey } : null,
    checks
  };
}

export async function readinessCommand(): Promise<number> {
  const result = await assessReadiness();
  const STATUS_ICON: Record<ReadinessStatus, string> = {
    ok: "[OK]",
    warn: "[WARN]",
    fail: "[FAIL]"
  };

  console.log("");
  console.log("=== OverSync Resolver Readiness ===");
  console.log(`Network      : ${result.network}`);
  console.log(`EVM address  : ${result.evm?.address ?? "(not derived)"} (chainId=${result.evm?.chainId ?? "?"})`);
  console.log(`Stellar addr : ${result.stellar?.publicKey ?? "(not derived)"}`);
  console.log("Mode         : DRY-RUN — no transactions submitted, no funds moved");
  console.log("");
  console.log("Checks:");
  for (const c of result.checks) {
    console.log(`  ${STATUS_ICON[c.status]}  ${c.label}`);
    console.log(`        ${c.detail}`);
  }
  console.log("");
  if (result.ready) {
    console.log("Result: READY — this environment looks correct for a resolver operator.");
    console.log("Next step: `pnpm --filter @oversync/resolver register` to stake and activate.");
    return 0;
  }
  const failing = result.checks.filter((c) => c.status === "fail").map((c) => c.id);
  console.log(`Result: NOT READY — failing checks: ${failing.join(", ")}`);
  console.log(
    "Fix the failing items in your .env / environment and re-run this command. " +
      "This command never displays private keys or secrets."
  );
  return 1;
}

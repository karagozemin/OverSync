import { createHash } from "node:crypto";
import { createPublicClient, http } from "viem";
import { sepolia, mainnet } from "viem/chains";
import { rpc } from "@stellar/stellar-sdk";
import { createJsonRpcFetch, createSorobanRpcServer } from "@oversync/sdk";

export type SupportedNetwork = "testnet" | "mainnet";

export const NETWORK_PASSPHRASES: Record<SupportedNetwork, string> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015"
};

export const EXPECTED_EVM_CHAIN_ID: Record<SupportedNetwork, number> = {
  testnet: 11_155_111,
  mainnet: 1
};

export function networkPassphraseHash(passphrase: string): string {
  return createHash("sha256").update(passphrase, "utf8").digest("hex");
}

export interface CoordinatorReadiness {
  networkMode?: string;
  ethereum?: { chainId?: number };
  stellar?: { networkPassphraseHash?: string; network?: string };
}

export interface NetworkAgreementResult {
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface ObservedNetworks {
  evm: { chainId: number | null; rpcUrl: string };
  soroban: { networkPassphrase: string | null; rpcUrl: string };
}

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "[REDACTED]";
  }
}

export function compareNetworkAgreement(
  network: SupportedNetwork,
  evmChainId: number | null,
  coordinator: CoordinatorReadiness
): NetworkAgreementResult {
  const expectedChainId = network === "mainnet" ? 1 : 11_155_111;
  const mismatches: string[] = [];

  if (coordinator.networkMode && coordinator.networkMode !== network) {
    mismatches.push(`network mode differs (coordinator=${coordinator.networkMode}, resolver=${network})`);
  }
  if (coordinator.ethereum?.chainId !== undefined && evmChainId !== null && coordinator.ethereum.chainId !== evmChainId) {
    mismatches.push(`Ethereum chain ID differs (coordinator=${coordinator.ethereum.chainId}, resolver=${evmChainId})`);
  } else if (coordinator.ethereum?.chainId !== undefined && coordinator.ethereum.chainId !== expectedChainId) {
    mismatches.push(`Ethereum chain ID differs (coordinator=${coordinator.ethereum.chainId}, expected=${expectedChainId})`);
  }

  const expectedPassphraseHash = networkPassphraseHash(NETWORK_PASSPHRASES[network]);
  const coordinatorHash = coordinator.stellar?.networkPassphraseHash;
  if (coordinatorHash) {
    if (coordinatorHash !== expectedPassphraseHash) {
      mismatches.push("Stellar network passphrase differs");
    }
  } else if (coordinator.stellar?.network && coordinator.stellar.network !== network) {
    // Compatibility with coordinators predating networkPassphraseHash.
    mismatches.push(`Stellar network differs (coordinator=${coordinator.stellar.network}, resolver=${network})`);
  }

  return mismatches.length
    ? { status: "fail", detail: mismatches.join("; ") }
    : { status: "ok", detail: "Coordinator and resolver networks agree (Ethereum chain ID and Stellar network passphrase)" };
}

export async function checkCoordinatorNetwork(
  coordinatorUrl: string,
  network: SupportedNetwork,
  evmChainId: number | null
): Promise<NetworkAgreementResult> {
  const endpoint = `${coordinatorUrl.replace(/\/+$/, "")}/readiness`;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) {
      return { status: "warn", detail: `Coordinator readiness unavailable (HTTP ${response.status})` };
    }
    const payload = (await response.json()) as CoordinatorReadiness;
    return compareNetworkAgreement(network, evmChainId, payload);
  } catch {
    // Do not include the fetch error text: some clients echo the request URL,
    // which could contain credentials supplied in COORDINATOR_URL.
    return {
      status: "warn",
      detail: `Coordinator readiness unavailable at ${redactUrl(coordinatorUrl)}`
    };
  }
}

export async function checkResolverNetworkAgreement(
  network: SupportedNetwork,
  evmRpcUrl: string,
  sorobanRpcUrl: string,
  sorobanNetworkPassphrase: string
): Promise<NetworkAgreementResult & { observed: ObservedNetworks }> {
  const expectedChainId = EXPECTED_EVM_CHAIN_ID[network];
  const expectedPassphrase = NETWORK_PASSPHRASES[network];
  const mismatches: string[] = [];
  let observedEvmChainId: number | null = null;
  let observedSorobanPassphrase: string | null = null;

  function redactErrorMessage(message: string, urlToRedact: string): string {
    const redactedUrl = redactUrl(urlToRedact);
    // Replace any occurrence of the full URL with the redacted version
    return message.replace(new RegExp(urlToRedact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), redactedUrl);
  }

  // Check Ethereum RPC
  try {
    const chain = network === "mainnet" ? mainnet : sepolia;
    const client = createPublicClient({
      chain,
      transport: http(evmRpcUrl, {
        timeout: 4000,
        fetchFn: createJsonRpcFetch()
      })
    });
    observedEvmChainId = await client.getChainId();
    if (observedEvmChainId !== expectedChainId) {
      mismatches.push(
        `Ethereum RPC chain ID ${observedEvmChainId} does not match configured network ${network} (expected ${expectedChainId})`
      );
    }
  } catch (err: any) {
    mismatches.push(redactErrorMessage(`Ethereum RPC unreachable at ${redactUrl(evmRpcUrl)}: ${err.message}`, evmRpcUrl));
  }

  // Check Soroban RPC
  try {
    const server = createSorobanRpcServer(sorobanRpcUrl, {
      allowHttp: sorobanRpcUrl.startsWith("http://"),
      timeout: 4000
    });
    const latest = await server.getLatestLedger();
    if (latest && latest.sequence !== undefined) {
      // Network passphrase is configured, not fetched from RPC. We compare the configured passphrase.
      observedSorobanPassphrase = sorobanNetworkPassphrase;
      if (sorobanNetworkPassphrase !== expectedPassphrase) {
        mismatches.push(
          `Soroban network passphrase "${sorobanNetworkPassphrase}" does not match configured network ${network} (expected "${expectedPassphrase}")`
        );
      }
    } else {
      mismatches.push("Soroban RPC returned invalid ledger sequence");
    }
  } catch (err: any) {
    mismatches.push(redactErrorMessage(`Soroban RPC unreachable at ${redactUrl(sorobanRpcUrl)}: ${err.message}`, sorobanRpcUrl));
  }

  // Cross-check: ensure both sides agree on the network (both testnet or both mainnet)
  const evmIsMainnet = observedEvmChainId === 1;
  const sorobanIsMainnet = observedSorobanPassphrase === NETWORK_PASSPHRASES.mainnet;
  if (observedEvmChainId !== null && observedSorobanPassphrase !== null && evmIsMainnet !== sorobanIsMainnet) {
    mismatches.push(
      `EVM network (${evmIsMainnet ? "mainnet" : "testnet"}) and Soroban network (${sorobanIsMainnet ? "mainnet" : "testnet"}) disagree`
    );
  }

  const detail = mismatches.length
    ? mismatches.join("; ")
    : `EVM chainId=${observedEvmChainId}, Soroban passphrase matches ${network}`;

  return {
    status: mismatches.length ? "fail" : "ok",
    detail,
    observed: {
      evm: { chainId: observedEvmChainId, rpcUrl: redactUrl(evmRpcUrl) },
      soroban: { networkPassphrase: observedSorobanPassphrase, rpcUrl: redactUrl(sorobanRpcUrl) }
    }
  };
}

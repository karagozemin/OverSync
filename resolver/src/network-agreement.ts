import { createHash } from "node:crypto";

export type SupportedNetwork = "testnet" | "mainnet";

export const NETWORK_PASSPHRASES: Record<SupportedNetwork, string> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015"
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

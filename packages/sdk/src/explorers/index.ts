// ---------------------------------------------------------------------------
// OverSync SDK — Explorer URL helpers
//
// Build public block-explorer links for Ethereum and Stellar transactions
// and addresses / contracts. Future mainnet variants are gated by the
// `network` argument; invalid combinations return `null`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------

/** Supported Ethereum network identifiers. */
export type EthereumNetwork = "sepolia" | "mainnet";

/** Supported Stellar network identifiers. */
export type StellarNetwork = "testnet" | "public";

// ---------------------------------------------------------------
// Base URLs
// ---------------------------------------------------------------

const ETHEREUM_BASE_URLS: Record<EthereumNetwork, string> = {
  sepolia: "https://sepolia.etherscan.io",
  mainnet: "https://etherscan.io",
};

const STELLAR_BASE_URLS: Record<StellarNetwork, string> = {
  testnet: "https://stellar.expert/explorer/testnet",
  public: "https://stellar.expert/explorer/public",
};

// ---------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------

/**
 * Build an Etherscan transaction URL for the given Ethereum network.
 *
 * @param network - Target network (`"sepolia"` or `"mainnet"`).
 * @param txHash  - 0x-prefixed transaction hash.
 * @returns The full explorer URL, or `null` if the network is
 *          unrecognised (provides type safety at compile time, guards
 *          against unexpected values at runtime).
 */
export function ethereumTxUrl(
  network: EthereumNetwork,
  txHash: string,
): string | null {
  const base = ETHEREUM_BASE_URLS[network];
  if (!base) return null;
  return `${base}/tx/${txHash}`;
}

/**
 * Build an Etherscan address URL for the given Ethereum network.
 *
 * @param network - Target network (`"sepolia"` or `"mainnet"`).
 * @param address - 0x-prefixed address.
 * @returns The full explorer URL, or `null` if the network is
 *          unrecognised.
 */
export function ethereumAddressUrl(
  network: EthereumNetwork,
  address: string,
): string | null {
  const base = ETHEREUM_BASE_URLS[network];
  if (!base) return null;
  return `${base}/address/${address}`;
}

/**
 * Build a Stellar Expert transaction URL for the given Stellar network.
 *
 * @param network - Target network (`"testnet"` or `"public"`).
 * @param txHash  - Stellar transaction hash (base-64 or hex, as returned
 *                  by the Horizon API).
 * @returns The full explorer URL, or `null` if the network is
 *          unrecognised.
 */
export function stellarTxUrl(
  network: StellarNetwork,
  txHash: string,
): string | null {
  const base = STELLAR_BASE_URLS[network];
  if (!base) return null;
  return `${base}/tx/${txHash}`;
}

/**
 * Build a Stellar Expert contract / account URL for the given Stellar
 * network.
 *
 * @param network    - Target network (`"testnet"` or `"public"`).
 * @param contractId - Stellar contract or account ID.
 * @returns The full explorer URL, or `null` if the network is
 *          unrecognised.
 */
export function stellarContractUrl(
  network: StellarNetwork,
  contractId: string,
): string | null {
  const base = STELLAR_BASE_URLS[network];
  if (!base) return null;
  return `${base}/contract/${contractId}`;
}

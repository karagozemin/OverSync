// ---------------------------------------------------------------------------
// OverSync SDK — Explorer URL helpers
//
// Build public block-explorer links for Ethereum and Stellar transactions,
// addresses, Stellar accounts, and Soroban contracts. Future mainnet/public
// network variants are gated by the `network` argument; invalid network or
// missing/empty inputs return `null`.
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
// Validation helper
// ---------------------------------------------------------------

function isValidInput(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0;
}

// ---------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------

/**
 * Build an Etherscan transaction URL for the given Ethereum network.
 *
 * @param network - Target network (`"sepolia"` or `"mainnet"`).
 * @param txHash  - 0x-prefixed transaction hash.
 * @returns The full explorer URL, or `null` if the network is
 *          unrecognised or input is empty/invalid.
 */
export function ethereumTxUrl(
  network: EthereumNetwork,
  txHash: string,
): string | null {
  if (!isValidInput(txHash)) return null;
  const base = ETHEREUM_BASE_URLS[network];
  if (!base) return null;
  return `${base}/tx/${txHash.trim()}`;
}

/**
 * Build an Etherscan address URL for the given Ethereum network.
 *
 * @param network - Target network (`"sepolia"` or `"mainnet"`).
 * @param address - 0x-prefixed address.
 * @returns The full explorer URL, or `null` if the network is
 *          unrecognised or input is empty/invalid.
 */
export function ethereumAddressUrl(
  network: EthereumNetwork,
  address: string,
): string | null {
  if (!isValidInput(address)) return null;
  const base = ETHEREUM_BASE_URLS[network];
  if (!base) return null;
  return `${base}/address/${address.trim()}`;
}

/**
 * Build a Stellar Expert transaction URL for the given Stellar network.
 *
 * @param network - Target network (`"testnet"` or `"public"`).
 * @param txHash  - Stellar transaction hash.
 * @returns The full explorer URL, or `null` if the network is
 *          unrecognised or input is empty/invalid.
 */
export function stellarTxUrl(
  network: StellarNetwork,
  txHash: string,
): string | null {
  if (!isValidInput(txHash)) return null;
  const base = STELLAR_BASE_URLS[network];
  if (!base) return null;
  return `${base}/tx/${txHash.trim()}`;
}

/**
 * Build a Stellar Expert account URL for the given Stellar network.
 *
 * @param network   - Target network (`"testnet"` or `"public"`).
 * @param accountId - Stellar account ID (G...).
 * @returns The full explorer URL, or `null` if the network is
 *          unrecognised or input is empty/invalid.
 */
export function stellarAccountUrl(
  network: StellarNetwork,
  accountId: string,
): string | null {
  if (!isValidInput(accountId)) return null;
  const base = STELLAR_BASE_URLS[network];
  if (!base) return null;
  return `${base}/account/${accountId.trim()}`;
}

/**
 * Build a Stellar Expert contract / Soroban contract URL for the given Stellar
 * network.
 *
 * @param network    - Target network (`"testnet"` or `"public"`).
 * @param contractId - Soroban contract ID (C...).
 * @returns The full explorer URL, or `null` if the network is
 *          unrecognised or input is empty/invalid.
 */
export function stellarContractUrl(
  network: StellarNetwork,
  contractId: string,
): string | null {
  if (!isValidInput(contractId)) return null;
  const base = STELLAR_BASE_URLS[network];
  if (!base) return null;
  return `${base}/contract/${contractId.trim()}`;
}

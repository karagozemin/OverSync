export type SupportedNetwork = "sepolia" | "ethereum-mainnet" | "stellar-testnet" | "stellar-public";

/**
 * Returns the block explorer URL for a given transaction hash.
 * Mainnet UI paths are intentionally disabled (returns null).
 *
 * @param network Network name (e.g., 'sepolia', 'stellar-testnet')
 * @param txHash Transaction hash
 */
export function getExplorerTxUrl(network: SupportedNetwork | string, txHash: string): string | null {
  if (!txHash) return null;

  switch (network) {
    case "sepolia":
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    case "stellar-testnet":
      return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
    case "ethereum-mainnet":
    case "stellar-public":
      return null;
    default:
      return null;
  }
}

/**
 * Returns the block explorer URL for a given EVM address or Stellar account.
 * Mainnet UI paths are intentionally disabled (returns null).
 *
 * @param network Network name
 * @param address Account address
 */
export function getExplorerAddressUrl(network: SupportedNetwork | string, address: string): string | null {
  if (!address) return null;

  switch (network) {
    case "sepolia":
      return `https://sepolia.etherscan.io/address/${address}`;
    case "stellar-testnet":
      return `https://stellar.expert/explorer/testnet/account/${address}`;
    case "ethereum-mainnet":
    case "stellar-public":
      return null;
    default:
      return null;
  }
}

/**
 * Returns the block explorer URL for a smart contract.
 * Mainnet UI paths are intentionally disabled (returns null).
 *
 * @param network Network name
 * @param contractId Contract address or ID
 */
export function getExplorerContractUrl(network: SupportedNetwork | string, contractId: string): string | null {
  if (!contractId) return null;

  switch (network) {
    case "sepolia":
      return `https://sepolia.etherscan.io/address/${contractId}`;
    case "stellar-testnet":
      return `https://stellar.expert/explorer/testnet/contract/${contractId}`;
    case "ethereum-mainnet":
    case "stellar-public":
      return null;
    default:
      return null;
  }
}

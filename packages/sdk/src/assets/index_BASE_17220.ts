export type AssetMappingNetwork = "testnet" | "mainnet";

export interface CanonicalStellarAsset {
  code: string;
  issuer?: string;
}

export const NATIVE_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
export const NATIVE_STELLAR_ASSET: CanonicalStellarAsset = { code: "XLM" };

const TESTNET_ETH_TO_STELLAR: Record<string, CanonicalStellarAsset> = {
  [NATIVE_ETH_ADDRESS]: NATIVE_STELLAR_ASSET,
  "0xa0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b": {
    code: "USDC",
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
};

const TESTNET_STELLAR_TO_ETH: Record<string, string> = {
  XLM: NATIVE_ETH_ADDRESS,
  "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5":
    "0xa0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b",
};

const MAINNET_ETH_TO_STELLAR: Record<string, CanonicalStellarAsset> = {
  [NATIVE_ETH_ADDRESS]: NATIVE_STELLAR_ASSET,
};

const MAINNET_STELLAR_TO_ETH: Record<string, string> = {
  XLM: NATIVE_ETH_ADDRESS,
};

const MAPPINGS: Record<AssetMappingNetwork, {
  ethToStellar: Record<string, CanonicalStellarAsset>;
  stellarToEth: Record<string, string>;
}> = {
  testnet: {
    ethToStellar: TESTNET_ETH_TO_STELLAR,
    stellarToEth: TESTNET_STELLAR_TO_ETH,
  },
  mainnet: {
    ethToStellar: MAINNET_ETH_TO_STELLAR,
    stellarToEth: MAINNET_STELLAR_TO_ETH,
  },
};

function normalizeEthereumAddress(address: string): string {
  return address.trim().toLowerCase();
}

function stellarAssetKey(asset: string | CanonicalStellarAsset): string {
  if (typeof asset === "string") {
    return asset.trim();
  }

  return asset.issuer ? `${asset.code}:${asset.issuer}` : asset.code;
}

export function resolveStellarAsset(
  ethereumTokenAddress: string,
  network: AssetMappingNetwork = "testnet"
): CanonicalStellarAsset {
  const normalized = normalizeEthereumAddress(ethereumTokenAddress);
  const mapping = MAPPINGS[network]?.ethToStellar || MAPPINGS.testnet.ethToStellar;
  return mapping[normalized] ?? NATIVE_STELLAR_ASSET;
}

export function resolveEthereumToken(
  stellarAsset: string | CanonicalStellarAsset,
  network: AssetMappingNetwork = "testnet"
): string {
  const key = stellarAssetKey(stellarAsset);
  const mapping = MAPPINGS[network]?.stellarToEth || MAPPINGS.testnet.stellarToEth;
  return mapping[key] ?? NATIVE_ETH_ADDRESS;
}

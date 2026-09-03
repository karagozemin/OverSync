import {
  normalizeEthereumAddress,
  normalizeStellarAddress
} from "../addresses/index.js";

export type AssetMappingNetwork = "testnet" | "mainnet";

export interface CanonicalStellarAsset {
  code: string;
  issuer?: string;
}

export const NATIVE_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
export const NATIVE_STELLAR_ASSET: CanonicalStellarAsset = { code: "XLM" };

const TESTNET_ETH_TO_STELLAR: Record<string, CanonicalStellarAsset> = {
  [NATIVE_ETH_ADDRESS]: NATIVE_STELLAR_ASSET,
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": {
    code: "USDC",
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
};

const TESTNET_STELLAR_TO_ETH: Record<string, string> = {
  XLM: NATIVE_ETH_ADDRESS,
  "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5":
    "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
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

function stellarAssetKey(asset: string | CanonicalStellarAsset): string {
  if (typeof asset === "string") {
    const trimmed = asset.trim();
    // "CODE" or "CODE:ISSUER"
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      return trimmed;
    }
    const code = trimmed.slice(0, separator).trim();
    const issuer = normalizeStellarAddress(
      trimmed.slice(separator + 1),
      "Stellar asset issuer"
    );
    return `${code}:${issuer}`;
  }

  const code = asset.code.trim();
  const issuer = asset.issuer
    ? normalizeStellarAddress(asset.issuer, "Stellar asset issuer")
    : undefined;
  return issuer ? `${code}:${issuer}` : code;
}

export function resolveStellarAsset(
  ethereumTokenAddress: string,
  network: AssetMappingNetwork = "testnet"
): CanonicalStellarAsset {
  // Strict canonicalization: a malformed Ethereum token address is
  // rejected immediately instead of silently mapping to XLM (a false
  // match that would route the wrong asset across the bridge).
  const normalized = normalizeEthereumAddress(
    ethereumTokenAddress,
    "Ethereum token address"
  );
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

export * from "./capabilities.js";

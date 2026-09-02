import { describe, it, expect } from "vitest";
import {
  CANONICAL_TESTNET,
  compareTestnetAssetSources,
} from "../../../scripts/lib/testnet-asset-consistency.mjs";

const MATCHING_NETWORKS_TS = `
export const CONTRACT_ADDRESSES = {
  ethereum: {
    sepolia: {
      testToken: '${CANONICAL_TESTNET.sepoliaUsdc}',
    },
  },
  stellar: {
    testnet: {
      networkPassphrase: '${CANONICAL_TESTNET.stellarNetworkPassphrase}',
    },
  },
};
`;

const MATCHING_TOKEN_SELECTOR_TS = `
const mockTokens = [
  {
    symbol: 'USDC',
    chain: 'ethereum',
    address: '${CANONICAL_TESTNET.sepoliaUsdc}',
  },
  {
    symbol: 'USDC',
    chain: 'stellar',
    address: 'USDC-${CANONICAL_TESTNET.stellarUsdcIssuer}',
  },
];
`;

const MATCHING_BACKEND_CONFIG_TS = `
export function loadConfig() {
  const network = (process.env.NETWORK_MODE ?? "testnet") as Network;
  return {
    ethereum: { chainId: 11_155_111 },
    soroban: { networkPassphrase: "${CANONICAL_TESTNET.stellarNetworkPassphrase}" },
  };
}
`;

const MATCHING_PACKAGE_JSON = JSON.stringify({
  dependencies: { "@oversync/sdk": "workspace:*" },
});

describe("testnet asset configuration consistency", () => {
  it("passes when frontend and backend fixtures match the SDK canonical assets", () => {
    const { mismatches } = compareTestnetAssetSources({
      networksTs: MATCHING_NETWORKS_TS,
      tokenSelectorTs: MATCHING_TOKEN_SELECTOR_TS,
      coordinatorConfigTs: MATCHING_BACKEND_CONFIG_TS,
      resolverConfigTs: MATCHING_BACKEND_CONFIG_TS,
      coordinatorPackageJson: MATCHING_PACKAGE_JSON,
      resolverPackageJson: MATCHING_PACKAGE_JSON,
    });

    expect(mismatches).toEqual([]);
  });

  it("reports field-level mismatches when Sepolia USDC drifts from the SDK", () => {
    const driftedNetworksTs = MATCHING_NETWORKS_TS.replace(
      CANONICAL_TESTNET.sepoliaUsdc,
      "0x677afcB4A57a938A74a1A76a93913dE4Db3e5C63"
    );

    const { mismatches } = compareTestnetAssetSources({
      networksTs: driftedNetworksTs,
      tokenSelectorTs: MATCHING_TOKEN_SELECTOR_TS,
      coordinatorConfigTs: MATCHING_BACKEND_CONFIG_TS,
      resolverConfigTs: MATCHING_BACKEND_CONFIG_TS,
      coordinatorPackageJson: MATCHING_PACKAGE_JSON,
      resolverPackageJson: MATCHING_PACKAGE_JSON,
    });

    expect(mismatches.some((m) => m.includes("frontend/networks.ts sepolia.testToken"))).toBe(true);
    expect(mismatches.length).toBeGreaterThan(0);
  });
});

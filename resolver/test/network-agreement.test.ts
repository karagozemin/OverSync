import { describe, expect, it } from "vitest";
import {
  compareNetworkAgreement,
  networkPassphraseHash,
  NETWORK_PASSPHRASES
} from "../src/network-agreement.js";

describe("coordinator/resolver network agreement", () => {
  it("accepts matching Ethereum chain and Stellar passphrase", () => {
    const result = compareNetworkAgreement("testnet", 11_155_111, {
      networkMode: "testnet",
      ethereum: { chainId: 11_155_111 },
      stellar: {
        networkPassphraseHash: networkPassphraseHash(NETWORK_PASSPHRASES.testnet)
      }
    });

    expect(result.status).toBe("ok");
  });

  it("fails when either chain configuration differs", () => {
    const result = compareNetworkAgreement("testnet", 1, {
      networkMode: "mainnet",
      ethereum: { chainId: 1 },
      stellar: {
        networkPassphraseHash: networkPassphraseHash(NETWORK_PASSPHRASES.mainnet)
      }
    });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Ethereum chain ID differs");
    expect(result.detail).toContain("Stellar network passphrase differs");
    expect(result.detail).not.toContain(NETWORK_PASSPHRASES.mainnet);
  });
});

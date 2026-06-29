import { describe, it, expect } from "vitest";
import { getExplorerTxUrl, getExplorerAddressUrl, getExplorerContractUrl } from "../src/utils/explorer.js";

describe("Explorer URL Builder", () => {
  describe("getExplorerTxUrl", () => {
    it("returns Sepolia URL", () => {
      expect(getExplorerTxUrl("sepolia", "0x123")).toBe("https://sepolia.etherscan.io/tx/0x123");
    });

    it("returns Stellar testnet URL", () => {
      expect(getExplorerTxUrl("stellar-testnet", "abc")).toBe("https://stellar.expert/explorer/testnet/tx/abc");
    });

    it("returns null for mainnet paths", () => {
      expect(getExplorerTxUrl("ethereum-mainnet", "0x123")).toBeNull();
      expect(getExplorerTxUrl("stellar-public", "abc")).toBeNull();
    });

    it("returns null for unknown network", () => {
      expect(getExplorerTxUrl("unknown-net", "0x123")).toBeNull();
    });

    it("returns null for empty tx hash", () => {
      expect(getExplorerTxUrl("sepolia", "")).toBeNull();
    });
  });

  describe("getExplorerAddressUrl", () => {
    it("returns Sepolia URL", () => {
      expect(getExplorerAddressUrl("sepolia", "0xabc")).toBe("https://sepolia.etherscan.io/address/0xabc");
    });

    it("returns Stellar testnet URL", () => {
      expect(getExplorerAddressUrl("stellar-testnet", "GABC")).toBe("https://stellar.expert/explorer/testnet/account/GABC");
    });

    it("returns null for mainnet paths", () => {
      expect(getExplorerAddressUrl("ethereum-mainnet", "0x123")).toBeNull();
      expect(getExplorerAddressUrl("stellar-public", "abc")).toBeNull();
    });

    it("returns null for unknown network", () => {
      expect(getExplorerAddressUrl("unknown-net", "0x123")).toBeNull();
    });
  });

  describe("getExplorerContractUrl", () => {
    it("returns Sepolia URL", () => {
      expect(getExplorerContractUrl("sepolia", "0xdef")).toBe("https://sepolia.etherscan.io/address/0xdef");
    });

    it("returns Stellar testnet URL", () => {
      expect(getExplorerContractUrl("stellar-testnet", "CDEF")).toBe("https://stellar.expert/explorer/testnet/contract/CDEF");
    });

    it("returns null for mainnet paths", () => {
      expect(getExplorerContractUrl("ethereum-mainnet", "0x123")).toBeNull();
      expect(getExplorerContractUrl("stellar-public", "abc")).toBeNull();
    });

    it("returns null for unknown network", () => {
      expect(getExplorerContractUrl("unknown-net", "0x123")).toBeNull();
    });
  });
});

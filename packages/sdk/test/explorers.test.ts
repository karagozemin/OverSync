import { describe, it, expect } from "vitest";
import {
  ethereumTxUrl,
  ethereumAddressUrl,
  stellarTxUrl,
  stellarContractUrl,
} from "../src/explorers/index.js";

describe("explorers", () => {
  const TX_HASH = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
  const STELLAR_TX_HASH = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b";
  const CONTRACT_ID = "CDLZFC3SYJYDZT7K3VJ3SJQH3VJ3SJQH3VJ3SJQH3VJ3SJQH3VJ3SJQH3";

  // ---------------------------------------------------------------
  // Ethereum — Sepolia
  // ---------------------------------------------------------------

  describe("ethereumTxUrl", () => {
    it("builds a Sepolia transaction URL", () => {
      expect(ethereumTxUrl("sepolia", TX_HASH)).toBe(
        `https://sepolia.etherscan.io/tx/${TX_HASH}`,
      );
    });

    it("builds a Mainnet transaction URL", () => {
      expect(ethereumTxUrl("mainnet", TX_HASH)).toBe(
        `https://etherscan.io/tx/${TX_HASH}`,
      );
    });

    it("returns null for an unrecognised network", () => {
      expect(ethereumTxUrl("unknown" as any, TX_HASH)).toBeNull();
    });
  });

  describe("ethereumAddressUrl", () => {
    it("builds a Sepolia address URL", () => {
      expect(ethereumAddressUrl("sepolia", ADDRESS)).toBe(
        `https://sepolia.etherscan.io/address/${ADDRESS}`,
      );
    });

    it("builds a Mainnet address URL", () => {
      expect(ethereumAddressUrl("mainnet", ADDRESS)).toBe(
        `https://etherscan.io/address/${ADDRESS}`,
      );
    });

    it("returns null for an unrecognised network", () => {
      expect(ethereumAddressUrl("unknown" as any, ADDRESS)).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Stellar
  // ---------------------------------------------------------------

  describe("stellarTxUrl", () => {
    it("builds a testnet transaction URL", () => {
      expect(stellarTxUrl("testnet", STELLAR_TX_HASH)).toBe(
        `https://stellar.expert/explorer/testnet/tx/${STELLAR_TX_HASH}`,
      );
    });

    it("builds a public (mainnet) transaction URL", () => {
      expect(stellarTxUrl("public", STELLAR_TX_HASH)).toBe(
        `https://stellar.expert/explorer/public/tx/${STELLAR_TX_HASH}`,
      );
    });

    it("returns null for an unrecognised network", () => {
      expect(stellarTxUrl("unknown" as any, STELLAR_TX_HASH)).toBeNull();
    });
  });

  describe("stellarContractUrl", () => {
    it("builds a testnet contract URL", () => {
      expect(stellarContractUrl("testnet", CONTRACT_ID)).toBe(
        `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`,
      );
    });

    it("builds a public (mainnet) contract URL", () => {
      expect(stellarContractUrl("public", CONTRACT_ID)).toBe(
        `https://stellar.expert/explorer/public/contract/${CONTRACT_ID}`,
      );
    });

    it("returns null for an unrecognised network", () => {
      expect(stellarContractUrl("unknown" as any, CONTRACT_ID)).toBeNull();
    });
  });
});

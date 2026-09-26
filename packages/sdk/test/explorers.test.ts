import { describe, it, expect } from "vitest";
import {
  ethereumTxUrl,
  ethereumAddressUrl,
  stellarTxUrl,
  stellarAccountUrl,
  stellarContractUrl,
} from "../src/explorers/index.js";

describe("explorers", () => {
  const TX_HASH = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
  const STELLAR_TX_HASH = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b";
  const STELLAR_ACCOUNT_ID = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYFTRE6A6B7OD22OM4B";
  const SOROBAN_CONTRACT_ID = "CDLZFC3SYJYDZT7K3VJ3SJQH3VJ3SJQH3VJ3SJQH3VJ3SJQH3VJ3SJQH3";

  // ---------------------------------------------------------------
  // Ethereum — Sepolia & Mainnet
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

    it("trims whitespace from transaction hash", () => {
      expect(ethereumTxUrl("sepolia", `  ${TX_HASH}  `)).toBe(
        `https://sepolia.etherscan.io/tx/${TX_HASH}`,
      );
    });

    it("returns null for an unrecognised network", () => {
      expect(ethereumTxUrl("unknown" as any, TX_HASH)).toBeNull();
    });

    it("returns null for empty or invalid txHash inputs", () => {
      expect(ethereumTxUrl("sepolia", "")).toBeNull();
      expect(ethereumTxUrl("sepolia", "   ")).toBeNull();
      expect(ethereumTxUrl("sepolia", null as any)).toBeNull();
      expect(ethereumTxUrl("sepolia", undefined as any)).toBeNull();
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

    it("trims whitespace from address", () => {
      expect(ethereumAddressUrl("sepolia", `  ${ADDRESS}  `)).toBe(
        `https://sepolia.etherscan.io/address/${ADDRESS}`,
      );
    });

    it("returns null for an unrecognised network", () => {
      expect(ethereumAddressUrl("unknown" as any, ADDRESS)).toBeNull();
    });

    it("returns null for empty or invalid address inputs", () => {
      expect(ethereumAddressUrl("sepolia", "")).toBeNull();
      expect(ethereumAddressUrl("sepolia", "   ")).toBeNull();
      expect(ethereumAddressUrl("sepolia", null as any)).toBeNull();
      expect(ethereumAddressUrl("sepolia", undefined as any)).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Stellar — Testnet & Public
  // ---------------------------------------------------------------

  describe("stellarTxUrl", () => {
    it("builds a testnet transaction URL", () => {
      expect(stellarTxUrl("testnet", STELLAR_TX_HASH)).toBe(
        `https://stellar.expert/explorer/testnet/tx/${STELLAR_TX_HASH}`,
      );
    });

    it("builds a public (mainnet) transaction URL placeholder", () => {
      expect(stellarTxUrl("public", STELLAR_TX_HASH)).toBe(
        `https://stellar.expert/explorer/public/tx/${STELLAR_TX_HASH}`,
      );
    });

    it("trims whitespace from txHash", () => {
      expect(stellarTxUrl("testnet", `  ${STELLAR_TX_HASH}  `)).toBe(
        `https://stellar.expert/explorer/testnet/tx/${STELLAR_TX_HASH}`,
      );
    });

    it("returns null for an unrecognised network", () => {
      expect(stellarTxUrl("unknown" as any, STELLAR_TX_HASH)).toBeNull();
    });

    it("returns null for empty or invalid txHash inputs", () => {
      expect(stellarTxUrl("testnet", "")).toBeNull();
      expect(stellarTxUrl("testnet", "   ")).toBeNull();
      expect(stellarTxUrl("testnet", null as any)).toBeNull();
      expect(stellarTxUrl("testnet", undefined as any)).toBeNull();
    });
  });

  describe("stellarAccountUrl", () => {
    it("builds a testnet account URL", () => {
      expect(stellarAccountUrl("testnet", STELLAR_ACCOUNT_ID)).toBe(
        `https://stellar.expert/explorer/testnet/account/${STELLAR_ACCOUNT_ID}`,
      );
    });

    it("builds a public (mainnet) account URL placeholder", () => {
      expect(stellarAccountUrl("public", STELLAR_ACCOUNT_ID)).toBe(
        `https://stellar.expert/explorer/public/account/${STELLAR_ACCOUNT_ID}`,
      );
    });

    it("trims whitespace from account ID", () => {
      expect(stellarAccountUrl("testnet", `  ${STELLAR_ACCOUNT_ID}  `)).toBe(
        `https://stellar.expert/explorer/testnet/account/${STELLAR_ACCOUNT_ID}`,
      );
    });

    it("returns null for an unrecognised network", () => {
      expect(stellarAccountUrl("unknown" as any, STELLAR_ACCOUNT_ID)).toBeNull();
    });

    it("returns null for empty or invalid account ID inputs", () => {
      expect(stellarAccountUrl("testnet", "")).toBeNull();
      expect(stellarAccountUrl("testnet", "   ")).toBeNull();
      expect(stellarAccountUrl("testnet", null as any)).toBeNull();
      expect(stellarAccountUrl("testnet", undefined as any)).toBeNull();
    });
  });

  describe("stellarContractUrl", () => {
    it("builds a testnet Soroban contract URL", () => {
      expect(stellarContractUrl("testnet", SOROBAN_CONTRACT_ID)).toBe(
        `https://stellar.expert/explorer/testnet/contract/${SOROBAN_CONTRACT_ID}`,
      );
    });

    it("builds a public (mainnet) Soroban contract URL placeholder", () => {
      expect(stellarContractUrl("public", SOROBAN_CONTRACT_ID)).toBe(
        `https://stellar.expert/explorer/public/contract/${SOROBAN_CONTRACT_ID}`,
      );
    });

    it("trims whitespace from contract ID", () => {
      expect(stellarContractUrl("testnet", `  ${SOROBAN_CONTRACT_ID}  `)).toBe(
        `https://stellar.expert/explorer/testnet/contract/${SOROBAN_CONTRACT_ID}`,
      );
    });

    it("returns null for an unrecognised network", () => {
      expect(stellarContractUrl("unknown" as any, SOROBAN_CONTRACT_ID)).toBeNull();
    });

    it("returns null for empty or invalid contract ID inputs", () => {
      expect(stellarContractUrl("testnet", "")).toBeNull();
      expect(stellarContractUrl("testnet", "   ")).toBeNull();
      expect(stellarContractUrl("testnet", null as any)).toBeNull();
      expect(stellarContractUrl("testnet", undefined as any)).toBeNull();
    });
  });
});

import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const VALID_KEY = "0x" + "a".repeat(64);

const BASE: Record<string, string | undefined> = {
  NETWORK_MODE: "testnet",
  MAINNET_AUDIT_CONFIRMED: "false",
  RESOLVER_ETH_PRIVATE_KEY: VALID_KEY,
  SEPOLIA_RPC_URL: "https://sepolia.infura.io/v3/testkey",
  MAINNET_RPC_URL: undefined,
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
};

describe("resolver loadConfig() — env validation", () => {
  it("parses a valid testnet config without throwing", () => {
    withEnv(BASE, () => {
      const cfg = loadConfig();
      expect(cfg.network).toBe("testnet");
      expect(cfg.ethereum.resolverPrivateKey).toBe(VALID_KEY);
    });
  });

  it("throws when RESOLVER_ETH_PRIVATE_KEY is missing", () => {
    withEnv({ ...BASE, RESOLVER_ETH_PRIVATE_KEY: undefined }, () => {
      expect(() => loadConfig()).toThrow(/RESOLVER_ETH_PRIVATE_KEY/);
    });
  });

  it("throws when RESOLVER_ETH_PRIVATE_KEY has wrong format", () => {
    withEnv({ ...BASE, RESOLVER_ETH_PRIVATE_KEY: "not-a-key" }, () => {
      expect(() => loadConfig()).toThrow(/configuration invalid/i);
    });
  });

  it("throws when NETWORK_MODE=mainnet without MAINNET_AUDIT_CONFIRMED=true", () => {
    withEnv(
      {
        ...BASE,
        NETWORK_MODE: "mainnet",
        MAINNET_AUDIT_CONFIRMED: "false",
        MAINNET_RPC_URL: "https://mainnet.infura.io/v3/testkey",
        SEPOLIA_RPC_URL: undefined,
      },
      () => {
        expect(() => loadConfig()).toThrow(/MAINNET_AUDIT_CONFIRMED/);
      }
    );
  });

  it("accepts mainnet when MAINNET_AUDIT_CONFIRMED=true and key is provided", () => {
    withEnv(
      {
        ...BASE,
        NETWORK_MODE: "mainnet",
        MAINNET_AUDIT_CONFIRMED: "true",
        MAINNET_RPC_URL: "https://mainnet.infura.io/v3/testkey",
        SEPOLIA_RPC_URL: undefined,
      },
      () => {
        const cfg = loadConfig();
        expect(cfg.network).toBe("mainnet");
      }
    );
  });
});

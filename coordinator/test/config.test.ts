import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

/**
 * Temporarily override process.env keys, run fn(), then restore.
 * loadConfig() reads process.env at call-time so this is safe.
 */
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

// Minimal env that should always parse cleanly on testnet.
const BASE: Record<string, string | undefined> = {
  NETWORK_MODE: "testnet",
  MAINNET_AUDIT_CONFIRMED: "false",
  SEPOLIA_RPC_URL: "https://sepolia.infura.io/v3/testkey",
  MAINNET_RPC_URL: undefined,
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
};

describe("coordinator loadConfig() — env validation", () => {
  it("parses a valid testnet config without throwing", () => {
    withEnv(BASE, () => {
      const cfg = loadConfig();
      expect(cfg.network).toBe("testnet");
      expect(cfg.mainnetAuditConfirmed).toBe(false);
    });
  });

  it("throws when NETWORK_MODE=mainnet and MAINNET_AUDIT_CONFIRMED is missing", () => {
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

  it("accepts NETWORK_MODE=mainnet when MAINNET_AUDIT_CONFIRMED=true", () => {
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
        expect(cfg.mainnetAuditConfirmed).toBe(true);
      }
    );
  });

  it("throws a descriptive error when Soroban RPC URL is malformed", () => {
    withEnv({ ...BASE, SOROBAN_RPC_URL: "not-a-url" }, () => {
      expect(() => loadConfig()).toThrow(/configuration invalid/i);
    });
  });
});

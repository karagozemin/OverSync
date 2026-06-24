/**
 * Smoke tests for relayer env validation.
 * Uses Jest (already in devDependencies).
 */
import { validateRelayerEnv } from "../src/env-validation.js";

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

const VALID_PRIVATE_KEY = "0x" + "b".repeat(64);
const VALID_STELLAR_SECRET = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3";
const VALID_STELLAR_PUBLIC = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const BASE: Record<string, string | undefined> = {
  NETWORK_MODE: "testnet",
  MAINNET_AUDIT_CONFIRMED: "false",
  SEPOLIA_RPC_URL: "https://sepolia.infura.io/v3/testkey",
  MAINNET_RPC_URL: undefined,
  INFURA_API_KEY: undefined,
  RELAYER_PRIVATE_KEY: VALID_PRIVATE_KEY,
  RELAYER_STELLAR_SECRET: VALID_STELLAR_SECRET,
  RELAYER_STELLAR_PUBLIC: VALID_STELLAR_PUBLIC,
};

describe("validateRelayerEnv()", () => {
  it("succeeds with a minimal valid testnet environment", () => {
    withEnv(BASE, () => {
      expect(() => validateRelayerEnv()).not.toThrow();
      const env = validateRelayerEnv();
      expect(env.networkMode).toBe("testnet");
    });
  });

  it("throws when RELAYER_PRIVATE_KEY is missing", () => {
    withEnv({ ...BASE, RELAYER_PRIVATE_KEY: undefined }, () => {
      expect(() => validateRelayerEnv()).toThrow(/RELAYER_PRIVATE_KEY/);
    });
  });

  it("throws when RELAYER_PRIVATE_KEY has wrong format", () => {
    withEnv({ ...BASE, RELAYER_PRIVATE_KEY: "0xshort" }, () => {
      expect(() => validateRelayerEnv()).toThrow(/RELAYER_PRIVATE_KEY/);
    });
  });

  it("throws when RELAYER_STELLAR_SECRET is missing", () => {
    withEnv({ ...BASE, RELAYER_STELLAR_SECRET: undefined }, () => {
      expect(() => validateRelayerEnv()).toThrow(/RELAYER_STELLAR_SECRET/);
    });
  });

  it("throws when no Ethereum RPC source is available", () => {
    withEnv(
      {
        ...BASE,
        SEPOLIA_RPC_URL: undefined,
        MAINNET_RPC_URL: undefined,
        INFURA_API_KEY: undefined,
      },
      () => {
        expect(() => validateRelayerEnv()).toThrow(/RPC/);
      }
    );
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
        expect(() => validateRelayerEnv()).toThrow(/MAINNET_AUDIT_CONFIRMED/);
      }
    );
  });

  it("accepts mainnet when MAINNET_AUDIT_CONFIRMED=true", () => {
    withEnv(
      {
        ...BASE,
        NETWORK_MODE: "mainnet",
        MAINNET_AUDIT_CONFIRMED: "true",
        MAINNET_RPC_URL: "https://mainnet.infura.io/v3/testkey",
        SEPOLIA_RPC_URL: undefined,
      },
      () => {
        const env = validateRelayerEnv();
        expect(env.networkMode).toBe("mainnet");
        expect(env.mainnetAuditConfirmed).toBe(true);
      }
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config
vi.mock("../src/config.js", () => {
  let mockCfg: any = {};
  return {
    loadConfig: () => mockCfg,
    __setMockConfig: (cfg: any) => { mockCfg = cfg; }
  };
});

// Mock viem
const mockReadContract = vi.fn();
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: mockReadContract
    })
  };
});

// Mock viem accounts
vi.mock("viem/accounts", () => ({
  privateKeyToAccount: () => ({ address: "0x123" })
}));

// Mock stellar-sdk
const mockSimulateTransaction = vi.fn();
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getAccount: vi.fn().mockResolvedValue({ sequence: "1" }),
        simulateTransaction: mockSimulateTransaction
      })),
      Api: {
        isSimulationError: (sim: any) => !!sim.error
      }
    },
    Keypair: {
      fromSecret: () => ({ publicKey: () => "G123" })
    },
    Contract: vi.fn().mockImplementation(() => ({
      call: vi.fn()
    })),
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({})
    })),
    nativeToScVal: vi.fn().mockReturnValue({})
  };
});

import { checkPreflight, buildJsonOutput } from "../src/commands/check.js";
import { __setMockConfig } from "../src/config.js";
import type { ResolverConfig } from "../src/config.js";
import { checkPreflight } from "../src/commands/check.js";
import * as configModule from "../src/config.js";

const __setMockConfig = (configModule as any).__setMockConfig;

describe("checkPreflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns configured: false if configs are missing", async () => {
    __setMockConfig({
      logLevel: "info",
      ethereum: {},
      soroban: {}
    });

    const results = await checkPreflight();
    expect(results).toHaveLength(2);
    expect(results[0].chain).toBe("ethereum");
    expect(results[0].configured).toBe(false);
    expect(results[1].chain).toBe("soroban");
    expect(results[1].configured).toBe(false);
  });

  it("reports active: true when registries confirm", async () => {
    __setMockConfig({
      logLevel: "info",
      ethereum: {
        resolverRegistry: "0xabc",
        resolverPrivateKey: "0xdef",
        rpcUrl: "http://localhost"
      },
      soroban: {
        resolverRegistry: "C123",
        resolverSecret: "S123",
        rpcUrl: "http://localhost",
        networkPassphrase: "Test"
      }
    });

    mockReadContract.mockResolvedValue(true);
    mockSimulateTransaction.mockResolvedValue({
      result: {
        retval: {
          switch: () => ({ name: "scvBool" }),
          b: () => true
        }
      }
    });

    const results = await checkPreflight();
    expect(results[0].chain).toBe("ethereum");
    expect(results[0].active).toBe(true);
    expect(results[1].chain).toBe("soroban");
    expect(results[1].active).toBe(true);
  });

  it("reports active: false when registries deny", async () => {
    __setMockConfig({
      logLevel: "info",
      ethereum: {
        resolverRegistry: "0xabc",
        resolverPrivateKey: "0xdef",
        rpcUrl: "http://localhost"
      },
      soroban: {
        resolverRegistry: "C123",
        resolverSecret: "S123",
        rpcUrl: "http://localhost",
        networkPassphrase: "Test"
      }
    });

    mockReadContract.mockResolvedValue(false);
    mockSimulateTransaction.mockResolvedValue({
      result: {
        retval: {
          switch: () => ({ name: "scvBool" }),
          b: () => false
        }
      }
    });

    const results = await checkPreflight();
    expect(results[0].active).toBe(false);
    expect(results[1].active).toBe(false);
  });

  it("reports active: unknown on RPC errors", async () => {
    __setMockConfig({
      logLevel: "info",
      ethereum: {
        resolverRegistry: "0xabc",
        resolverPrivateKey: "0xdef",
        rpcUrl: "http://localhost"
      },
      soroban: {
        resolverRegistry: "C123",
        resolverSecret: "S123",
        rpcUrl: "http://localhost",
        networkPassphrase: "Test"
      }
    });

    mockReadContract.mockRejectedValue(new Error("RPC timeout"));
    mockSimulateTransaction.mockResolvedValue({ error: "Simulate failed" });

    const results = await checkPreflight();
    expect(results[0].active).toBe("unknown");
    expect(results[1].active).toBe("unknown");
  });
});

describe("buildJsonOutput", () => {
  const baseConfig: ResolverConfig = {
    network: "testnet",
    pollIntervalMs: 15000,
    coordinatorUrl: "http://localhost:3001",
    logLevel: "info",
    ethereum: {
      rpcUrl: "http://localhost:8545",
      chainId: 11155111,
      htlcEscrow: "0x1111111111111111111111111111111111111111",
      resolverRegistry: "0x2222222222222222222222222222222222222222",
      resolverPrivateKey: "0xabc",
    },
    soroban: {
      rpcUrl: "http://localhost:8000",
      networkPassphrase: "Test SDF Network ; September 2015",
      horizonUrl: "http://localhost:8001",
      htlc: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBB4",
      resolverRegistry: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBB5",
      resolverSecret: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBB6",
    },
  };

  it("produces healthy status when all checks pass", () => {
    const results = [
      { chain: "ethereum", configured: true, active: true },
      { chain: "soroban", configured: true, active: true },
    ];
    const output = buildJsonOutput(results, baseConfig);
    expect(output.status).toBe("healthy");
    expect(output.networks).toHaveLength(2);
    expect(output.warnings).toHaveLength(0);
    expect(output.generatedAt).toBeTruthy();
    expect(() => JSON.parse(JSON.stringify(output))).not.toThrow();
  });

  it("produces degraded status when one chain is not active", () => {
    const results = [
      { chain: "ethereum", configured: true, active: true },
      { chain: "soroban", configured: true, active: false, reason: "Not staked" },
    ];
    const output = buildJsonOutput(results, baseConfig);
    expect(output.status).toBe("degraded");
    expect(output.networks[1].active).toBe(false);
    expect(output.networks[1].warnings).toContain("Resolver is not active. May need to stake/register.");
  });

  it("produces error status when a chain is not configured", () => {
    const results = [
      { chain: "ethereum", configured: false, active: "unknown", reason: "Missing registry" },
      { chain: "soroban", configured: true, active: true },
    ];
    const output = buildJsonOutput(results, baseConfig);
    expect(output.status).toBe("error");
    expect(output.networks[0].configured).toBe(false);
    expect(output.networks[0].warnings).toContain("Missing registry");
  });

  it("sets rpcReachable based on configured and active state", () => {
    const results = [
      { chain: "ethereum", configured: false, active: "unknown" },
      { chain: "soroban", configured: true, active: true },
    ];
    const output = buildJsonOutput(results, baseConfig);
    expect(output.networks[0].rpcReachable).toBe(false);
    expect(output.networks[1].rpcReachable).toBe(true);
  });

  it("sets resolverAddress from config when credentials are present", () => {
    const results = [
      { chain: "ethereum", configured: true, active: true },
      { chain: "soroban", configured: true, active: true },
    ];
    const output = buildJsonOutput(results, baseConfig);
    expect(output.networks[0].resolverAddress).toBe("0x123");
    expect(output.networks[1].resolverAddress).toBe("G123");
  });

  it("sets resolverAddress to null when credentials are missing", () => {
    const noCredsConfig: ResolverConfig = {
      ...baseConfig,
      ethereum: { ...baseConfig.ethereum, resolverPrivateKey: null },
      soroban: { ...baseConfig.soroban, resolverSecret: null },
    };
    const results = [
      { chain: "ethereum", configured: false, active: "unknown" },
      { chain: "soroban", configured: false, active: "unknown" },
    ];
    const output = buildJsonOutput(results, noCredsConfig);
    expect(output.networks[0].resolverAddress).toBeNull();
    expect(output.networks[1].resolverAddress).toBeNull();
  });

  it("emits no private keys in output", () => {
    const results = [
      { chain: "ethereum", configured: true, active: true },
      { chain: "soroban", configured: true, active: true },
    ];
    const output = buildJsonOutput(results, baseConfig);
    const json = JSON.stringify(output);
    expect(json).not.toContain("0xabc");
    expect(json).not.toContain("SAAAAA");
    expect(json).not.toContain("resolverPrivateKey");
    expect(json).not.toContain("resolverSecret");
  });
});

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

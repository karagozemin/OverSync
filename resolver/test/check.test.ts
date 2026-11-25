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
    nativeToScVal: vi.fn().mockReturnValue({}),
    scValToNative: (value: unknown) => value
  };
});

const mockEthereumStart = vi.fn().mockResolvedValue(undefined);
const mockSorobanStart = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/listeners/ethereum.js", () => ({
  EthereumListener: class { start = mockEthereumStart; }
}));
vi.mock("../src/listeners/soroban.js", () => ({
  SorobanListener: class { start = mockSorobanStart; }
}));
vi.mock("../src/network-agreement.js", () => ({
  checkCoordinatorNetwork: vi.fn().mockResolvedValue({ status: "ok" }),
  checkResolverNetworkAgreement: vi.fn().mockResolvedValue({ status: "ok", detail: "networks agree" })
}));

import { checkPreflight, buildJsonOutput, checkCommand } from "../src/commands/check.js";
import { runCommand } from "../src/commands/run.js";
import { __setMockConfig } from "../src/config.js";
import type { ResolverConfig } from "../src/config.js";

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

describe("deployment address check", () => {
  const ethereumEscrow = "0x1111111111111111111111111111111111111111";
  const ethereumRegistry = "0x2222222222222222222222222222222222222222";
  const sorobanRegistry = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBB5";
  const config: ResolverConfig = {
    network: "testnet",
    pollIntervalMs: 15000,
    coordinatorUrl: "http://localhost:3001",
    logLevel: "info",
    ethereum: {
      rpcUrl: "http://localhost:8545",
      chainId: 11155111,
      htlcEscrow: ethereumEscrow,
      resolverRegistry: ethereumRegistry,
      resolverPrivateKey: "0xsecret"
    },
    soroban: {
      rpcUrl: "http://localhost:8000",
      networkPassphrase: "Test SDF Network ; September 2015",
      horizonUrl: "http://localhost:8001",
      htlc: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBB4",
      resolverRegistry: sorobanRegistry,
      resolverSecret: "Ssecret"
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    __setMockConfig(config);
    mockReadContract.mockImplementation(({ functionName }) =>
      functionName === "resolverRegistry" ? ethereumRegistry : true
    );
    mockSimulateTransaction.mockResolvedValue({ result: { retval: sorobanRegistry } });
  });

  it("passes check and starts both listeners when both chain pointers match", async () => {
    mockSimulateTransaction
      .mockResolvedValueOnce({ result: { retval: sorobanRegistry } })
      .mockResolvedValueOnce({ result: { retval: { switch: () => ({ name: "scvBool" }), b: () => true } } })
      .mockResolvedValueOnce({ result: { retval: sorobanRegistry } })
      .mockResolvedValueOnce({ result: { retval: { switch: () => ({ name: "scvBool" }), b: () => true } } });

    await expect(checkCommand()).resolves.toBeUndefined();
    const on = vi.spyOn(process, "on").mockImplementation(() => process);
    try {
      await expect(runCommand()).resolves.toBeUndefined();
    } finally {
      on.mockRestore();
    }
    expect(mockEthereumStart).toHaveBeenCalledOnce();
    expect(mockSorobanStart).toHaveBeenCalledOnce();
    expect(mockReadContract).toHaveBeenCalledWith(expect.objectContaining({
      address: ethereumEscrow,
      functionName: "resolverRegistry"
    }));
  });

  it.each([
    ["Ethereum", "0x3333333333333333333333333333333333333333", sorobanRegistry, "ETH_RESOLVER_REGISTRY"],
    ["Soroban", ethereumRegistry, "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBB6", "SOROBAN_RESOLVER_REGISTRY"]
  ])("rejects %s mismatch before listeners start", async (_chain, evmOnChain, sorobanOnChain, field) => {
    mockReadContract.mockResolvedValue(evmOnChain);
    mockSimulateTransaction.mockResolvedValue({ result: { retval: sorobanOnChain } });

    await expect(checkCommand()).rejects.toThrow(field);
    await expect(runCommand()).rejects.toThrow(field);
    expect(mockEthereumStart).not.toHaveBeenCalled();
    expect(mockSorobanStart).not.toHaveBeenCalled();
    expect(mockReadContract).toHaveBeenCalledWith(expect.objectContaining({
      address: ethereumEscrow,
      functionName: "resolverRegistry"
    }));
    expect(mockReadContract).toHaveBeenCalledTimes(2);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(2);
    try {
      await checkCommand();
    } catch (error) {
      expect(String(error)).not.toContain("0xsecret");
      expect(String(error)).not.toContain("Ssecret");
    }
  });

  it("fails closed on an unreadable escrow without exposing RPC error details", async () => {
    mockReadContract.mockRejectedValue(new Error("RPC URL contained 0xsecret"));
    await expect(checkCommand()).rejects.toThrow("Could not read ETH_HTLC_ESCROW resolverRegistry");
    await expect(runCommand()).rejects.toThrow("Could not read ETH_HTLC_ESCROW resolverRegistry");
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
    expect(mockEthereumStart).not.toHaveBeenCalled();
    expect(mockSorobanStart).not.toHaveBeenCalled();
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

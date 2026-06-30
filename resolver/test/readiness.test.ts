import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock viem — only the surface used by pingEvmRpc is needed.
const mockGetChainId = vi.fn();
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ getChainId: mockGetChainId })),
    http: vi.fn(() => ({}))
  };
});

// Mock viem/accounts — derive a deterministic address from the key for assertions.
vi.mock("viem/accounts", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    privateKeyToAccount: vi.fn((key: `0x${string}`) => {
      if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
        throw new Error("Invalid private key");
      }
      // Deterministic address: first 20 bytes of the key as hex.
      return { address: `0x${key.slice(2, 42)}` as `0x${string}` };
    })
  };
});

// Mock @stellar/stellar-sdk — only the surface used by pingSorobanRpc + Keypair.
const mockGetLatestLedger = vi.fn();
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getLatestLedger: mockGetLatestLedger
      }))
    },
    Keypair: {
      fromSecret: vi.fn((secret: string) => {
        if (!secret.startsWith("S") || secret.length < 10) {
          throw new Error("Invalid seed");
        }
        return { publicKey: () => `G${secret.slice(1, 56)}` };
      })
    }
  };
});

// Mock dotenv so the module-level dotenvConfig() in readiness.ts does not
// leak any real-world .env values into process.env during test runs.
vi.mock("dotenv", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    config: vi.fn(() => ({ parsed: {} }))
  };
});

import { assessReadiness, readinessCommand } from "../src/commands/readiness.js";

const TEST_ENV_KEY = "0x" + "ab".repeat(32);
const TEST_ENV_STELLAR_SECRET = "S" + "A".repeat(55); // S + 55 base32 chars = 56 chars total
const TEST_PUBLIC_KEY = "G" + "A".repeat(55);
const TEST_EVM_ADDR = "0x" + "ab".repeat(20);
const TEST_EVM_REGISTRY = "0x" + "12".repeat(20);
const TEST_SOROBAN_REGISTRY = "C" + "A".repeat(55); // C + 55 base32 chars = 56 chars total

const FULL_ENV: Record<string, string> = {
  NETWORK_MODE: "testnet",
  SEPOLIA_RPC_URL: "https://example-sepolia-rpc.test",
  ETH_RESOLVER_REGISTRY_TESTNET: TEST_EVM_REGISTRY,
  RESOLVER_ETH_PRIVATE_KEY: TEST_ENV_KEY,
  SOROBAN_RPC_URL: "https://example-soroban.test",
  SOROBAN_RESOLVER_REGISTRY_TESTNET: TEST_SOROBAN_REGISTRY,
  RESOLVER_STELLAR_SECRET: TEST_ENV_STELLAR_SECRET
};

const MANAGED_ENV_KEYS = [
  "NETWORK_MODE",
  "SEPOLIA_RPC_URL",
  "MAINNET_RPC_URL",
  "ETHEREUM_RPC_URL",
  "INFURA_API_KEY",
  "ETH_RESOLVER_REGISTRY_TESTNET",
  "ETH_RESOLVER_REGISTRY_MAINNET",
  "RESOLVER_ETH_PRIVATE_KEY",
  "SOROBAN_RPC_URL",
  "SOROBAN_RESOLVER_REGISTRY_TESTNET",
  "SOROBAN_RESOLVER_REGISTRY_MAINNET",
  "RESOLVER_STELLAR_SECRET",
  "COORDINATOR_URL"
];

function setEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
}

function clearEnv(): void {
  for (const k of MANAGED_ENV_KEYS) {
    delete process.env[k];
  }
}

function findCheck(result: Awaited<ReturnType<typeof assessReadiness>>, id: string) {
  const c = result.checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check with id ${id}`);
  return c;
}

describe("assessReadiness", () => {
  beforeEach(() => {
    clearEnv();
    vi.clearAllMocks();
    mockGetChainId.mockResolvedValue(11_155_111);
    mockGetLatestLedger.mockResolvedValue({ sequence: 12345 });
  });

  afterEach(() => {
    clearEnv();
  });

  it("returns ready=true when all required env is valid and both RPCs respond", async () => {
    setEnv(FULL_ENV);
    const result = await assessReadiness();

    expect(result.network).toBe("testnet");
    expect(result.ready).toBe(true);
    expect(result.evm).toEqual({ address: TEST_EVM_ADDR, chainId: 11_155_111 });
    expect(result.stellar).toEqual({ publicKey: TEST_PUBLIC_KEY });

    const failing = result.checks.filter((c) => c.status === "fail").map((c) => c.id);
    expect(failing).toEqual([]);

    expect(findCheck(result, "evm-rpc").status).toBe("ok");
    expect(findCheck(result, "soroban-rpc").status).toBe("ok");
  });

  it("fails network-mode check when NETWORK_MODE is invalid", async () => {
    setEnv({ ...FULL_ENV, NETWORK_MODE: "stagenet" });
    const result = await assessReadiness();
    expect(findCheck(result, "network-mode").status).toBe("fail");
    expect(findCheck(result, "network-mode").detail).toContain("stagenet");
    expect(result.ready).toBe(false);
  });

  it("fails when EVM RPC is unreachable", async () => {
    setEnv(FULL_ENV);
    mockGetChainId.mockRejectedValue(new Error("Connection refused"));
    const result = await assessReadiness();
    expect(findCheck(result, "evm-rpc").status).toBe("fail");
    expect(findCheck(result, "evm-rpc").detail).toContain("Connection refused");
    expect(result.ready).toBe(false);
  });

  it("fails when EVM RPC returns wrong chainId", async () => {
    setEnv(FULL_ENV);
    mockGetChainId.mockResolvedValue(1); // mainnet id, while network is testnet
    const result = await assessReadiness();
    expect(findCheck(result, "evm-rpc").status).toBe("fail");
    expect(findCheck(result, "evm-rpc").detail).toContain("expected 11155111");
  });

  it("fails when Soroban RPC is unreachable", async () => {
    setEnv(FULL_ENV);
    mockGetLatestLedger.mockRejectedValue(new Error("host unreachable"));
    const result = await assessReadiness();
    expect(findCheck(result, "soroban-rpc").status).toBe("fail");
    expect(findCheck(result, "soroban-rpc").detail).toContain("host unreachable");
    expect(result.ready).toBe(false);
  });

  it("fails when EVM registry env var is missing", async () => {
    const env = { ...FULL_ENV };
    delete env.ETH_RESOLVER_REGISTRY_TESTNET;
    setEnv(env);
    const result = await assessReadiness();
    expect(findCheck(result, "evm-registry").status).toBe("fail");
    expect(findCheck(result, "evm-registry").detail).toContain("unset");
    expect(result.ready).toBe(false);
  });

  it("fails when EVM registry env var is malformed", async () => {
    setEnv({ ...FULL_ENV, ETH_RESOLVER_REGISTRY_TESTNET: "not-an-address" });
    const result = await assessReadiness();
    expect(findCheck(result, "evm-registry").status).toBe("fail");
    expect(findCheck(result, "evm-registry").detail).toContain("20-byte hex");
    expect(result.ready).toBe(false);
  });

  it("fails when RESOLVER_ETH_PRIVATE_KEY is missing", async () => {
    const env = { ...FULL_ENV };
    delete env.RESOLVER_ETH_PRIVATE_KEY;
    setEnv(env);
    const result = await assessReadiness();
    expect(findCheck(result, "evm-private-key").status).toBe("fail");
    expect(findCheck(result, "evm-private-key").detail).toContain("unset");
    expect(result.evm).toBeNull();
  });

  it("fails when RESOLVER_ETH_PRIVATE_KEY is malformed", async () => {
    setEnv({ ...FULL_ENV, RESOLVER_ETH_PRIVATE_KEY: "0xdeadbeef" });
    const result = await assessReadiness();
    expect(findCheck(result, "evm-private-key").status).toBe("fail");
    expect(findCheck(result, "evm-private-key").detail).toContain("32-byte hex");
  });

  it("fails when Soroban registry env var is missing", async () => {
    const env = { ...FULL_ENV };
    delete env.SOROBAN_RESOLVER_REGISTRY_TESTNET;
    setEnv(env);
    const result = await assessReadiness();
    expect(findCheck(result, "soroban-registry").status).toBe("fail");
    expect(findCheck(result, "soroban-registry").detail).toContain("unset");
    expect(result.ready).toBe(false);
  });

  it("fails when Soroban registry env var is malformed", async () => {
    setEnv({ ...FULL_ENV, SOROBAN_RESOLVER_REGISTRY_TESTNET: "not-a-contract-id" });
    const result = await assessReadiness();
    expect(findCheck(result, "soroban-registry").status).toBe("fail");
    expect(findCheck(result, "soroban-registry").detail).toContain("Stellar contract id");
  });

  it("fails when RESOLVER_STELLAR_SECRET is missing", async () => {
    const env = { ...FULL_ENV };
    delete env.RESOLVER_STELLAR_SECRET;
    setEnv(env);
    const result = await assessReadiness();
    expect(findCheck(result, "stellar-secret").status).toBe("fail");
    expect(findCheck(result, "stellar-secret").detail).toContain("unset");
    expect(result.stellar).toBeNull();
  });

  it("fails when RESOLVER_STELLAR_SECRET is malformed", async () => {
    setEnv({ ...FULL_ENV, RESOLVER_STELLAR_SECRET: "Gwrongformat" });
    const result = await assessReadiness();
    expect(findCheck(result, "stellar-secret").status).toBe("fail");
  });

  it("honors mainnet registry env vars when NETWORK_MODE=mainnet", async () => {
    setEnv({
      NETWORK_MODE: "mainnet",
      MAINNET_RPC_URL: "https://example-mainnet-rpc.test",
      ETH_RESOLVER_REGISTRY_MAINNET: TEST_EVM_REGISTRY,
      RESOLVER_ETH_PRIVATE_KEY: TEST_ENV_KEY,
      SOROBAN_RPC_URL: "https://example-soroban.test",
      SOROBAN_RESOLVER_REGISTRY_MAINNET: TEST_SOROBAN_REGISTRY,
      RESOLVER_STELLAR_SECRET: TEST_ENV_STELLAR_SECRET
    });
    mockGetChainId.mockResolvedValue(1);
    const result = await assessReadiness();
    expect(result.network).toBe("mainnet");
    expect(findCheck(result, "evm-rpc").status).toBe("ok");
    expect(findCheck(result, "evm-registry").label).toContain("ETH_RESOLVER_REGISTRY_MAINNET");
    expect(findCheck(result, "evm-registry").detail).toContain(TEST_EVM_REGISTRY);
    expect(findCheck(result, "soroban-registry").label).toContain("SOROBAN_RESOLVER_REGISTRY_MAINNET");
    expect(findCheck(result, "soroban-registry").detail).toContain(TEST_SOROBAN_REGISTRY);
  });

  it("warns on coordinator-url when COORDINATOR_URL is unset", async () => {
    setEnv(FULL_ENV); // FULL_ENV omits COORDINATOR_URL
    delete process.env.COORDINATOR_URL;
    const result = await assessReadiness();
    expect(findCheck(result, "coordinator-url").status).toBe("warn");
    expect(findCheck(result, "coordinator-url").detail).toContain("default");
  });

  it("marks coordinator-url as ok when COORDINATOR_URL is set", async () => {
    setEnv({ ...FULL_ENV, COORDINATOR_URL: "https://coord.example.test" });
    const result = await assessReadiness();
    expect(findCheck(result, "coordinator-url").status).toBe("ok");
    expect(findCheck(result, "coordinator-url").detail).toBe("https://coord.example.test");
  });

  it("always emits the dry-run assertion check", async () => {
    setEnv(FULL_ENV);
    const result = await assessReadiness();
    expect(findCheck(result, "dry-run-mode").status).toBe("ok");
    expect(findCheck(result, "dry-run-mode").detail.toLowerCase()).toContain("no funds");
  });
});

describe("readinessCommand", () => {
  beforeEach(() => {
    clearEnv();
    vi.clearAllMocks();
    mockGetChainId.mockResolvedValue(11_155_111);
    mockGetLatestLedger.mockResolvedValue({ sequence: 12345 });
  });

  afterEach(() => {
    clearEnv();
  });

  function captureLog(): { calls: string[][]; restore: () => void } {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    return {
      calls: spy.mock.calls,
      restore: () => spy.mockRestore()
    };
  }

  it("returns exit code 0 when fully ready", async () => {
    setEnv(FULL_ENV);
    const log = captureLog();
    const code = await readinessCommand();
    log.restore();
    expect(code).toBe(0);
    const output = log.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(output).toMatch(/READY/);
    expect(output).toContain(TEST_PUBLIC_KEY);
  });

  it("returns exit code 1 and lists failing checks when not ready", async () => {
    const env = { ...FULL_ENV };
    delete env.RESOLVER_STELLAR_SECRET;
    delete env.ETH_RESOLVER_REGISTRY_TESTNET;
    setEnv(env);
    const log = captureLog();
    const code = await readinessCommand();
    log.restore();
    expect(code).toBe(1);
    const output = log.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(output).toMatch(/NOT READY/);
    expect(output).toContain("stellar-secret");
    expect(output).toContain("evm-registry");
  });

  // SECURITY CONTRACT: the command must NEVER print the raw private key or secret.
  it("never prints RESOLVER_ETH_PRIVATE_KEY or RESOLVER_STELLAR_SECRET in any console output", async () => {
    setEnv(FULL_ENV);
    const log = captureLog();
    const code = await readinessCommand();
    log.restore();
    expect(code).toBe(0);
    const output = log.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(output).not.toContain(TEST_ENV_KEY);
    expect(output).not.toContain(TEST_ENV_KEY.slice(2)); // also catches without 0x prefix
    expect(output).not.toContain(TEST_ENV_STELLAR_SECRET);
  });

  it("never prints secrets even when checks fail and raw env values are pathological", async () => {
    setEnv({
      NETWORK_MODE: "testnet",
      SEPOLIA_RPC_URL: "https://example-sepolia-rpc.test",
      ETH_RESOLVER_REGISTRY_TESTNET: "not-a-real-address",
      RESOLVER_ETH_PRIVATE_KEY: TEST_ENV_KEY, // valid format
      SOROBAN_RPC_URL: "https://example-soroban.test",
      SOROBAN_RESOLVER_REGISTRY_TESTNET: "definitely-not-a-contract-id",
      RESOLVER_STELLAR_SECRET: TEST_ENV_STELLAR_SECRET
    });
    mockGetChainId.mockResolvedValue(1); // wrong chain id on testnet
    const log = captureLog();
    const code = await readinessCommand();
    log.restore();
    expect(code).toBe(1);
    const output = log.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(output).not.toContain(TEST_ENV_KEY);
    expect(output).not.toContain(TEST_ENV_STELLAR_SECRET);
  });
});

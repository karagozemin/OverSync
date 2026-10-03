import { describe, expect, it, vi } from "vitest";
import { loadConfig, validateNotMainnet, type LoadTestConfig } from "./config.js";
import { buildReport, redactErrorMessage, redactUrl, type SoakReport } from "./report.js";
import { generateOrders, type PlannedOrder } from "./orders.js";

describe("load-test: mainnet refusal", () => {
  const baseConfig: LoadTestConfig = {
    dryRun: false,
    seed: "test-seed",
    orders: 10,
    concurrency: 5,
    rateLimitPerSec: 3,
    timelockSeconds: 600,
    outputDir: "reports",
    sepoliaRpcUrl: "https://sepolia.infura.io/v3/test-key",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  };

  it("accepts a valid Sepolia testnet RPC URL", () => {
    const config = { ...baseConfig, sepoliaRpcUrl: "https://sepolia.infura.io/v3/abc123" };
    expect(() => validateNotMainnet(config)).not.toThrow();
  });

  it("accepts a valid Soroban testnet RPC URL", () => {
    const config = { ...baseConfig, sorobanRpcUrl: "https://soroban-testnet.stellar.org" };
    expect(() => validateNotMainnet(config)).not.toThrow();
  });

  it("rejects Infura mainnet RPC URL", () => {
    const config = { ...baseConfig, sepoliaRpcUrl: "https://mainnet.infura.io/v3/abc123" };
    expect(() => validateNotMainnet(config)).toThrow(/mainnet endpoint/);
    expect(() => validateNotMainnet(config)).toThrow(/https:\/\/mainnet\.infura\.io\/v3\/\*\*\*/);
  });

  it("rejects Alchemy mainnet RPC URL", () => {
    const config = { ...baseConfig, sepoliaRpcUrl: "https://eth-mainnet.alchemyapi.io/v2/abc123" };
    expect(() => validateNotMainnet(config)).toThrow(/mainnet endpoint/);
  });

  it("rejects generic Ethereum mainnet RPC patterns", () => {
    const mainnetUrls = [
      "https://eth-mainnet.example.com",
      "https://rpc.ankr.com/eth",
      "https://cloudflare-eth.com",
      "https://mainnet.rpc.gnosis.io",
    ];
    for (const url of mainnetUrls) {
      const config = { ...baseConfig, sepoliaRpcUrl: url };
      expect(() => validateNotMainnet(config)).toThrow(/mainnet endpoint/);
    }
  });

  it("rejects Stellar mainnet RPC URL", () => {
    const config = { ...baseConfig, sorobanRpcUrl: "https://soroban-mainnet.stellar.org" };
    expect(() => validateNotMainnet(config)).toThrow(/Stellar mainnet endpoint/);
  });

  it("rejects Stellar mainnet passphrase", () => {
    const config = { ...baseConfig };
    vi.stubEnv("STELLAR_NETWORK_PASSPHRASE", "Public Global Stellar Network ; September 2015");
    expect(() => validateNotMainnet(config)).toThrow(/mainnet passphrase/);
    vi.unstubAllEnvs();
  });

  it("accepts Stellar testnet passphrase", () => {
    const config = { ...baseConfig };
    vi.stubEnv("STELLAR_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");
    expect(() => validateNotMainnet(config)).not.toThrow();
    vi.unstubAllEnvs();
  });

  it("loadConfig rejects mainnet RPC when LOAD_TEST_LIVE=true", () => {
    vi.stubEnv("LOAD_TEST_LIVE", "true");
    vi.stubEnv("SEPOLIA_RPC_URL", "https://mainnet.infura.io/v3/abc123");
    vi.stubEnv("RESOLVER_ETH_PRIVATE_KEY", "0x1234");
    expect(() => loadConfig()).toThrow(/mainnet endpoint/);
    vi.unstubAllEnvs();
  });
});

describe("load-test: redaction", () => {
  it("redacts preimages (64 hex chars) in error messages", () => {
    const msg = "Error: preimage 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef not found";
    const redacted = redactErrorMessage(msg);
    expect(redacted).not.toContain("1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
    expect(redacted).toContain("0x***REDACTED***");
  });

  it("redacts URL userinfo (username:password@)", () => {
    const msg = "Failed to connect to https://user:pass@sepolia.infura.io/v3/key";
    const redacted = redactErrorMessage(msg);
    expect(redacted).not.toContain("user:pass");
    expect(redacted).toContain("https://***:***@sepolia.infura.io/v3/key");
  });

  it("redacts URL with only username", () => {
    const msg = "Error at https://api-key@sepolia.infura.io/v3/key";
    const redacted = redactErrorMessage(msg);
    expect(redacted).toContain("https://***:***@sepolia.infura.io/v3/key");
  });

  it("redacts URL with only password", () => {
    const msg = "Error at https://:secret@sepolia.infura.io/v3/key";
    const redacted = redactErrorMessage(msg);
    expect(redacted).toContain("https://***:***@sepolia.infura.io/v3/key");
  });

  it("redactUrl redacts userinfo in RPC URLs", () => {
    const url = "https://user:secret@sepolia.infura.io/v3/abc123";
    expect(redactUrl(url)).toBe("https://***:***@sepolia.infura.io/v3/abc123");
  });

  it("redactUrl leaves URLs without userinfo unchanged", () => {
    const url = "https://sepolia.infura.io/v3/abc123";
    expect(redactUrl(url)).toBe(url);
  });

  it("handles malformed URLs gracefully", () => {
    const msg = "Error with not-a-url";
    expect(redactErrorMessage(msg)).toBe(msg);
  });
});

describe("load-test: fixture-only order generation", () => {
  it("generates deterministic orders from seed only (no external deps)", () => {
    const orders1 = generateOrders("test-seed", 5, 600);
    const orders2 = generateOrders("test-seed", 5, 600);

    expect(orders1).toHaveLength(5);
    expect(orders2).toHaveLength(5);

    for (let i = 0; i < 5; i++) {
      expect(orders1[i].orderId).toBe(orders2[i].orderId);
      expect(orders1[i].preimage).toBe(orders2[i].preimage);
      expect(orders1[i].hashlock).toBe(orders2[i].hashlock);
      expect(orders1[i].direction).toBe(orders2[i].direction);
      expect(orders1[i].amountWei).toBe(orders2[i].amountWei);
      expect(orders1[i].resolverAction).toBe(orders2[i].resolverAction);
    }
  });

  it("different seeds produce different orders", () => {
    const orders1 = generateOrders("seed-a", 5, 600);
    const orders2 = generateOrders("seed-b", 5, 600);

    let different = false;
    for (let i = 0; i < 5; i++) {
      if (orders1[i].orderId !== orders2[i].orderId) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });

  it("orders contain preimages but they are not in the report", () => {
    const orders = generateOrders("test-seed", 3, 600);
    const results = orders.map((o, i) => ({
      index: i,
      orderId: o.orderId,
      direction: o.direction,
      resolverAction: o.resolverAction,
      status: "filled" as const,
      durationMs: 100,
    }));

    const config: LoadTestConfig = {
      dryRun: true,
      seed: "test-seed",
      orders: 3,
      concurrency: 1,
      rateLimitPerSec: 10,
      timelockSeconds: 600,
      outputDir: "reports",
      sepoliaRpcUrl: null,
      sorobanRpcUrl: null,
    };

    const report = buildReport(config, orders, results, 300);

    const reportJson = JSON.stringify(report);
    for (const order of orders) {
      expect(reportJson).not.toContain(order.preimage);
    }
  });
});

describe("load-test: report structure", () => {
  it("includes all latency summary fields", () => {
    const orders: PlannedOrder[] = [
      { index: 0, orderId: "0x1", preimage: "0x1", hashlock: "0x1", direction: "ETH_TO_XLM", amountWei: 1n, resolverAction: "fill", timelockSeconds: 600 },
      { index: 1, orderId: "0x2", preimage: "0x2", hashlock: "0x2", direction: "XLM_TO_ETH", amountWei: 1n, resolverAction: "timeout", timelockSeconds: 600 },
    ];

    const results = [
      { index: 0, orderId: "0x1", direction: "ETH_TO_XLM" as const, resolverAction: "fill" as const, status: "filled" as const, durationMs: 100 },
      { index: 1, orderId: "0x2", direction: "XLM_TO_ETH" as const, resolverAction: "timeout" as const, status: "timed-out" as const, durationMs: 200 },
    ];

    const config: LoadTestConfig = {
      dryRun: true,
      seed: "test-seed",
      orders: 2,
      concurrency: 1,
      rateLimitPerSec: 10,
      timelockSeconds: 600,
      outputDir: "reports",
      sepoliaRpcUrl: null,
      sorobanRpcUrl: null,
    };

    const report = buildReport(config, orders, results, 300);

    expect(report.summary).toHaveProperty("p50DurationMs");
    expect(report.summary).toHaveProperty("p95DurationMs");
    expect(report.summary).toHaveProperty("maxDurationMs");
    expect(report.summary.p50DurationMs).toBe(100);
    expect(report.summary.p95DurationMs).toBe(200);
    expect(report.summary.maxDurationMs).toBe(200);
  });

  it("report failures have redacted errors", () => {
    const orders: PlannedOrder[] = [
      { index: 0, orderId: "0x1", preimage: "0x1", hashlock: "0x1", direction: "ETH_TO_XLM", amountWei: 1n, resolverAction: "fill", timelockSeconds: 600 },
    ];

    const results = [
      { index: 0, orderId: "0x1", direction: "ETH_TO_XLM" as const, resolverAction: "fill" as const, status: "failed" as const, errorMessage: "Failed to connect to https://user:pass@sepolia.infura.io/v3/key with preimage 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", durationMs: 100 },
    ];

    const config: LoadTestConfig = {
      dryRun: true,
      seed: "test-seed",
      orders: 1,
      concurrency: 1,
      rateLimitPerSec: 10,
      timelockSeconds: 600,
      outputDir: "reports",
      sepoliaRpcUrl: null,
      sorobanRpcUrl: null,
    };

    const report = buildReport(config, orders, results, 100);

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].error).not.toContain("user:pass");
    expect(report.failures[0].error).not.toContain("1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
    expect(report.failures[0].error).toContain("0x***REDACTED***");
    expect(report.failures[0].error).toContain("***:***");
  });
});
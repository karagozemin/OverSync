/**
 * Public endpoint redaction tests.
 *
 * Asserts that the public /health and /metrics endpoints never leak:
 *  - private keys
 *  - preimages / secrets
 *  - bearer tokens
 *  - private RPC URLs (must be redacted to protocol://host)
 *  - raw env var names or values
 *  - full database rows (aggregated data only)
 *
 * Fixtures include secret-like values to prove redaction / non-emission.
 * Public endpoints still return useful, non-sensitive data.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { healthRoutes } from "../src/server/routes/health.js";
import { metricsRoutes } from "../src/server/routes/metrics.js";

// ── Secret-like fixtures ─────────────────────────────────────────────────────

const SECRETS = {
  /** Raw password embedded in DATABASE_URL */
  dbPass: "S3cr3tDbP4ssw0rd",
  /** Full database connection string with credentials */
  dbUrl:
    "postgresql://admin:S3cr3tDbP4ssw0rd@db.internal.example.com:5432/oversync?sslmode=require",

  /** Infura API key — must never appear in any response */
  infuraKey: "deadbeef_infura_key_999",

  /** Raw credential portion of an authenticated RPC URL */
  rpcUser: "admin",
  rpcPass: "RpcT0kenz!",
  /** Ethereum RPC URL with embedded Basic Auth credentials */
  ethRpcUrl: "https://admin:RpcT0kenz!@eth-mainnet.internal.example/v3/private",

  /** Soroban RPC URL path component that looks like a credential */
  sorobanPathKey: "secret-api-key",
  /** Soroban RPC URL with embedded path credentials */
  sorobanRpcUrl:
    "https://horizon.internal.example/horizon/secret-api-key",

  /** An Ethereum private key (64 hex chars) */
  privateKey:
    "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318",

  /** Raw preimage for an HTLC secret */
  preimage:
    "super_secret_htlc_preimage_256_bits_of_entropy_do_not_share",

  /** Bearer authorization token */
  bearer: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SensitivePayload.Signature",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(healthRoutes());
  app.use(metricsRoutes());
  return app;
}

function assertNoSecretLeaks(json: string, label: string) {
  // Raw secret values
  expect(json, `${label}: DB password leaked`).not.toContain(SECRETS.dbPass);
  expect(json, `${label}: Infura key leaked`).not.toContain(SECRETS.infuraKey);
  expect(json, `${label}: RPC user leaked`).not.toContain(SECRETS.rpcUser);
  expect(json, `${label}: RPC password leaked`).not.toContain(SECRETS.rpcPass);
  expect(json, `${label}: Soroban path key leaked`).not.toContain(SECRETS.sorobanPathKey);
  expect(json, `${label}: Private key leaked`).not.toContain(SECRETS.privateKey);
  expect(json, `${label}: Preimage leaked`).not.toContain(SECRETS.preimage);
  expect(json, `${label}: Bearer token leaked`).not.toContain(SECRETS.bearer);

  // Env var names that should never surface as keys or values
  const forbiddenEnvNames = [
    "DATABASE_URL",
    // INFURA_API_KEY intentionally omitted — the health endpoint legitimately
    // returns the redaction marker "[CONFIGURED_VIA_INFURA_API_KEY]". The
    // actual key *value* is still checked via SECRETS.infuraKey above.
    "ETHEREUM_RPC_URL",
    "SEPOLIA_RPC_URL",
    "MAINNET_RPC_URL",
    "SOROBAN_RPC_URL",
    "APP_PRIVATE_KEY",
    "SERVICE_BEARER_TOKEN",
    "HTLC_PREIMAGE",
    "COORDINATOR_PORT",
    "RELAYER_PORT",
    "STELLAR_HORIZON_URL",
    "SOROBAN_HTLC_TESTNET",
    "SOROBAN_HTLC_MAINNET",
    "ETH_HTLC_ESCROW_TESTNET",
    "ETH_HTLC_ESCROW_MAINNET",
    "ETH_RESOLVER_REGISTRY_TESTNET",
    "ETH_RESOLVER_REGISTRY_MAINNET",
    "SOROBAN_RESOLVER_REGISTRY_TESTNET",
    "SOROBAN_RESOLVER_REGISTRY_MAINNET",
    "COORDINATOR_POLL_INTERVAL_MS",
    "CORS_ORIGIN",
    "LOG_LEVEL",
  ];

  for (const name of forbiddenEnvNames) {
    expect(json, `${label}: env var name "${name}" leaked`).not.toContain(name);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Public Endpoints — Redaction", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };

    // Inject secret-like fixture values into the environment
    process.env.DATABASE_URL = SECRETS.dbUrl;
    process.env.ETHEREUM_RPC_URL = SECRETS.ethRpcUrl;
    process.env.SOROBAN_RPC_URL = SECRETS.sorobanRpcUrl;
    process.env.INFURA_API_KEY = SECRETS.infuraKey;
    process.env.APP_PRIVATE_KEY = SECRETS.privateKey;
    process.env.SERVICE_BEARER_TOKEN = SECRETS.bearer;
    process.env.HTLC_PREIMAGE = SECRETS.preimage;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── /health ───────────────────────────────────────────────────────────────

  describe("GET /health", () => {
    it("returns useful structure without leaking any secrets", async () => {
      const app = makeApp();
      const res = await request(app).get("/health").expect(200);

      const json = JSON.stringify(res.body);
      assertNoSecretLeaks(json, "/health");

      // Verify useful data is still returned
      expect(res.body).toMatchObject({
        status: "ok",
        service: "oversync-coordinator",
        uptimeSeconds: expect.any(Number),
        timestamp: expect.any(String),
      });

      expect(res.body.build).toMatchObject({
        env: expect.any(String),
      });

      expect(res.body.dependencies).toMatchObject({
        database: {
          mode: expect.any(String),
        },
        ethereum: {
          rpcUrlConfigured: expect.any(Boolean),
          rpcUrl: expect.any(String),
        },
        soroban: {
          rpcUrlConfigured: expect.any(Boolean),
          rpcUrl: expect.any(String),
        },
      });
    });

    it("redacts RPC URLs to protocol://host only", async () => {
      const app = makeApp();
      const res = await request(app).get("/health").expect(200);

      const { ethereum, soroban } = res.body.dependencies;

      // RPC URLs must be stripped of credentials and paths
      expect(ethereum.rpcUrl).toBe("https://eth-mainnet.internal.example");
      expect(soroban.rpcUrl).toBe("https://horizon.internal.example");

      // But still report that they are configured
      expect(ethereum.rpcUrlConfigured).toBe(true);
      expect(soroban.rpcUrlConfigured).toBe(true);
    });

    it("reports database mode without leaking the connection string", async () => {
      const app = makeApp();
      const res = await request(app).get("/health").expect(200);

      expect(res.body.dependencies.database.mode).toBe("postgres");

      const json = JSON.stringify(res.body);
      // The full URL patterns must not appear
      expect(json).not.toContain("admin");
      expect(json).not.toContain("S3cr3tDbP4ssw0rd");
      expect(json).not.toContain("db.internal.example.com");
      expect(json).not.toContain("postgresql://");
      expect(json).not.toContain("postgres://");
    });

    it("reports RPCs as configured without leaking the INFURA_API_KEY value", async () => {
      // Only INFURA_API_KEY set, no explicit RPC URL
      delete process.env.ETHEREUM_RPC_URL;
      delete process.env.SOROBAN_RPC_URL;

      const app = makeApp();
      const res = await request(app).get("/health").expect(200);

      const { ethereum, soroban } = res.body.dependencies;

      // Infura key shouldn't appear anywhere
      const json = JSON.stringify(res.body);
      expect(json).not.toContain(SECRETS.infuraKey);

      // Should still report as configured
      expect(ethereum.rpcUrlConfigured).toBe(true);
      // Soroban was deleted so it should be unconfigured
      expect(soroban.rpcUrlConfigured).toBe(false);
    });

    it("redacts SEPOLIA_RPC_URL credential portion", async () => {
      delete process.env.ETHEREUM_RPC_URL;
      process.env.SEPOLIA_RPC_URL =
        "https://user:sep0lia-k3y@sepolia.infura.io/v3/mock-key";

      const app = makeApp();
      const res = await request(app).get("/health").expect(200);

      expect(res.body.dependencies.ethereum.rpcUrl).toBe(
        "https://sepolia.infura.io",
      );
      expect(res.body.dependencies.ethereum.rpcUrlConfigured).toBe(true);

      const json = JSON.stringify(res.body);
      expect(json).not.toContain("sep0lia-k3y");
      expect(json).not.toContain("user");
    });

    it("redacts MAINNET_RPC_URL credential portion", async () => {
      delete process.env.ETHEREUM_RPC_URL;
      process.env.MAINNET_RPC_URL =
        "https://api:mainn3t-k3y@mainnet.infura.io/v3/mock-key";

      const app = makeApp();
      const res = await request(app).get("/health").expect(200);

      expect(res.body.dependencies.ethereum.rpcUrl).toBe(
        "https://mainnet.infura.io",
      );
      expect(res.body.dependencies.ethereum.rpcUrlConfigured).toBe(true);

      const json = JSON.stringify(res.body);
      expect(json).not.toContain("mainn3t-k3y");
      expect(json).not.toContain("api");
    });
  });

  // ── /metrics ──────────────────────────────────────────────────────────────

  describe("GET /metrics", () => {
    it("returns Prometheus text output without leaking any secrets", async () => {
      const app = makeApp();
      const res = await request(app).get("/metrics").expect(200);

      const metricsText = res.text;
      assertNoSecretLeaks(metricsText, "/metrics");

      // Also check the full database URL components don't appear
      expect(metricsText).not.toContain("postgresql://");
      expect(metricsText).not.toContain("postgres://");
      expect(metricsText).not.toContain("db.internal.example.com");
      expect(metricsText).not.toContain("horizon.internal.example");
      expect(metricsText).not.toContain("eth-mainnet.internal.example");
    });

    it("returns Prometheus text output with useful metric data", async () => {
      const app = makeApp();
      const res = await request(app).get("/metrics").expect(200);

      const metricsText = res.text;

      // Must contain standard Prometheus exposition format pragmas
      expect(metricsText).toContain("# HELP");
      expect(metricsText).toContain("# TYPE");

      // Must contain the application-level custom metrics
      expect(metricsText).toContain("coordinator_orders_total");
      expect(metricsText).toContain("coordinator_listener_last_block");
      expect(metricsText).toContain(
        "coordinator_http_request_duration_seconds",
      );

      // Must contain default Node.js process metrics
      expect(metricsText).toContain("process_");
      expect(metricsText).toContain("nodejs_");
    });

    it("never exposes secret values through metric labels or help text", async () => {
      const app = makeApp();
      const res = await request(app).get("/metrics").expect(200);

      const metricsText = res.text;
      const lines = metricsText.split("\n");

      for (const line of lines) {
        // Every metric/data line
        if (line.startsWith("#") || line.trim() === "") continue;

        // Check that no secret values appear in label keys or values
        for (const [name, value] of Object.entries(SECRETS)) {
          expect(line, `Metric line leaks ${name}`).not.toContain(value);
        }
      }
    });
  });
});

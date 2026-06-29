import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { healthRoutes } from "../src/server/routes/health.js";
import type { HealthRouteDeps } from "../src/server/routes/health.js";
import type { CoordinatorConfig } from "../src/config.js";

// ─── Minimal stub config (no live RPC, no real DB) ──────────────────────────

const TESTNET_CONFIG: CoordinatorConfig = {
  network: "testnet",
  port: 3001,
  databaseUrl: "file:./test.db",
  logLevel: "silent" as CoordinatorConfig["logLevel"],
  corsOrigin: "*",
  pollIntervalMs: 15_000,
  ethereum: {
    rpcUrl: "https://example.com/rpc",
    chainId: 11_155_111,
    htlcEscrow: null,
    resolverRegistry: null,
  },
  soroban: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    htlcContract: null,
    resolverRegistry: null,
  },
};

const MAINNET_CONFIG: CoordinatorConfig = {
  ...TESTNET_CONFIG,
  network: "mainnet",
  ethereum: {
    ...TESTNET_CONFIG.ethereum,
    chainId: 1,
  },
  soroban: {
    ...TESTNET_CONFIG.soroban,
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
};

function makeApp(deps: HealthRouteDeps) {
  const app = express();
  app.use(healthRoutes(deps));
  return app;
}

// ─── /health ────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with service name and timestamp", async () => {
    const app = makeApp({
      config: TESTNET_CONFIG,
      db: { isReady: () => true },
    });

    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("oversync-coordinator");
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof res.body.uptimeSeconds).toBe("number");
  });
});

// ─── /readiness — healthy ───────────────────────────────────────────────────

describe("GET /readiness — healthy testnet", () => {
  const deps: HealthRouteDeps = {
    config: TESTNET_CONFIG,
    db: { isReady: () => true },
    wsEnabled: false,
  };

  it("returns 200", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.status).toBe(200);
  });

  it("includes service name and version", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.service).toBe("oversync-coordinator");
    expect(typeof res.body.version).toBe("string");
  });

  it("reports networkMode as testnet", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.networkMode).toBe("testnet");
  });

  it("reports Ethereum chain id and name for Sepolia", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.ethereum.chainId).toBe(11_155_111);
    expect(res.body.ethereum.chainName).toBe("sepolia");
  });

  it("reports Stellar network label derived from passphrase", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.stellar.network).toBe("testnet");
  });

  it("reports database reachable: true", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.database.reachable).toBe(true);
  });

  it("reports websocket enabled: false", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.websocket.enabled).toBe(false);
  });

  it("includes ISO timestamp", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── /readiness — mainnet ───────────────────────────────────────────────────

describe("GET /readiness — healthy mainnet", () => {
  const deps: HealthRouteDeps = {
    config: MAINNET_CONFIG,
    db: { isReady: () => true },
    wsEnabled: true,
  };

  it("reports networkMode as mainnet", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.networkMode).toBe("mainnet");
  });

  it("reports Ethereum chainId 1 and chainName mainnet", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.ethereum.chainId).toBe(1);
    expect(res.body.ethereum.chainName).toBe("mainnet");
  });

  it("reports Stellar network label as mainnet", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.stellar.network).toBe("mainnet");
  });

  it("reports websocket enabled: true when wsEnabled is true", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.websocket.enabled).toBe(true);
  });
});

// ─── /readiness — unhealthy DB ──────────────────────────────────────────────

describe("GET /readiness — database unreachable", () => {
  const deps: HealthRouteDeps = {
    config: TESTNET_CONFIG,
    db: { isReady: () => false },
  };

  it("returns 503 when db is not reachable", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.status).toBe(503);
  });

  it("still returns JSON with database.reachable: false", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.database.reachable).toBe(false);
    expect(res.body.service).toBe("oversync-coordinator");
  });
});

// ─── Secret-leak guardrails ──────────────────────────────────────────────────

describe("GET /readiness — no secrets emitted", () => {
  const deps: HealthRouteDeps = {
    config: TESTNET_CONFIG,
    db: { isReady: () => true },
  };

  it("does not include soroban RPC URL", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("soroban-testnet.stellar.org");
  });

  it("does not include Ethereum RPC URL", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("example.com/rpc");
  });

  it("does not include full Stellar network passphrase", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("Test SDF Network ; September 2015");
  });

  it("does not include databaseUrl", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("test.db");
    expect(body).not.toContain("DATABASE_URL");
  });

  it("does not include corsOrigin", async () => {
    const res = await request(makeApp(deps)).get("/readiness");
    expect(res.body.corsOrigin).toBeUndefined();
  });
});

// ─── Endpoint isolation — no side effects on order routes ───────────────────

describe("GET /readiness — does not affect order or secret routes", () => {
  it("readiness route does not return order-shaped response", async () => {
    const deps: HealthRouteDeps = {
      config: TESTNET_CONFIG,
      db: { isReady: () => true },
    };
    const res = await request(makeApp(deps)).get("/readiness");
    // Order routes return arrays or order objects; readiness returns a
    // flat service descriptor — confirm the shape is correct.
    expect(Array.isArray(res.body)).toBe(false);
    expect(res.body.orders).toBeUndefined();
    expect(res.body.secret).toBeUndefined();
    expect(res.body.hashlock).toBeUndefined();
  });
});
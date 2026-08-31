import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { healthRoutes } from "../src/server/routes/health.js";

function makeApp(options?: { limit?: number; windowMs?: number; now?: () => number }) {
  const app = express();
  app.use(healthRoutes(options));
  return app;
}

describe("GET /readiness", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.DATABASE_URL = "file:./oversync.db";
    process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
    process.env.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    delete process.env.NETWORK_MODE;
    delete process.env.ETHEREUM_CHAIN_ID;
    delete process.env.WS_ENABLED;
    delete process.env.WEBSOCKET_ENABLED;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it("returns 200 with service name and version", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.service).toBe("oversync-coordinator");
    expect(typeof res.body.version).toBe("string");
  });

  it("defaults networkMode to testnet", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.networkMode).toBe("testnet");
  });

  it("uses NETWORK_MODE env override for mainnet", async () => {
    process.env.NETWORK_MODE = "mainnet";
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.networkMode).toBe("mainnet");
  });

  it("defaults Ethereum chain to Sepolia in testnet mode", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.ethereum.chainId).toBe(11_155_111);
    expect(res.body.ethereum.chainName).toBe("sepolia");
  });

  it("defaults Ethereum chain to mainnet when NETWORK_MODE=mainnet", async () => {
    process.env.NETWORK_MODE = "mainnet";
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.ethereum.chainId).toBe(1);
    expect(res.body.ethereum.chainName).toBe("mainnet");
  });

  it("honours explicit ETHEREUM_CHAIN_ID override", async () => {
    process.env.ETHEREUM_CHAIN_ID = "17000";
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.ethereum.chainId).toBe(17_000);
    expect(res.body.ethereum.chainName).toBe("holesky");
  });

  it("reports Stellar network label as testnet from passphrase", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.stellar.network).toBe("testnet");
  });

  it("reports Stellar network label as mainnet from passphrase", async () => {
    process.env.STELLAR_NETWORK_PASSPHRASE =
      "Public Global Stellar Network ; September 2015";
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.stellar.network).toBe("mainnet");
  });

  it("reports stellar.rpcConfigured true when SOROBAN_RPC_URL is set", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.stellar.rpcConfigured).toBe(true);
  });

  it("reports stellar.rpcConfigured false when SOROBAN_RPC_URL is absent", async () => {
    delete process.env.SOROBAN_RPC_URL;
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.stellar.rpcConfigured).toBe(false);
  });

  it("reports database.reachable true for a recognised sqlite URL", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.database.reachable).toBe(true);
  });

  it("reports database.reachable false when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.database.reachable).toBe(false);
  });

  it("reports websocket.enabled false by default", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.websocket.enabled).toBe(false);
  });

  it("reports websocket.enabled true when WS_ENABLED=true", async () => {
    process.env.WS_ENABLED = "true";
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.websocket.enabled).toBe(true);
  });

  it("includes an ISO timestamp", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("never includes the Soroban RPC URL itself", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain("soroban-testnet.stellar.org");
  });

  it("never includes the full Stellar network passphrase", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain("Test SDF Network ; September 2015");
  });

  it("never includes DATABASE_URL", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain("oversync.db");
    expect(json).not.toContain("DATABASE_URL");
  });

  it("never includes an Ethereum RPC URL credentials", async () => {
    process.env.ETHEREUM_RPC_URL = "https://USER:SECRET@rpc.example.com/private-rpc";
    const res = await request(makeApp()).get("/readiness").expect(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("USER");
  });

  it("does not return order-shaped fields", async () => {
    const res = await request(makeApp()).get("/readiness").expect(200);
    expect(res.body.orders).toBeUndefined();
    expect(res.body.secret).toBeUndefined();
    expect(res.body.hashlock).toBeUndefined();
  });

  it("returns a stable 429 response after the per-client diagnostic limit", async () => {
    let timestamp = 1_000;
    const app = makeApp({ limit: 2, windowMs: 10_000, now: () => timestamp });
    await request(app).get("/readiness").expect(200);
    await request(app).get("/readiness").expect(200);
    const res = await request(app).get("/readiness").expect(429);
    expect(res.body).toMatchObject({ error: "rate_limited", retryAfterSeconds: 10 });
    expect(res.headers["retry-after"]).toBe("10");
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
    timestamp += 10_000;
    await request(app).get("/readiness").expect(200);
  });
});

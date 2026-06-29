import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { healthRoutes } from "../src/server/routes/health";

function makeApp() {
  const app = express();
  app.use(healthRoutes());
  return app;
}

describe("GET /health", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };

    // Explicitly seed base defaults so tests are isolated from host machine configurations
    process.env.DATABASE_URL = "file:./oversync.db";
    process.env.SEPOLIA_RPC_URL = "https://sepolia.infura.io/v3/mock-key";
    process.env.SOROBAN_RPC_URL = "https://horizon-testnet.stellar.org";
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it("includes default metadata and safe dependency status", async () => {
    delete process.env.npm_package_version;
    delete process.env.NETWORK_MODE;

    const app = makeApp();
    const res = await request(app).get("/health").expect(200);

    expect(res.body).toMatchObject({
      status: "ok",
      service: "oversync-coordinator",
      uptimeSeconds: expect.any(Number),
      timestamp: expect.any(String),
      version: "0.1.0",
    });

    expect(res.body).toHaveProperty("build");
    expect(res.body.build).toMatchObject({
      commit: null,
      env: "testnet",
    });

    expect(res.body).toHaveProperty("dependencies");
    expect(res.body.dependencies).toMatchObject({
      database: {
        mode: "sqlite",
      },
      ethereum: {
        rpcUrlConfigured: true,
      },
      soroban: {
        rpcUrlConfigured: true,
      },
    });

    // Ensure we never leak system credential string representations
    const json = JSON.stringify(res.body);
    expect(json).not.toContain("INFURA_API_KEY");
    expect(json).not.toContain("SEPOLIA_RPC_URL");
    expect(json).not.toContain("MAINNET_RPC_URL");
    expect(json).not.toContain("ETHEREUM_RPC_URL");
  });

  it("uses env override for build env", async () => {
    process.env.NETWORK_MODE = "mainnet";

    const app = makeApp();
    const res = await request(app).get("/health").expect(200);

    expect(res.body.build.env).toBe("mainnet");
  });

  it("redacts RPC credentials from dependency metadata", async () => {
    process.env.ETHEREUM_RPC_URL =
      "https://USER:SECRET@rpc.example.com/private-rpc";
    process.env.SOROBAN_RPC_URL = "https://example.com/horizon/SECRETKEY";

    const app = makeApp();
    const res = await request(app).get("/health").expect(200);

    expect(res.body.dependencies.ethereum.rpcUrl).toBe(
      "https://rpc.example.com",
    );
    expect(res.body.dependencies.soroban.rpcUrl).toBe("https://example.com");

    const json = JSON.stringify(res.body);
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("USER");
    expect(json).not.toContain("SECRETKEY");
  });
});

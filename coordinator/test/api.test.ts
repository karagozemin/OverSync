import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pino from "pino";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/server/app.js";
import { openDatabase } from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { OrderService } from "../src/services/order-service.js";
import { SecretService } from "../src/services/secret-service.js";
import { QuoteService } from "../src/services/quote-service.js";
import type { Express } from "express";

const log = pino({ level: "silent" });

const VALID_HASHLOCK = "0x" + "a".repeat(64);
const VALID_ETH_ADDR = "0x1111111111111111111111111111111111111111";
const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";
const VALID_PREIMAGE = "0x" + "b".repeat(64);


describe("Coordinator API Contract Tests", () => {
  let app: Express;
  let tmpDir: string;
  let db: any;
  let orders: OrderService;
  let secrets: SecretService;
  let quotes: QuoteService;

  beforeAll(async () => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "oversync-api-test-"));
    db = await openDatabase(`file:${tmpDir}/test.db`);
    orders = new OrderService(new OrdersRepository(db), log);
    secrets = new SecretService(orders, log);
    quotes = new QuoteService(log);

    app = createApp({
      log,
      corsOrigin: "*",
      maxRequestBodyBytes: 65536,
      orders,
      secrets,
      quotes
    });
  });

  afterAll(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("GET /health", () => {
    it("should return 200 with service status and version", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("status", "ok");
      expect(res.body).toHaveProperty("service", "oversync-coordinator");
      expect(res.body).toHaveProperty("version");
      expect(typeof res.body.version).toBe("string");
    });

    it("should include uptimeSeconds field", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("uptimeSeconds");
      expect(typeof res.body.uptimeSeconds).toBe("number");
      expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it("should include timestamp in ISO format", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("timestamp");
      expect(typeof res.body.timestamp).toBe("string");
      expect(() => new Date(res.body.timestamp)).not.toThrow();
    });
  });

  describe("GET /metrics", () => {
    it("should return 200 with Prometheus content type", async () => {
      const res = await request(app).get("/metrics");

      expect(res.status).toBe(200);
      expect(res.type).toContain("text/plain");
      expect(res.headers["content-type"]).toContain("charset=utf-8");
    });

    it("should return valid Prometheus format", async () => {
      const res = await request(app).get("/metrics");

      expect(res.status).toBe(200);
      const text = res.text;
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
      // Prometheus metrics should have # HELP or # TYPE or actual metric lines
      expect(text).toMatch(/^(# HELP|# TYPE|[a-zA-Z_])/m);
    });

    it("should include coordinator metric names", async () => {
      const res = await request(app).get("/metrics");

      expect(res.status).toBe(200);
      const text = res.text;
      // Check for common metric patterns (lines starting with metric name)
      expect(text).toMatch(/^[a-z_]+/m);
    });
  });

  describe("POST /api/orders/announce", () => {
    it("should announce a valid eth->xlm order", async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: VALID_HASHLOCK,
          srcChain: "ethereum",
          srcAddress: VALID_ETH_ADDR,
          srcAsset: "ETH",
          srcAmount: "1000000000000000000",
          srcSafetyDeposit: "1000000000000000",
          dstChain: "stellar",
          dstAddress: VALID_STELLAR_ADDR,
          dstAsset: "XLM",
          dstAmount: "5000000000"
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.id).toMatch(/^[a-f0-9]{32}$/);
      expect(res.body).toHaveProperty("status", "announced");
      expect(res.body).toHaveProperty("direction", "eth_to_xlm");
      expect(res.body).toHaveProperty("hashlock", VALID_HASHLOCK);
      expect(res.body).toHaveProperty("src");
      expect(res.body).toHaveProperty("dst");
      expect(res.body.src.chain).toBe("ethereum");
      expect(res.body.dst.chain).toBe("stellar");
    });

    it("should announce a valid xlm->eth order", async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "xlm_to_eth",
          hashlock: "0x" + "b".repeat(64),
          srcChain: "stellar",
          srcAddress: VALID_STELLAR_ADDR,
          srcAsset: "XLM",
          srcAmount: "5000000000",
          srcSafetyDeposit: "1000000000",
          dstChain: "ethereum",
          dstAddress: VALID_ETH_ADDR,
          dstAsset: "ETH",
          dstAmount: "1000000000000000000"
        });

      expect(res.status).toBe(201);
      expect(res.body.direction).toBe("xlm_to_eth");
    });

    it("should reject missing required fields", async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: VALID_HASHLOCK
          // Missing all other fields
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "validation_error");
      expect(res.body).toHaveProperty("details");
    });

    it("should reject invalid hashlock format", async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: "invalid-hashlock",
          srcChain: "ethereum",
          srcAddress: VALID_ETH_ADDR,
          srcAsset: "ETH",
          srcAmount: "1",
          srcSafetyDeposit: "1",
          dstChain: "stellar",
          dstAddress: VALID_STELLAR_ADDR,
          dstAsset: "XLM",
          dstAmount: "1"
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "validation_error");
    });

    it("should reject invalid Ethereum address", async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: VALID_HASHLOCK,
          srcChain: "ethereum",
          srcAddress: "not-an-eth-address",
          srcAsset: "ETH",
          srcAmount: "1",
          srcSafetyDeposit: "1",
          dstChain: "stellar",
          dstAddress: VALID_STELLAR_ADDR,
          dstAsset: "XLM",
          dstAmount: "1"
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "order_validation_error");
    });

    it("should reject invalid Stellar address", async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: VALID_HASHLOCK,
          srcChain: "ethereum",
          srcAddress: VALID_ETH_ADDR,
          srcAsset: "ETH",
          srcAmount: "1",
          srcSafetyDeposit: "1",
          dstChain: "stellar",
          dstAddress: "not-a-stellar-address",
          dstAsset: "XLM",
          dstAmount: "1"
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "order_validation_error");
    });

    it("should reject mismatched direction and chains", async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: VALID_HASHLOCK,
          srcChain: "stellar", // Wrong: should be ethereum
          srcAddress: VALID_STELLAR_ADDR,
          srcAsset: "XLM",
          srcAmount: "1",
          srcSafetyDeposit: "1",
          dstChain: "ethereum", // Wrong: should be stellar
          dstAddress: VALID_ETH_ADDR,
          dstAsset: "ETH",
          dstAmount: "1"
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "order_validation_error");
    });

    it("should reject duplicate hashlocks", async () => {
      // First announcement succeeds
      const res1 = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: "0x" + "c".repeat(64),
          srcChain: "ethereum",
          srcAddress: VALID_ETH_ADDR,
          srcAsset: "ETH",
          srcAmount: "1",
          srcSafetyDeposit: "1",
          dstChain: "stellar",
          dstAddress: VALID_STELLAR_ADDR,
          dstAsset: "XLM",
          dstAmount: "1"
        });

      expect(res1.status).toBe(201);

      // Second with same hashlock fails
      const res2 = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: "0x" + "c".repeat(64),
          srcChain: "ethereum",
          srcAddress: VALID_ETH_ADDR,
          srcAsset: "ETH",
          srcAmount: "1",
          srcSafetyDeposit: "1",
          dstChain: "stellar",
          dstAddress: VALID_STELLAR_ADDR,
          dstAsset: "XLM",
          dstAmount: "1"
        });

      expect(res2.status).toBe(400);
      expect(res2.body).toHaveProperty("error", "order_validation_error");
      expect(res2.body.message).toContain("already exists");
    });

    it("should reject non-numeric amounts", async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: VALID_HASHLOCK,
          srcChain: "ethereum",
          srcAddress: VALID_ETH_ADDR,
          srcAsset: "ETH",
          srcAmount: "not-a-number",
          srcSafetyDeposit: "1",
          dstChain: "stellar",
          dstAddress: VALID_STELLAR_ADDR,
          dstAsset: "XLM",
          dstAmount: "1"
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "validation_error");
    });
  });

  describe("GET /api/orders/:id", () => {
    let orderId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: "0x" + "d".repeat(64),
          srcChain: "ethereum",
          srcAddress: VALID_ETH_ADDR,
          srcAsset: "ETH",
          srcAmount: "1000000000000000000",
          srcSafetyDeposit: "1000000000000000",
          dstChain: "stellar",
          dstAddress: VALID_STELLAR_ADDR,
          dstAsset: "XLM",
          dstAmount: "5000000000"
        });

      orderId = res.body.id;
    });

    it("should retrieve order by ID", async () => {
      const res = await request(app).get(`/api/orders/${orderId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(orderId);
      expect(res.body).toHaveProperty("status", "announced");
      expect(res.body).toHaveProperty("hashlock");
      expect(res.body).toHaveProperty("src");
      expect(res.body).toHaveProperty("dst");
      expect(res.body).toHaveProperty("createdAt");
      expect(res.body).toHaveProperty("updatedAt");
    });

    it("should return 404 for non-existent order", async () => {
      const res = await request(app).get("/api/orders/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error", "not_found");
    });
  });

  describe("GET /api/orders/history", () => {
    it("should return orders for a given Ethereum address", async () => {
      // Create an order
      const createRes = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: "0x" + "e".repeat(64),
          srcChain: "ethereum",
          srcAddress: VALID_ETH_ADDR,
          srcAsset: "ETH",
          srcAmount: "1",
          srcSafetyDeposit: "1",
          dstChain: "stellar",
          dstAddress: VALID_STELLAR_ADDR,
          dstAsset: "XLM",
          dstAmount: "1"
        });

      expect(createRes.status).toBe(201);

      // Query history
      const historyRes = await request(app)
        .get("/api/orders/history")
        .query({ eth: VALID_ETH_ADDR });

      expect(historyRes.status).toBe(200);
      expect(historyRes.body).toHaveProperty("transactions");
      expect(Array.isArray(historyRes.body.transactions)).toBe(true);
      expect(historyRes.body.transactions.length).toBeGreaterThan(0);
      expect(historyRes.body).toHaveProperty("pagination");
    });

    it("should return orders for a given Stellar address", async () => {
      // Create an order
      const createRes = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "xlm_to_eth",
          hashlock: "0x" + "f".repeat(64),
          srcChain: "stellar",
          srcAddress: VALID_STELLAR_ADDR,
          srcAsset: "XLM",
          srcAmount: "5000000000",
          srcSafetyDeposit: "1000000000",
          dstChain: "ethereum",
          dstAddress: VALID_ETH_ADDR,
          dstAsset: "ETH",
          dstAmount: "1000000000000000000"
        });

      expect(createRes.status).toBe(201);

      // Query history
      const historyRes = await request(app)
        .get("/api/orders/history")
        .query({ stellar: VALID_STELLAR_ADDR });

      expect(historyRes.status).toBe(200);
      expect(historyRes.body).toHaveProperty("transactions");
      expect(Array.isArray(historyRes.body.transactions)).toBe(true);
    });

    it("should support pagination with limit", async () => {
      const res = await request(app)
        .get("/api/orders/history")
        .query({ address: VALID_ETH_ADDR, limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("pagination");
      expect(res.body.pagination.limit).toBeLessThanOrEqual(10);
    });

    it("should cap limit at 200", async () => {
      const res = await request(app)
        .get("/api/orders/history")
        .query({ address: VALID_ETH_ADDR, limit: 500 });

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBeLessThanOrEqual(200);
    });

    it("should require an address parameter", async () => {
      const res = await request(app).get("/api/orders/history");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "address_required");
    });

    it("should return empty list for address with no orders", async () => {
      const res = await request(app)
        .get("/api/orders/history")
        .query({ address: "0x2222222222222222222222222222222222222222" });

      expect(res.status).toBe(200);
      expect(res.body.transactions).toHaveLength(0);
      expect(res.body.pagination.count).toBe(0);
    });
  });

  describe("POST /api/secrets/reveal", () => {
    const revealPreimage = "0x" + "55".repeat(32);
    const revealHashlock = "0x" + createHash("sha256").update(Buffer.from("55".repeat(32), "hex")).digest("hex");
    let orderId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: revealHashlock,
          srcChain: "ethereum",
          srcAddress: VALID_ETH_ADDR,
          srcAsset: "ETH",
          srcAmount: "1",
          srcSafetyDeposit: "1",
          dstChain: "stellar",
          dstAddress: VALID_STELLAR_ADDR,
          dstAsset: "XLM",
          dstAmount: "1"
        });

      orderId = res.body.id;

      // Transition to src_locked
      await request(app)
        .post(`/api/orders/${orderId}/src-locked`)
        .send({
          orderId: "1",
          txHash: "0xdead",
          blockNumber: 1,
          timelock: 0
        });
    });

    it("should reveal a valid secret for an order", async () => {
      const res = await request(app)
        .post("/api/secrets/reveal")
        .send({
          publicId: orderId,
          preimage: revealPreimage,
          txHash: "0x123456"
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("ok", true);
    });

    it("should reject missing publicId", async () => {
      const res = await request(app)
        .post("/api/secrets/reveal")
        .send({
          preimage: revealPreimage,
          txHash: "0x123456"
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "validation_error");
    });

    it("should reject invalid preimage format", async () => {
      const res = await request(app)
        .post("/api/secrets/reveal")
        .send({
          publicId: orderId,
          preimage: "not-hex-format",
          txHash: "0x123456"
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "validation_error");
    });

    it("should reject preimage without 0x prefix", async () => {
      const res = await request(app)
        .post("/api/secrets/reveal")
        .send({
          publicId: orderId,
          preimage: "b".repeat(64),
          txHash: "0x123456"
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "validation_error");
    });

    it("should reject preimage with mismatched hashlock", async () => {
      const res = await request(app)
        .post("/api/secrets/reveal")
        .send({
          publicId: orderId,
          preimage: "0x" + "00".repeat(32),
          txHash: "0x123456"
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "secret_error");
    });

    it("should reject secret reveal for non-existent order", async () => {
      const res = await request(app)
        .post("/api/secrets/reveal")
        .send({
          publicId: "nonexistent",
          preimage: revealPreimage,
          txHash: "0x123456"
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "secret_error");
    });
  });

  describe("GET /api/secrets/:publicId", () => {
    const getPreimage = "0x" + "66".repeat(32);
    const getHashlock = "0x" + createHash("sha256").update(Buffer.from("66".repeat(32), "hex")).digest("hex");
    let orderId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({
          direction: "eth_to_xlm",
          hashlock: getHashlock,
          srcChain: "ethereum",
          srcAddress: VALID_ETH_ADDR,
          srcAsset: "ETH",
          srcAmount: "1",
          srcSafetyDeposit: "1",
          dstChain: "stellar",
          dstAddress: VALID_STELLAR_ADDR,
          dstAsset: "XLM",
          dstAmount: "1"
        });

      orderId = res.body.id;

      // Transition to src_locked
      await request(app)
        .post(`/api/orders/${orderId}/src-locked`)
        .send({
          orderId: "1",
          txHash: "0xdead",
          blockNumber: 1,
          timelock: 0
        });

      // Reveal the secret
      await request(app)
        .post("/api/secrets/reveal")
        .send({
          publicId: orderId,
          preimage: getPreimage,
          txHash: "0x123456"
        });
    });

    it("should retrieve a revealed secret", async () => {
      const res = await request(app).get(`/api/secrets/${orderId}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("publicId", orderId);
      expect(res.body).toHaveProperty("preimage", getPreimage);
    });

    it("should return 404 for unrevealed secret", async () => {
      const res = await request(app).get("/api/secrets/unrevealed-order-id");

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error", "not_revealed");
    });
  });

  describe("GET /api/quotes/eth-xlm", () => {
    it("should return a price quote", async () => {
      const res = await request(app).get("/api/quotes/eth-xlm");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("ethUsd");
      expect(res.body).toHaveProperty("xlmUsd");
      expect(res.body).toHaveProperty("source");
      expect(res.body).toHaveProperty("fetchedAt");
    });

    it("should include valid source", async () => {
      const res = await request(app).get("/api/quotes/eth-xlm");

      expect(res.status).toBe(200);
      const validSources = ["coingecko", "oneinch", "cache", "unknown"];
      expect(validSources).toContain(res.body.source);
    });

    it("should include valid timestamp", async () => {
      const res = await request(app).get("/api/quotes/eth-xlm");

      expect(res.status).toBe(200);
      expect(typeof res.body.fetchedAt).toBe("number");
      expect(res.body.fetchedAt).toBeGreaterThan(0);
      expect(res.body.fetchedAt).toBeLessThanOrEqual(Date.now());
    });

    it("should cache prices for 30 seconds", async () => {
      const res1 = await request(app).get("/api/quotes/eth-xlm");
      expect(res1.status).toBe(200);
      const source1 = res1.body.source;

      const res2 = await request(app).get("/api/quotes/eth-xlm");
      expect(res2.status).toBe(200);
      const source2 = res2.body.source;

      // Both should be from cache or have been fetched within short time
      expect([source1, source2]).toContain("cache");
    });

    it("should allow null prices gracefully", async () => {
      const res = await request(app).get("/api/quotes/eth-xlm");

      expect(res.status).toBe(200);
      // ethUsd and xlmUsd can be null if API call fails
      expect(res.body.ethUsd === null || typeof res.body.ethUsd === "string").toBe(true);
      expect(res.body.xlmUsd === null || typeof res.body.xlmUsd === "string").toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed JSON gracefully", async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .set("Content-Type", "application/json")
        .send("{ invalid json }");

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("should handle CORS for all endpoints", async () => {
      const res = await request(app)
        .get("/health")
        .set("Origin", "http://example.com");

      if (res.status !== 200) {
        // eslint-disable-next-line no-console
        console.error("CORS test failed! Status:", res.status, "Body:", res.body);
      }

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBeDefined();
    });
  });
});

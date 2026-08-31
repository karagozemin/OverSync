import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";
import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { openDatabase } from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { OrderService } from "../src/services/order-service.js";
import { SecretService } from "../src/services/secret-service.js";
import { QuoteService, QuoteExpiredError, QuoteNotFoundError } from "../src/services/quote-service.js";
import { createApp } from "../src/server/app.js";

const log = pino({ level: "silent" });
const PREIMAGE_BUF = Buffer.alloc(32);
PREIMAGE_BUF[31] = 9;
const PREIMAGE = "0x" + PREIMAGE_BUF.toString("hex");
const VALID_HASH = "0x" + createHash("sha256").update(PREIMAGE_BUF).digest("hex");
const VALID_ETH_ADDR = "0x1111111111111111111111111111111111111111";
const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";

async function freshDb() {
  const dir = mkdtempSync(resolve(tmpdir(), "oversync-contract-test-"));
  return openDatabase(`file:${dir}/test.db`);
}

describe("Coordinator API Contract Tests", () => {
  let db: any;
  let ordersRepo: OrdersRepository;
  let ordersService: OrderService;
  let secretsService: SecretService;
  let quotesService: QuoteService;
  let app: any;

  beforeEach(async () => {
    db = await freshDb();
    ordersRepo = new OrdersRepository(db);
    quotesService = new QuoteService(log);
    ordersService = new OrderService(ordersRepo, log, quotesService, {
      timelockSafetyGapSeconds: 600,
      ethereumChainId: 11155111,
      stellarNetworkPassphrase: "Test SDF Network ; September 2015"
    } as any);
    secretsService = new SecretService(ordersService, log);

    app = createApp({
      log,
      corsOrigins: ["*"],
      maxRequestBodyBytes: 65536,
      orders: ordersService,
      secrets: secretsService,
      quotes: quotesService
    });
  });

  // ----------------------------------------------------
  // Health & Readiness Routes
  // ----------------------------------------------------
  describe("GET /health & /readiness", () => {
    it("returns 200 OK with stable metadata fields on /health", async () => {
      const res = await request(app).get("/health").expect(200);
      expect(res.body).toMatchObject({
        status: "ok",
        service: "oversync-coordinator",
        version: expect.any(String),
        uptimeSeconds: expect.any(Number),
        timestamp: expect.any(String)
      });
    });

    it("returns 200 OK on /readiness", async () => {
      const res = await request(app).get("/readiness").expect(200);
      expect(res.body).toMatchObject({
        service: "oversync-coordinator",
        version: expect.any(String),
        timestamp: expect.any(String)
      });
    });
  });

  // ----------------------------------------------------
  // Metrics Routes
  // ----------------------------------------------------
  describe("GET /metrics & GET /api/metrics", () => {
    it("returns 200 OK with stable Prometheus exposition text format on /metrics", async () => {
      const res = await request(app)
        .get("/metrics")
        .expect(200);

      expect(res.headers["content-type"]).toContain("text/plain");
      expect(res.text).toContain("coordinator_orders_total");
      expect(res.text).toContain("coordinator_listener_last_block");
      expect(res.text).toContain("coordinator_http_request_duration_seconds");
    });

    it("returns 200 OK with JSON order metrics on /api/metrics", async () => {
      const res = await request(app)
        .get("/api/metrics")
        .expect(200);

      expect(res.body).toMatchObject({
        totalOrders: 0,
        byStatus: {},
        completedOrders: 0,
        refundedOrders: 0,
        staleExpiredOrders: 0
      });
    });
  });

  // ----------------------------------------------------
  // Quotes Routes
  // ----------------------------------------------------
  describe("Quotes Endpoints", () => {
    it("returns fresh quote details on GET /api/quotes/eth-xlm", async () => {
      vi.spyOn(quotesService, "quoteEthXlm").mockResolvedValue({
        quoteId: "test-quote-123",
        pair: "ETH-XLM",
        srcUsd: "2500.50",
        dstUsd: "0.12",
        source: "cache",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 30000
      });

      const res = await request(app)
        .get("/api/quotes/eth-xlm")
        .expect(200);

      expect(res.body).toEqual({
        quoteId: "test-quote-123",
        pair: "ETH-XLM",
        ethUsd: "2500.50",
        xlmUsd: "0.12",
        source: "cache",
        issuedAt: expect.any(Number),
        expiresAt: expect.any(Number),
        freshMs: expect.any(Number)
      });
    });

    it("returns 200 fresh quote status on GET /api/quotes/:id/status", async () => {
      vi.spyOn(quotesService, "assertFresh").mockReturnValue({
        quoteId: "test-fresh",
        pair: "ETH-XLM",
        srcUsd: "2500",
        dstUsd: "0.1",
        source: "cache",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 20000
      });

      const res = await request(app)
        .get("/api/quotes/test-fresh/status")
        .expect(200);

      expect(res.body).toMatchObject({
        quoteId: "test-fresh",
        fresh: true,
        issuedAt: expect.any(Number),
        expiresAt: expect.any(Number),
        freshMs: expect.any(Number),
        source: "cache"
      });
    });

    it("returns 410 Gone for expired quote status on GET /api/quotes/:id/status", async () => {
      const expiredMs = Date.now() - 5000;
      vi.spyOn(quotesService, "assertFresh").mockImplementation(() => {
        throw new QuoteExpiredError("test-expired", expiredMs);
      });

      const res = await request(app)
        .get("/api/quotes/test-expired/status")
        .expect(410);

      expect(res.body).toMatchObject({
        error: "quote_expired",
        quoteId: "test-expired",
        fresh: false,
        expiredMs: expiredMs,
        staleMs: expect.any(Number),
        message: expect.stringContaining("expired")
      });
    });

    it("returns 404 Not Found for unknown quote status on GET /api/quotes/:id/status", async () => {
      vi.spyOn(quotesService, "assertFresh").mockImplementation(() => {
        throw new QuoteNotFoundError("test-unknown");
      });

      const res = await request(app)
        .get("/api/quotes/test-unknown/status")
        .expect(404);

      expect(res.body).toMatchObject({
        error: "quote_not_found",
        quoteId: "test-unknown",
        message: expect.stringContaining("not found")
      });
    });
  });

  // ----------------------------------------------------
  // Orders Routes
  // ----------------------------------------------------
  describe("Orders Endpoints", () => {
    const validAnnouncePayload = {
      direction: "eth_to_xlm",
      hashlock: VALID_HASH,
      srcChain: "ethereum",
      srcAddress: VALID_ETH_ADDR,
      srcAsset: "native",
      srcAmount: "1000000000000000000",
      srcSafetyDeposit: "1000000000000000",
      dstChain: "stellar",
      dstAddress: VALID_STELLAR_ADDR,
      dstAsset: "native",
      dstAmount: "100000000"
    };

    it("creates a new order on POST /api/orders/announce", async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send(validAnnouncePayload)
        .expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(String),
        direction: "eth_to_xlm",
        status: "announced",
        hashlock: VALID_HASH,
        src: {
          chain: "ethereum",
          address: VALID_ETH_ADDR,
          asset: "native",
          amount: "1000000000000000000",
          safetyDeposit: "1000000000000000"
        },
        dst: {
          chain: "stellar",
          address: VALID_STELLAR_ADDR,
          asset: "native",
          amount: "100000000"
        }
      });
    });

    it("returns 400 validation_error on POST /api/orders/announce for malformed schema", async () => {
      const res = await request(app)
        .post("/api/orders/announce")
        .send({ direction: "invalid" })
        .expect(400);

      expect(res.body).toMatchObject({
        error: "validation_error",
        details: expect.any(Array)
      });
    });

    it("returns 400 order_validation_error on POST /api/orders/announce for logical/domain errors", async () => {
      // Announce first
      await request(app)
        .post("/api/orders/announce")
        .send(validAnnouncePayload)
        .expect(201);

      // Try duplicate hashlock
      const res = await request(app)
        .post("/api/orders/announce")
        .send(validAnnouncePayload)
        .expect(400);

      expect(res.body).toMatchObject({
        error: "order_validation_error",
        message: expect.stringContaining("already exists")
      });
    });

    it("fetches single order details on GET /api/orders/:id", async () => {
      const announceRes = await request(app)
        .post("/api/orders/announce")
        .send(validAnnouncePayload)
        .expect(201);

      const publicId = announceRes.body.id;

      const res = await request(app)
        .get(`/api/orders/${publicId}`)
        .expect(200);

      expect(res.body.id).toBe(publicId);
    });

    it("returns 404 for unknown order ID on GET /api/orders/:id", async () => {
      await request(app)
        .get("/api/orders/unknown-id")
        .expect(404);
    });

    it("returns order history list on GET /api/orders/history", async () => {
      await request(app)
        .post("/api/orders/announce")
        .send(validAnnouncePayload)
        .expect(201);

      const res = await request(app)
        .get(`/api/orders/history?address=${VALID_ETH_ADDR}`)
        .expect(200);

      expect(res.body.transactions).toHaveLength(1);
      expect(res.body.pagination).toMatchObject({
        limit: 50,
        hasMore: false
      });
    });

    it("returns 400 on GET /api/orders/history if limit or address is invalid", async () => {
      await request(app)
        .get(`/api/orders/history`)
        .expect(400);

      await request(app)
        .get(`/api/orders/history?address=${VALID_ETH_ADDR}&limit=-5`)
        .expect(400);
    });

    it("returns order snapshot list on GET /api/orders/snapshot", async () => {
      const res = await request(app)
        .get("/api/orders/snapshot")
        .expect(200);

      expect(res.body).toHaveProperty("snapshots");
      expect(Array.isArray(res.body.snapshots)).toBe(true);
    });

    it("records source lock on POST /api/orders/:id/src-locked", async () => {
      const announceRes = await request(app)
        .post("/api/orders/announce")
        .send(validAnnouncePayload)
        .expect(201);

      const publicId = announceRes.body.id;

      const res = await request(app)
        .post(`/api/orders/${publicId}/src-locked`)
        .send({
          orderId: "source-order-1",
          txHash: "0xsrchash",
          blockNumber: 120,
          timelock: 2000
        })
        .expect(200);

      expect(res.body).toEqual({ ok: true });

      const details = await request(app).get(`/api/orders/${publicId}`);
      expect(details.body.status).toBe("src_locked");
      expect(details.body.src.orderId).toBe("source-order-1");
    });

    it("records destination lock on POST /api/orders/:id/dst-locked", async () => {
      const announceRes = await request(app)
        .post("/api/orders/announce")
        .send(validAnnouncePayload)
        .expect(201);

      const publicId = announceRes.body.id;

      // transition to srcLocked first
      await request(app)
        .post(`/api/orders/${publicId}/src-locked`)
        .send({
          orderId: "source-order-1",
          txHash: "0xsrchash",
          blockNumber: 120,
          timelock: 2000
        })
        .expect(200);

      // transition to dstLocked
      const res = await request(app)
        .post(`/api/orders/${publicId}/dst-locked`)
        .send({
          orderId: "dest-order-1",
          txHash: "0xdsthash",
          blockNumber: 340,
          timelock: 1000,
          resolver: "0xresolver"
        })
        .expect(200);

      expect(res.body).toEqual({ ok: true });
    });

    it("returns 400 order_validation_error for invalid timelock order on POST /api/orders/:id/dst-locked", async () => {
      const announceRes = await request(app)
        .post("/api/orders/announce")
        .send(validAnnouncePayload)
        .expect(201);

      const publicId = announceRes.body.id;

      // transition to srcLocked first
      await request(app)
        .post(`/api/orders/${publicId}/src-locked`)
        .send({
          orderId: "source-order-1",
          txHash: "0xsrchash",
          blockNumber: 120,
          timelock: 2000
        })
        .expect(200);

      // transition to dstLocked with reversed timelock (dst >= src)
      const res = await request(app)
        .post(`/api/orders/${publicId}/dst-locked`)
        .send({
          orderId: "dest-order-1",
          txHash: "0xdsthash",
          blockNumber: 340,
          timelock: 2500, // Invalid! dst timelock must be < src timelock
          resolver: "0xresolver"
        })
        .expect(400);

      expect(res.body).toMatchObject({
        error: "order_validation_error",
        message: expect.stringContaining("timelock")
      });
    });
  });

  // ----------------------------------------------------
  // Secrets Routes
  // ----------------------------------------------------
  describe("Secrets Endpoints", () => {
    const validAnnouncePayload = {
      direction: "eth_to_xlm",
      hashlock: VALID_HASH,
      srcChain: "ethereum",
      srcAddress: VALID_ETH_ADDR,
      srcAsset: "native",
      srcAmount: "1000000000000000000",
      srcSafetyDeposit: "1000000000000000",
      dstChain: "stellar",
      dstAddress: VALID_STELLAR_ADDR,
      dstAsset: "native",
      dstAmount: "100000000"
    };

    it("reveals secret and returns preimage successfully", async () => {
      const announceRes = await request(app)
        .post("/api/orders/announce")
        .send(validAnnouncePayload)
        .expect(201);

      const publicId = announceRes.body.id;

      // Lock src and dst first to satisfy order machine transition rules
      await request(app)
        .post(`/api/orders/${publicId}/src-locked`)
        .send({
          orderId: "source-order-1",
          txHash: "0xsrchash",
          blockNumber: 120,
          timelock: 2000
        })
        .expect(200);

      await request(app)
        .post(`/api/orders/${publicId}/dst-locked`)
        .send({
          orderId: "dest-order-1",
          txHash: "0xdsthash",
          blockNumber: 340,
          timelock: 1000,
          resolver: "0xresolver"
        })
        .expect(200);

      // Reveal preimage
      const revealRes = await request(app)
        .post("/api/secrets/reveal")
        .send({
          publicId,
          preimage: PREIMAGE,
          txHash: "0xrevealhash"
        })
        .expect(200);

      expect(revealRes.body).toEqual({ ok: true });

      // Fetch revealed preimage
      const getRes = await request(app)
        .get(`/api/secrets/${publicId}`)
        .expect(200);

      expect(getRes.body).toEqual({
        publicId,
        preimage: PREIMAGE
      });
    });

    it("returns 400 validation_error on POST /api/secrets/reveal for malformed input", async () => {
      const res = await request(app)
        .post("/api/secrets/reveal")
        .send({
          publicId: "",
          preimage: "not-hex",
          txHash: "0xabc"
        })
        .expect(400);

      expect(res.body).toMatchObject({
        error: "validation_error",
        details: expect.any(Array)
      });
    });

    it("returns 400 secret_error on POST /api/secrets/reveal for incorrect preimage", async () => {
      const announceRes = await request(app)
        .post("/api/orders/announce")
        .send(validAnnouncePayload)
        .expect(201);

      const publicId = announceRes.body.id;

      await request(app)
        .post(`/api/orders/${publicId}/src-locked`)
        .send({
          orderId: "source-order-1",
          txHash: "0xsrchash",
          blockNumber: 120,
          timelock: 2000
        })
        .expect(200);

      await request(app)
        .post(`/api/orders/${publicId}/dst-locked`)
        .send({
          orderId: "dest-order-1",
          txHash: "0xdsthash",
          blockNumber: 340,
          timelock: 1000,
          resolver: "0xresolver"
        })
        .expect(200);

      const incorrectPreimage = "0x" + "7".repeat(64);

      const res = await request(app)
        .post("/api/secrets/reveal")
        .send({
          publicId,
          preimage: incorrectPreimage,
          txHash: "0xrevealhash"
        })
        .expect(400);

      expect(res.body).toMatchObject({
        error: "secret_error",
        message: expect.stringContaining("does not match")
      });
    });

    it("returns 404 not_revealed on GET /api/secrets/:publicId when not revealed", async () => {
      const announceRes = await request(app)
        .post("/api/orders/announce")
        .send(validAnnouncePayload)
        .expect(201);

      const publicId = announceRes.body.id;

      const res = await request(app)
        .get(`/api/secrets/${publicId}`)
        .expect(404);

      expect(res.body).toEqual({
        error: "not_revealed"
      });
    });
  });
});

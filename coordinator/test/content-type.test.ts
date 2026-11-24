import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import { isValidJsonContentType } from "../src/server/content-type.js";
import { createApp } from "../src/server/app.js";
import type { OrderService } from "../src/services/order-service.js";
import type { SecretService } from "../src/services/secret-service.js";
import type { QuoteService } from "../src/services/quote-service.js";

describe("isValidJsonContentType", () => {
  it("accepts application/json without parameters", () => {
    expect(isValidJsonContentType("application/json")).toBe(true);
    expect(isValidJsonContentType("APPLICATION/JSON")).toBe(true);
    expect(isValidJsonContentType(" application/json ")).toBe(true);
  });

  it("accepts application/json with valid charset parameters", () => {
    expect(isValidJsonContentType("application/json; charset=utf-8")).toBe(
      true,
    );
    expect(isValidJsonContentType("application/json; charset=UTF-8")).toBe(
      true,
    );
    expect(isValidJsonContentType("application/json;charset=utf-8")).toBe(true);
    expect(isValidJsonContentType('application/json; charset="utf-8"')).toBe(
      true,
    );
    expect(isValidJsonContentType("application/json; charset='utf-8'")).toBe(
      true,
    );
    expect(isValidJsonContentType("application/json; charset=iso-8859-1")).toBe(
      true,
    );
  });

  it("rejects non-json MIME types", () => {
    expect(isValidJsonContentType("text/plain")).toBe(false);
    expect(isValidJsonContentType("text/html")).toBe(false);
    expect(isValidJsonContentType("application/xml")).toBe(false);
    expect(isValidJsonContentType("application/x-www-form-urlencoded")).toBe(
      false,
    );
    expect(isValidJsonContentType("multipart/form-data")).toBe(false);
    expect(isValidJsonContentType("application/javascript")).toBe(false);
  });

  it("rejects missing or empty values", () => {
    expect(isValidJsonContentType(undefined)).toBe(false);
    expect(isValidJsonContentType(null)).toBe(false);
    expect(isValidJsonContentType("")).toBe(false);
    expect(isValidJsonContentType("   ")).toBe(false);
  });

  it("rejects unsupported parameters or malformed charsets", () => {
    expect(isValidJsonContentType("application/json; boundary=something")).toBe(
      false,
    );
    expect(isValidJsonContentType("application/json; charset=")).toBe(false);
    expect(isValidJsonContentType('application/json; charset=""')).toBe(false);
    expect(
      isValidJsonContentType("application/json; charset=utf-8; foo=bar"),
    ).toBe(false);
  });
});

describe("Coordinator write routes Content-Type enforcement", () => {
  const log = pino({ level: "silent" });
  const VALID_HASHLOCK = "0x" + "a".repeat(64);
  const VALID_ETH_ADDR = "0x1111111111111111111111111111111111111111";
  const VALID_STELLAR_ADDR =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";

  const VALID_ANNOUNCE = {
    direction: "eth_to_xlm",
    hashlock: VALID_HASHLOCK,
    srcChain: "ethereum",
    srcAddress: VALID_ETH_ADDR,
    srcAsset: "native",
    srcAmount: "1000",
    srcSafetyDeposit: "10",
    dstChain: "stellar",
    dstAddress: VALID_STELLAR_ADDR,
    dstAsset: "native",
    dstAmount: "100",
  };

  function buildTestApp() {
    const orders = {
      announce: vi.fn().mockResolvedValue({
        publicId: "abc123",
        direction: "eth_to_xlm",
        status: "announced",
        hashlock: VALID_HASHLOCK,
        srcChain: "ethereum",
        srcAddress: VALID_ETH_ADDR,
        srcAsset: "native",
        srcAmount: "1000",
        srcSafetyDeposit: "10",
        srcOrderId: null,
        srcLockTx: null,
        srcLockBlock: null,
        srcTimelock: null,
        dstChain: "stellar",
        dstAddress: VALID_STELLAR_ADDR,
        dstAsset: "native",
        dstAmount: "100",
        dstOrderId: null,
        dstLockTx: null,
        dstLockBlock: null,
        dstTimelock: null,
        preimage: null,
        secretRevealedTx: null,
        resolverAddress: null,
        createdAt: 1000,
        updatedAt: 1000,
      }),
      get: vi.fn(),
      history: vi.fn().mockResolvedValue([]),
      recordSrcLock: vi.fn().mockResolvedValue({
        publicId: "order-1",
        direction: "eth_to_xlm",
        status: "src_locked",
      }),
      recordDstLock: vi.fn().mockResolvedValue({
        publicId: "order-1",
        direction: "eth_to_xlm",
        status: "dst_locked",
      }),
    } as unknown as OrderService;

    const secrets = {
      reveal: vi.fn().mockResolvedValue({
        publicId: "order-1",
        status: "secret_revealed",
        preimage: "0x" + "b".repeat(64),
      }),
      get: vi.fn(),
    } as unknown as SecretService;

    const quotes = {
      quoteEthXlm: vi.fn().mockResolvedValue({ rate: 1 }),
    } as unknown as QuoteService;

    const app = createApp({
      log,
      corsOrigins: ["*"],
      maxRequestBodyBytes: 65_536,
      orders,
      secrets,
      quotes,
    });

    return { app, orders, secrets };
  }

  describe("POST /api/orders/announce", () => {
    it("rejects write route when Content-Type is missing", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post("/api/orders/announce")
        .send(JSON.stringify(VALID_ANNOUNCE));

      // By default supertest set content-type to json when send() is object,
      // but when sending raw string without set(), no content-type is set
    });

    it("rejects write route with 415 and stable JSON error when Content-Type is missing", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post("/api/orders/announce")
        .unset("Content-Type")
        .send(JSON.stringify(VALID_ANNOUNCE));

      expect(res.status).toBe(415);
      expect(res.body).toEqual({
        error: "unsupported_media_type",
        message: "Content-Type must be application/json",
      });
    });

    it("rejects text/plain with 415", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post("/api/orders/announce")
        .set("Content-Type", "text/plain")
        .send(JSON.stringify(VALID_ANNOUNCE));

      expect(res.status).toBe(415);
      expect(res.body).toEqual({
        error: "unsupported_media_type",
        message: "Content-Type must be application/json",
      });
    });

    it("rejects application/x-www-form-urlencoded with 415", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post("/api/orders/announce")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send("direction=eth_to_xlm");

      expect(res.status).toBe(415);
      expect(res.body.error).toBe("unsupported_media_type");
    });

    it("rejects application/xml with 415", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post("/api/orders/announce")
        .set("Content-Type", "application/xml")
        .send("<order></order>");

      expect(res.status).toBe(415);
      expect(res.body.error).toBe("unsupported_media_type");
    });

    it("accepts application/json", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post("/api/orders/announce")
        .set("Content-Type", "application/json")
        .send(JSON.stringify(VALID_ANNOUNCE));

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("abc123");
    });

    it("accepts application/json; charset=utf-8", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post("/api/orders/announce")
        .set("Content-Type", "application/json; charset=utf-8")
        .send(JSON.stringify(VALID_ANNOUNCE));

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("abc123");
    });

    it("accepts application/json; charset=UTF-8", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post("/api/orders/announce")
        .set("Content-Type", "application/json; charset=UTF-8")
        .send(JSON.stringify(VALID_ANNOUNCE));

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("abc123");
    });
  });

  describe("Other write routes", () => {
    it("rejects POST /api/secrets/reveal without JSON Content-Type", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post("/api/secrets/reveal")
        .set("Content-Type", "text/plain")
        .send("preimage=0x123");

      expect(res.status).toBe(415);
      expect(res.body).toEqual({
        error: "unsupported_media_type",
        message: "Content-Type must be application/json",
      });
    });

    it("rejects POST /api/orders/:id/src-locked without JSON Content-Type", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post("/api/orders/order-1/src-locked")
        .set("Content-Type", "text/plain")
        .send("srcLockTx=0x123");

      expect(res.status).toBe(415);
      expect(res.body).toEqual({
        error: "unsupported_media_type",
        message: "Content-Type must be application/json",
      });
    });

    it("rejects POST /api/orders/:id/dst-locked without JSON Content-Type", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post("/api/orders/order-1/dst-locked")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send("dstLockTx=0x123");

      expect(res.status).toBe(415);
      expect(res.body).toEqual({
        error: "unsupported_media_type",
        message: "Content-Type must be application/json",
      });
    });
  });

  describe("Read routes (GET) are unaffected", () => {
    it("allows GET /health without Content-Type", async () => {
      const { app } = buildTestApp();
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
    });

    it("allows GET /api/orders/history without Content-Type", async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .get("/api/orders/history")
        .query({ address: VALID_STELLAR_ADDR });
      expect(res.status).toBe(200);
    });
  });
});

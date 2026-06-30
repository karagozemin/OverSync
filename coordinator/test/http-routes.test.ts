/**
 * HTTP integration tests for coordinator route size limits.
 *
 * Tests mount a real Express app with mocked services and a deliberately small
 * `maxRequestBodyBytes` (200 bytes) so oversized payloads are cheap to construct.
 * No database is needed — OrderService / SecretService / QuoteService are fully mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "../src/server/app.js";
import type { OrderService } from "../src/services/order-service.js";
import type { SecretService } from "../src/services/secret-service.js";
import type { QuoteService } from "../src/services/quote-service.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

const SMALL_LIMIT = 200; // bytes — easy to exceed in tests

const log = pino({ level: "silent" });

const VALID_HASHLOCK = "0x" + "a".repeat(64);
const VALID_ETH_ADDR = "0x1111111111111111111111111111111111111111";
const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";

/** Builds a payload string that exceeds SMALL_LIMIT bytes. */
function oversizedBody(): string {
  return JSON.stringify({ padding: "x".repeat(SMALL_LIMIT + 50) });
}

/** Creates a fresh test app with mocked services and the given body limit. */
function buildApp(maxRequestBodyBytes = SMALL_LIMIT) {
  const orders = {
    announce: vi.fn(),
    get: vi.fn(),
    history: vi.fn(),
    recordSrcLock: vi.fn(),
    recordDstLock: vi.fn()
  } as unknown as OrderService;

  const secrets = {
    reveal: vi.fn(),
    get: vi.fn()
  } as unknown as SecretService;

  const quotes = {
    quoteEthXlm: vi.fn().mockResolvedValue({ rate: 1 })
  } as unknown as QuoteService;

  const app = createApp({ log, corsOrigins: ["*"], maxRequestBodyBytes, orders, secrets, quotes });

  return { app, orders, secrets };
}

// ─── Valid announce payload ─────────────────────────────────────────────────

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
  dstAmount: "100"
};

// ─── POST /api/orders/announce ─────────────────────────────────────────────

describe("POST /api/orders/announce", () => {
  it("returns 201 for a valid small payload", async () => {
    const { app, orders } = buildApp(65_536); // use generous limit for valid-payload test
    (orders.announce as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
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
      createdAt: 0,
      updatedAt: 0
    });

    const res = await request(app)
      .post("/api/orders/announce")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(VALID_ANNOUNCE));

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("abc123");
  });

  it("returns 413 for an oversized payload", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post("/api/orders/announce")
      .set("Content-Type", "application/json")
      .send(oversizedBody());

    expect(res.status).toBe(413);
    expect(res.body.error).toBe("payload_too_large");
    expect(res.body.message).toContain(`${SMALL_LIMIT}`);
  });

  it("returns 400 for malformed but small JSON", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post("/api/orders/announce")
      .set("Content-Type", "application/json")
      .send("{not valid json}");

    // Express json() parser sends a 400 for syntax errors
    expect(res.status).toBe(400);
  });

  it("returns 400 for valid JSON that fails schema validation", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post("/api/orders/announce")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ direction: "eth_to_xlm" /* missing required fields */ }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});

// ─── POST /api/secrets/reveal ─────────────────────────────────────────────

describe("POST /api/secrets/reveal", () => {
  it("returns 200 for a valid small payload", async () => {
    const { app, secrets } = buildApp(65_536);
    (secrets.reveal as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post("/api/secrets/reveal")
      .set("Content-Type", "application/json")
      .send(
        JSON.stringify({
          publicId: "abc123",
          preimage: "0x" + "b".repeat(64),
          txHash: "0x" + "c".repeat(64)
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 413 for an oversized payload", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post("/api/secrets/reveal")
      .set("Content-Type", "application/json")
      .send(oversizedBody());

    expect(res.status).toBe(413);
    expect(res.body.error).toBe("payload_too_large");
  });

  it("returns 400 for malformed but small JSON", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post("/api/secrets/reveal")
      .set("Content-Type", "application/json")
      .send("{bad json}");

    expect(res.status).toBe(400);
  });

  it("returns 400 for valid JSON that fails schema validation", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post("/api/secrets/reveal")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ publicId: "x" /* missing preimage, txHash */ }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});

// ─── POST /api/orders/:id/src-locked ─────────────────────────────────────

describe("POST /api/orders/:id/src-locked", () => {
  it("returns 413 for an oversized payload", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post("/api/orders/order-1/src-locked")
      .set("Content-Type", "application/json")
      .send(oversizedBody());

    expect(res.status).toBe(413);
    expect(res.body.error).toBe("payload_too_large");
  });
});

// ─── POST /api/orders/:id/dst-locked ─────────────────────────────────────

describe("POST /api/orders/:id/dst-locked", () => {
  it("returns 413 for an oversized payload", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post("/api/orders/order-1/dst-locked")
      .set("Content-Type", "application/json")
      .send(oversizedBody());

    expect(res.status).toBe(413);
    expect(res.body.error).toBe("payload_too_large");
  });
});

// ─── Configurable limit override ────────────────────────────────────────────

describe("Configurable limit override", () => {
  it("accepts a payload just within a custom limit", async () => {
    const customLimit = 500;
    const { app, orders } = buildApp(customLimit);
    (orders.announce as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      publicId: "xyz",
      direction: "eth_to_xlm",
      status: "announced",
      hashlock: VALID_HASHLOCK,
      srcChain: "ethereum",
      srcAddress: VALID_ETH_ADDR,
      srcAsset: "native",
      srcAmount: "1",
      srcSafetyDeposit: "1",
      srcOrderId: null,
      srcLockTx: null,
      srcLockBlock: null,
      srcTimelock: null,
      dstChain: "stellar",
      dstAddress: VALID_STELLAR_ADDR,
      dstAsset: "native",
      dstAmount: "1",
      dstOrderId: null,
      dstLockTx: null,
      dstLockBlock: null,
      dstTimelock: null,
      preimage: null,
      secretRevealedTx: null,
      resolverAddress: null,
      createdAt: 0,
      updatedAt: 0
    });

    const payload = JSON.stringify(VALID_ANNOUNCE);
    // payload must be smaller than customLimit
    expect(Buffer.byteLength(payload)).toBeLessThan(customLimit);

    const res = await request(app)
      .post("/api/orders/announce")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(201);
  });

  it("rejects a payload that exceeds a custom limit but would fit the default", async () => {
    const customLimit = 50; // tiny
    const { app } = buildApp(customLimit);

    // VALID_ANNOUNCE serialised is ~300 bytes — fits default (65536) but not 50
    const res = await request(app)
      .post("/api/orders/announce")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(VALID_ANNOUNCE));

    expect(res.status).toBe(413);
    expect(res.body.error).toBe("payload_too_large");
    expect(res.body.message).toContain("50");
  });
});

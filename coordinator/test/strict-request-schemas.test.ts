/**
 * Strict request schemas — one focused test per route group.
 *
 * Order, quote and secret requests used to ignore unknown fields, so a client
 * that misspelled `hashlock`, `timelock` or `preimage` was told its request
 * succeeded while the safety setting it meant to send was dropped. These tests
 * pin the replacement contract: HTTP 400 with a stable `unknown_field` code,
 * the offending field named, and no submitted value echoed back.
 */
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "../src/server/app.js";
import type { OrderService } from "../src/services/order-service.js";
import type { SecretService } from "../src/services/secret-service.js";
import type { QuoteService } from "../src/services/quote-service.js";

const log = pino({ level: "silent" });

const VALID_HASHLOCK = "0x" + "a".repeat(64);
const VALID_ETH_ADDR = "0x1111111111111111111111111111111111111111";
const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";

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

function buildApp() {
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
    quoteEthXlm: vi.fn()
  } as unknown as QuoteService;

  const app = createApp({
    log,
    corsOrigins: ["*"],
    maxRequestBodyBytes: 65_536,
    orders,
    secrets,
    quotes
  });

  return { app, orders, secrets, quotes };
}

describe("strict order request schemas", () => {
  it("rejects an announce payload that carries an unknown field", async () => {
    const { app, orders } = buildApp();

    const res = await request(app)
      .post("/api/orders/announce")
      .set("Content-Type", "application/json")
      .send({ ...VALID_ANNOUNCE, hashlockd: "0xfeedfacecafe" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "unknown_field", fields: ["hashlockd"] });
    expect(JSON.stringify(res.body)).not.toContain("0xfeedfacecafe");
    expect(orders.announce).not.toHaveBeenCalled();
  });

  it("rejects a lock payload that carries an unknown field", async () => {
    const { app, orders } = buildApp();

    const res = await request(app)
      .post("/api/orders/order-1/src-locked")
      .set("Content-Type", "application/json")
      .send({
        orderId: "1",
        txHash: "0xdead",
        blockNumber: 1,
        timelock: 100,
        timelockk: 424242
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "unknown_field", fields: ["timelockk"] });
    expect(JSON.stringify(res.body)).not.toContain("424242");
    expect(orders.recordSrcLock).not.toHaveBeenCalled();
  });
});

describe("strict quote request schema", () => {
  it("rejects an unknown query field on the quote route", async () => {
    const { app, quotes } = buildApp();

    const res = await request(app)
      .get("/api/quotes/eth-xlm")
      .query({ amount: "1000", srcAmout: "777777777" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "unknown_field", fields: ["srcAmout"] });
    expect(JSON.stringify(res.body)).not.toContain("777777777");
    expect(quotes.quoteEthXlm).not.toHaveBeenCalled();
  });
});

describe("strict secret request schema", () => {
  it("rejects a reveal payload that carries an unknown field", async () => {
    const { app, secrets } = buildApp();
    const preimage = "0x" + "b".repeat(64);
    const unknownValue = "0x" + "c".repeat(64);

    const res = await request(app)
      .post("/api/secrets/reveal")
      .set("Content-Type", "application/json")
      .send({
        publicId: "order-1",
        preimage,
        txHash: "0xdead",
        preimageHash: unknownValue
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "unknown_field", fields: ["preimageHash"] });
    expect(JSON.stringify(res.body)).not.toContain(unknownValue);
    expect(secrets.reveal).not.toHaveBeenCalled();
  });
});

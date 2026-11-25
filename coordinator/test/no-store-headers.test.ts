/**
 * Quote and secret responses must never be reused by a shared proxy or a
 * browser cache: a quote is bound to one caller's terms and a secret lookup is
 * order-specific. Every response from those routers — success and error — must
 * carry `Cache-Control: no-store`, with `Pragma: no-cache` for HTTP/1.0
 * intermediaries.
 */
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "../src/server/app.js";
import type { OrderService } from "../src/services/order-service.js";
import type { SecretService } from "../src/services/secret-service.js";
import type { QuoteService } from "../src/services/quote-service.js";

const log = pino({ level: "silent" });

const QUOTE = {
  quoteId: "quote-1",
  pair: "ETH-XLM",
  srcChain: "ethereum" as const,
  srcAsset: "native",
  srcAmount: "1000",
  dstChain: "stellar" as const,
  dstAsset: "native",
  dstAmount: "100",
  srcUsd: "2000",
  dstUsd: "0.1",
  source: "coingecko" as const,
  issuedAt: 1,
  expiresAt: 2,
  amountBaseUnits: "1000"
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

  return { app, quotes, secrets };
}

function expectNonCacheable(headers: Record<string, string | string[] | undefined>) {
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers.pragma).toBe("no-cache");
}

describe("quote routes are non-cacheable", () => {
  it("sets no-store on a successful quote", async () => {
    const { app, quotes } = buildApp();
    (quotes.quoteEthXlm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(QUOTE);

    const res = await request(app)
      .get("/api/quotes/eth-xlm")
      .query({ amount: "1000" });

    expect(res.status).toBe(200);
    expectNonCacheable(res.headers);
  });

  it("sets no-store on a rejected quote request", async () => {
    const { app } = buildApp();

    // A repeated `amount` is refused before the quoter is called.
    const res = await request(app).get("/api/quotes/eth-xlm?amount=1&amount=2");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_amount");
    expectNonCacheable(res.headers);
  });
});

describe("secret routes are non-cacheable", () => {
  it("sets no-store on a successful reveal", async () => {
    const { app, secrets } = buildApp();
    (secrets.reveal as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post("/api/secrets/reveal")
      .set("Content-Type", "application/json")
      .send({
        publicId: "order-1",
        preimage: "0x" + "b".repeat(64),
        txHash: "0xdead"
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expectNonCacheable(res.headers);
  });

  it("sets no-store on a rejected reveal", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post("/api/secrets/reveal")
      .set("Content-Type", "application/json")
      .send({ publicId: "order-1" /* missing preimage and txHash */ });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expectNonCacheable(res.headers);
  });
});

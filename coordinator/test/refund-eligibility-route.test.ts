import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "../src/server/app.js";
import type { OrderService } from "../src/services/order-service.js";
import type { SecretService } from "../src/services/secret-service.js";
import type { QuoteService } from "../src/services/quote-service.js";
import type { OrderRow } from "../src/persistence/orders-repo.js";

const log = pino({ level: "silent" });

const SAMPLE_ORDER: OrderRow = {
  id: 1,
  publicId: "order-123",
  direction: "eth_to_xlm",
  status: "src_locked",
  hashlock: ("0x" + "a".repeat(64)) as `0x${string}`,
  srcChain: "ethereum",
  srcAddress: "0x1111111111111111111111111111111111111111",
  srcAsset: "native",
  srcAmount: "1000000000000000000",
  srcSafetyDeposit: "0",
  srcOrderId: "1",
  srcLockTx: "0xlock",
  srcLockBlock: 100,
  srcTimelock: Math.floor(Date.now() / 1000) - 500, // Expired
  dstChain: "stellar",
  dstAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422",
  dstAsset: "native",
  dstAmount: "100000000",
  dstOrderId: null,
  dstLockTx: null,
  dstLockBlock: null,
  dstTimelock: null,
  preimage: null,
  secretRevealedTx: null,
  resolverAddress: null,
  fixture: false,
  createdAt: 1700000000,
  updatedAt: 1700000100,
};

function buildApp() {
  const orders = {
    announce: vi.fn(),
    get: vi.fn().mockImplementation(async (id: string) => {
      if (id === "order-123") return SAMPLE_ORDER;
      return null;
    }),
    getRefundEligibility: vi.fn().mockImplementation(async (id: string) => {
      if (id === "order-123") {
        return {
          eligible: true,
          reasonCode: "eligible",
          reason: "eligible",
          timeRemainingSeconds: 0,
        };
      }
      return {
        eligible: false,
        reasonCode: "unknown_order",
        reason: "unknown order",
        timeRemainingSeconds: 0,
      };
    }),
    history: vi.fn().mockResolvedValue([SAMPLE_ORDER]),
    recordSrcLock: vi.fn(),
    recordDstLock: vi.fn(),
  } as unknown as OrderService;

  const secrets = { reveal: vi.fn(), get: vi.fn() } as unknown as SecretService;
  const quotes = {} as unknown as QuoteService;

  const app = createApp({ log, corsOrigins: ["*"], maxRequestBodyBytes: 1024 * 1024, orders, secrets, quotes });
  return { app, orders };
}

describe("GET /api/orders/:id/refund-eligibility", () => {
  it("returns 200 with refund eligibility details for a valid order", async () => {
    const { app } = buildApp();

    const res = await request(app).get("/api/orders/order-123/refund-eligibility");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: "order-123",
      refundEligibility: {
        eligible: true,
        reasonCode: "eligible",
        reason: "eligible",
        timeRemainingSeconds: 0,
      },
    });
  });

  it("returns 404 with unknown_order reason code for an unknown order", async () => {
    const { app } = buildApp();

    const res = await request(app).get("/api/orders/non-existent/refund-eligibility");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
    expect(res.body.refundEligibility).toEqual({
      eligible: false,
      reasonCode: "unknown_order",
      reason: "unknown order",
      timeRemainingSeconds: 0,
    });
  });

  it("includes refundEligibility in GET /api/orders/history response", async () => {
    const { app } = buildApp();

    const res = await request(app).get("/api/orders/history?address=0x1111111111111111111111111111111111111111");

    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    const tx = res.body.transactions[0];
    expect(tx.id).toBe("order-123");
    expect(tx.refundEligibility).toBeDefined();
    expect(tx.refundEligibility.eligible).toBe(true);
    expect(tx.refundEligibility.reasonCode).toBe("eligible");
  });
});

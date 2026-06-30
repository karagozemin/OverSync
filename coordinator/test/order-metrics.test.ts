import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import pino from "pino";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { OrderService } from "../src/services/order-service.js";
import { orderMetricsRoutes } from "../src/server/routes/metrics.js";

const log = pino({ level: "silent" });

const VALID_HASHLOCK_BASE = "0x" + "a".repeat(64);
const VALID_ETH_ADDR = "0x1111111111111111111111111111111111111111";
const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";

function makeHashlock(seed: string): string {
  return "0x" + seed.padStart(64, "0").slice(0, 64);
}

async function seedOrders(orders: OrderService) {
  const announced = await orders.announce({
    direction: "eth_to_xlm",
    hashlock: makeHashlock("aa"),
    srcChain: "ethereum",
    srcAddress: VALID_ETH_ADDR,
    srcAsset: "native",
    srcAmount: "100",
    srcSafetyDeposit: "10",
    dstChain: "stellar",
    dstAddress: VALID_STELLAR_ADDR,
    dstAsset: "native",
    dstAmount: "100000"
  });

  const srcLocked = await orders.announce({
    direction: "xlm_to_eth",
    hashlock: makeHashlock("bb"),
    srcChain: "stellar",
    srcAddress: VALID_STELLAR_ADDR,
    srcAsset: "native",
    srcAmount: "200",
    srcSafetyDeposit: "20",
    dstChain: "ethereum",
    dstAddress: VALID_ETH_ADDR,
    dstAsset: "native",
    dstAmount: "200000"
  });
  await orders.recordSrcLock({
    publicId: srcLocked.publicId,
    orderId: "src-1",
    txHash: "0xaaa",
    blockNumber: 1,
    timelock: 1000
  });

  const dstLocked = await orders.announce({
    direction: "eth_to_xlm",
    hashlock: makeHashlock("cc"),
    srcChain: "ethereum",
    srcAddress: VALID_ETH_ADDR,
    srcAsset: "native",
    srcAmount: "300",
    srcSafetyDeposit: "30",
    dstChain: "stellar",
    dstAddress: VALID_STELLAR_ADDR,
    dstAsset: "native",
    dstAmount: "300000"
  });
  await orders.recordSrcLock({
    publicId: dstLocked.publicId,
    orderId: "src-2",
    txHash: "0xbbb",
    blockNumber: 2,
    timelock: 2000
  });
  await orders.recordDstLock({
    publicId: dstLocked.publicId,
    orderId: "dst-1",
    txHash: "0xccc",
    blockNumber: 3,
    timelock: 3000,
    resolver: null
  });

  const completed = await orders.announce({
    direction: "eth_to_xlm",
    hashlock: makeHashlock("dd"),
    srcChain: "ethereum",
    srcAddress: VALID_ETH_ADDR,
    srcAsset: "native",
    srcAmount: "400",
    srcSafetyDeposit: "40",
    dstChain: "stellar",
    dstAddress: VALID_STELLAR_ADDR,
    dstAsset: "native",
    dstAmount: "400000"
  });
  await orders.recordSrcLock({
    publicId: completed.publicId,
    orderId: "src-3",
    txHash: "0xddd",
    blockNumber: 4,
    timelock: 4000
  });
  await orders.recordDstLock({
    publicId: completed.publicId,
    orderId: "dst-2",
    txHash: "0xeee",
    blockNumber: 5,
    timelock: 5000,
    resolver: null
  });
  await orders.recordSecret(completed.publicId, "0xdeadbeef", "0xfff");
  await orders.markStatus(completed.publicId, "completed");

  const refunded = await orders.announce({
    direction: "eth_to_xlm",
    hashlock: makeHashlock("ee"),
    srcChain: "ethereum",
    srcAddress: VALID_ETH_ADDR,
    srcAsset: "native",
    srcAmount: "500",
    srcSafetyDeposit: "50",
    dstChain: "stellar",
    dstAddress: VALID_STELLAR_ADDR,
    dstAsset: "native",
    dstAmount: "500000"
  });
  await orders.recordSrcLock({
    publicId: refunded.publicId,
    orderId: "src-4",
    txHash: "0xggg",
    blockNumber: 6,
    timelock: 6000
  });
  await orders.markStatus(refunded.publicId, "refunded");

  const expired = await orders.announce({
    direction: "eth_to_xlm",
    hashlock: makeHashlock("ff"),
    srcChain: "ethereum",
    srcAddress: VALID_ETH_ADDR,
    srcAsset: "native",
    srcAmount: "600",
    srcSafetyDeposit: "60",
    dstChain: "stellar",
    dstAddress: VALID_STELLAR_ADDR,
    dstAsset: "native",
    dstAmount: "600000"
  });
  await orders.markStatus(expired.publicId, "expired");
}

describe("GET /api/metrics", () => {
  async function makeApp() {
    const dir = mkdtempSync(resolve(tmpdir(), "oversync-metrics-test-"));
    const db = await openDatabase(`file:${dir}/test.db`);
    const repo = new OrdersRepository(db);
    const orders = new OrderService(repo, log);
    await seedOrders(orders);

    const app = express();
    app.use("/api", orderMetricsRoutes(orders));
    return app;
  }

  it("returns aggregate metrics with counts by status", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/metrics").expect(200);

    expect(res.body).toHaveProperty("totalOrders");
    expect(res.body).toHaveProperty("byStatus");
    expect(res.body).toHaveProperty("completedOrders");
    expect(res.body).toHaveProperty("refundedOrders");
    expect(res.body).toHaveProperty("staleExpiredOrders");
    expect(res.body).toHaveProperty("lastUpdatedTimestamp");

    expect(res.body.totalOrders).toBe(6);

    expect(res.body.byStatus).toMatchObject({
      announced: 1,
      src_locked: 1,
      dst_locked: 1,
      completed: 1,
      refunded: 1,
      expired: 1
    });

    expect(res.body.completedOrders).toBe(1);
    expect(res.body.refundedOrders).toBe(1);
    expect(res.body.staleExpiredOrders).toBe(1); // expired only (no failed)

    expect(res.body.lastUpdatedTimestamp).toEqual(expect.any(Number));
  });

  it("returns zero metrics when no orders exist", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oversync-metrics-empty-"));
    const db = await openDatabase(`file:${dir}/test.db`);
    const repo = new OrdersRepository(db);
    const orders = new OrderService(repo, log);

    const app = express();
    app.use("/api", orderMetricsRoutes(orders));

    const res = await request(app).get("/api/metrics").expect(200);

    expect(res.body).toEqual({
      totalOrders: 0,
      byStatus: {},
      completedOrders: 0,
      refundedOrders: 0,
      staleExpiredOrders: 0,
      lastUpdatedTimestamp: null
    });
  });

  it("does not expose raw secrets, preimages, or user identifiers", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/metrics").expect(200);
    const json = JSON.stringify(res.body);

    expect(json).not.toContain("hashlock");
    expect(json).not.toContain("preimage");
    expect(json).not.toContain(VALID_ETH_ADDR);
    expect(json).not.toContain(VALID_STELLAR_ADDR);
    expect(json).not.toContain("0xdeadbeef");
  });
});

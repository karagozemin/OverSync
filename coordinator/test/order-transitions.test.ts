import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import pino from "pino";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openDatabase } from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { OrderService } from "../src/services/order-service.js";
import { ordersRoutes } from "../src/server/routes/orders.js";

const log = pino({ level: "silent" });
const VALID_HASHLOCK = "0x" + "a".repeat(64);
const VALID_ETH_ADDR = "0x1111111111111111111111111111111111111111";
const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";
const PREIMAGE = "0x" + "d".repeat(64);

async function freshDb() {
  const dir = mkdtempSync(resolve(tmpdir(), "oversync-transition-test-"));
  return openDatabase(`file:${dir}/test.db`);
}

function buildOrderService(db: Awaited<ReturnType<typeof freshDb>>) {
  return new OrderService(new OrdersRepository(db), log);
}

function buildApp(orders: OrderService) {
  const app = express();
  app.use("/api", ordersRoutes(orders));
  return app;
}

describe("OrderService transition summaries", () => {
  it("returns happy-path transitions without leaking preimage values", async () => {
    const db = await freshDb();
    const orders = buildOrderService(db);

    const order = await orders.announce({
      direction: "eth_to_xlm",
      hashlock: VALID_HASHLOCK,
      srcChain: "ethereum",
      srcAddress: VALID_ETH_ADDR,
      srcAsset: "native",
      srcAmount: "1000000000000000000",
      srcSafetyDeposit: "1000000000000000",
      dstChain: "stellar",
      dstAddress: VALID_STELLAR_ADDR,
      dstAsset: "native",
      dstAmount: "100000000"
    });

    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "src-1",
      txHash: "0xsrc",
      blockNumber: 1,
      timelock: 1000
    });
    await orders.recordDstLock({
      publicId: order.publicId,
      orderId: "dst-1",
      txHash: "0xdst",
      blockNumber: 2,
      timelock: 2000,
      resolver: null
    });
    await orders.recordSecret(order.publicId, PREIMAGE, "0xsecret");

    const transitions = await orders.getTransitions(order.publicId);

    expect(transitions.map((transition) => transition.to)).toEqual([
      "announced",
      "src_locked",
      "dst_locked",
      "secret_revealed"
    ]);
    expect(transitions[0]).toMatchObject({ from: null, to: "announced", category: "created", txHash: null });
    expect(transitions[3]).toMatchObject({ from: "dst_locked", to: "secret_revealed", category: "secret_revealed", txHash: "0xsecret" });
    expect(JSON.stringify(transitions)).not.toContain("preimage");
    expect(JSON.stringify(transitions)).not.toContain(PREIMAGE);
  });

  it("returns refund-path transitions for refunded orders", async () => {
    const db = await freshDb();
    const orders = buildOrderService(db);

    const order = await orders.announce({
      direction: "eth_to_xlm",
      hashlock: "0x" + "b".repeat(64),
      srcChain: "ethereum",
      srcAddress: VALID_ETH_ADDR,
      srcAsset: "native",
      srcAmount: "1",
      srcSafetyDeposit: "1",
      dstChain: "stellar",
      dstAddress: VALID_STELLAR_ADDR,
      dstAsset: "native",
      dstAmount: "1"
    });

    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "src-2",
      txHash: "0xsrc2",
      blockNumber: 3,
      timelock: 3000
    });
    await orders.markStatus(order.publicId, "refunded");

    const transitions = await orders.getTransitions(order.publicId);

    expect(transitions.map((transition) => transition.to)).toEqual([
      "announced",
      "src_locked",
      "refunded"
    ]);
    expect(transitions[2]).toMatchObject({ from: "src_locked", to: "refunded", category: "refunded", txHash: null });
  });
});

describe("GET /api/orders/:id/transitions", () => {
  it("returns happy-path transition history without exposing secret fields", async () => {
    const db = await freshDb();
    const orders = buildOrderService(db);
    const app = buildApp(orders);

    const order = await orders.announce({
      direction: "eth_to_xlm",
      hashlock: VALID_HASHLOCK,
      srcChain: "ethereum",
      srcAddress: VALID_ETH_ADDR,
      srcAsset: "native",
      srcAmount: "100",
      srcSafetyDeposit: "10",
      dstChain: "stellar",
      dstAddress: VALID_STELLAR_ADDR,
      dstAsset: "native",
      dstAmount: "100"
    });

    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "src-3",
      txHash: "0xsrc3",
      blockNumber: 4,
      timelock: 4000
    });
    await orders.recordDstLock({
      publicId: order.publicId,
      orderId: "dst-3",
      txHash: "0xdst3",
      blockNumber: 5,
      timelock: 5000,
      resolver: null
    });
    await orders.recordSecret(order.publicId, PREIMAGE, "0xsecret3");

    const res = await request(app).get(`/api/orders/${order.publicId}/transitions`).expect(200);

    expect(res.body.transitions).toHaveLength(4);
    expect(res.body.transitions.map((transition: any) => transition.to)).toEqual([
      "announced",
      "src_locked",
      "dst_locked",
      "secret_revealed"
    ]);
    expect(JSON.stringify(res.body)).not.toContain("preimage");
    expect(JSON.stringify(res.body)).not.toContain(PREIMAGE);
  });

  it("returns refund transitions for a refunded order", async () => {
    const db = await freshDb();
    const orders = buildOrderService(db);
    const app = buildApp(orders);

    const order = await orders.announce({
      direction: "eth_to_xlm",
      hashlock: "0x" + "c".repeat(64),
      srcChain: "ethereum",
      srcAddress: VALID_ETH_ADDR,
      srcAsset: "native",
      srcAmount: "1",
      srcSafetyDeposit: "1",
      dstChain: "stellar",
      dstAddress: VALID_STELLAR_ADDR,
      dstAsset: "native",
      dstAmount: "1"
    });

    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "src-4",
      txHash: "0xsrc4",
      blockNumber: 6,
      timelock: 6000
    });
    await orders.markStatus(order.publicId, "refunded");

    const res = await request(app).get(`/api/orders/${order.publicId}/transitions`).expect(200);

    expect(res.body.transitions.map((transition: any) => transition.to)).toEqual([
      "announced",
      "src_locked",
      "refunded"
    ]);
    expect(res.body.transitions[2]).toMatchObject({ from: "src_locked", to: "refunded", category: "refunded" });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { OrderService } from "../src/services/order-service.js";
import { ordersRoutes } from "../src/server/routes/orders.js";
import { openDatabase } from "../src/persistence/db.js";
import pino from "pino";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const log = pino({ level: "silent" });

async function freshDb() {
  const dir = mkdtempSync(resolve(tmpdir(), "oversync-api-test-"));
  return openDatabase(`file:${dir}/test.db`);
}

describe("Coordinator API Error Mapping", () => {
  let app: express.Application;
  let orderRepo: OrdersRepository;
  let orderService: OrderService;

  beforeEach(async () => {
    const db = await freshDb();
    orderRepo = new OrdersRepository(db);
    orderService = new OrderService(orderRepo, log);
    app = express();
    app.use(express.json());
    app.use(ordersRoutes(orderService));
    app.use((err: any, req: any, res: any, next: any) => {
      res.status(500).json({ error: "internal_error", message: err.message });
    });
  });

  it("maps Zod validation errors to VALIDATION_FAILED", async () => {
    const res = await request(app)
      .post("/orders/announce")
      .send({ direction: "invalid_direction" });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_FAILED");
    expect(res.body.message).toBe("The order failed validation checks.");
  });

  it("maps OrderValidationError to its specific failure code", async () => {
    const res = await request(app)
      .post("/orders/announce")
      .send({
        direction: "eth_to_xlm",
        hashlock: "0x" + "a".repeat(64),
        srcChain: "ethereum",
        srcAddress: "not-an-address",
        srcAsset: "native",
        srcAmount: "100",
        srcSafetyDeposit: "10",
        dstChain: "stellar",
        dstAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422",
        dstAsset: "native",
        dstAmount: "100"
      });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_FAILED");
    expect(res.body.message).toBe("The order failed validation checks.");
  });

  it("maps missing orders to ORDER_NOT_FOUND", async () => {
    const res = await request(app).get("/orders/non-existent");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("ORDER_NOT_FOUND");
    expect(res.body.message).toBe("The requested order could not be found.");
  });

  it("maps missing address in history to VALIDATION_FAILED", async () => {
    const res = await request(app).get("/orders/history");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_FAILED");
    expect(res.body.message).toBe("The order failed validation checks.");
  });

  it("maps OrderValidationError in src-locked to its failure code", async () => {
    // First announce an order
    const announceRes = await request(app)
      .post("/orders/announce")
      .send({
        direction: "eth_to_xlm",
        hashlock: "0x" + "b".repeat(64),
        srcChain: "ethereum",
        srcAddress: "0x1111111111111111111111111111111111111111",
        srcAsset: "native",
        srcAmount: "100",
        srcSafetyDeposit: "10",
        dstChain: "stellar",
        dstAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422",
        dstAsset: "native",
        dstAmount: "100"
      });
    const publicId = announceRes.body.id;

    // Attempt to record src lock on an order that can't transition (already src_locked)
    await request(app)
      .post(`/orders/${publicId}/src-locked`)
      .send({ orderId: "1", txHash: "0x1", blockNumber: 1, timelock: 1 });
    
    const res = await request(app)
      .post(`/orders/${publicId}/src-locked`)
      .send({ orderId: "2", txHash: "0x2", blockNumber: 2, timelock: 2 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_FAILED");
  });
});

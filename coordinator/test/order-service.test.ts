import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { OrderService, OrderValidationError } from "../src/services/order-service.js";
import { SecretService } from "../src/services/secret-service.js";

const log = pino({ level: "silent" });

const VALID_HASHLOCK = "0x" + "a".repeat(64);
const VALID_ETH_ADDR = "0x1111111111111111111111111111111111111111";
const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";

async function freshDb() {
  const dir = mkdtempSync(resolve(tmpdir(), "oversync-test-"));
  return openDatabase(`file:${dir}/test.db`);
}

describe("OrderService", () => {
  it("announces an eth->xlm order and round-trips it via getById/history", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);

    const order = orders.announce({
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
    expect(order.publicId).toMatch(/^[a-f0-9]{32}$/);
    expect(order.status).toBe("announced");

    const byId = orders.get(order.publicId);
    expect(byId).not.toBeNull();
    expect(byId!.hashlock).toBe(VALID_HASHLOCK);

    const list = orders.history(VALID_ETH_ADDR);
    expect(list).toHaveLength(1);
  });

  it("rejects duplicate hashlocks", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    orders.announce({
      direction: "eth_to_xlm",
      hashlock: VALID_HASHLOCK,
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

    expect(() =>
      orders.announce({
        direction: "eth_to_xlm",
        hashlock: VALID_HASHLOCK,
        srcChain: "ethereum",
        srcAddress: VALID_ETH_ADDR,
        srcAsset: "native",
        srcAmount: "1",
        srcSafetyDeposit: "1",
        dstChain: "stellar",
        dstAddress: VALID_STELLAR_ADDR,
        dstAsset: "native",
        dstAmount: "1"
      })
    ).toThrowError(OrderValidationError);
  });

  it("rejects mismatched direction / chains", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    expect(() =>
      orders.announce({
        direction: "eth_to_xlm",
        hashlock: VALID_HASHLOCK,
        srcChain: "stellar",
        srcAddress: VALID_STELLAR_ADDR,
        srcAsset: "native",
        srcAmount: "1",
        srcSafetyDeposit: "1",
        dstChain: "ethereum",
        dstAddress: VALID_ETH_ADDR,
        dstAsset: "native",
        dstAmount: "1"
      })
    ).toThrowError(OrderValidationError);
  });
});

describe("SecretService", () => {
  it("rejects a preimage that doesn't hash to the order's hashlock", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    const order = orders.announce({
      direction: "eth_to_xlm",
      hashlock: VALID_HASHLOCK,
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
    const secrets = new SecretService(orders, log);
    // Need src_locked status first
    orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xdead",
      blockNumber: 1,
      timelock: 0
    });
    expect(() => secrets.reveal(order.publicId, "0xdeadbeef", "0xtx")).toThrow();
  });
});

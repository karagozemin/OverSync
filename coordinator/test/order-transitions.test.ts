import { describe, it, expect } from "vitest";
import pino from "pino";
import { dirname, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { OrderService } from "../src/services/order-service.js";

const log = pino({ level: "silent" });

const VALID_HASHLOCK = "0x" + "a".repeat(64);
const VALID_ETH_ADDR = "0x1111111111111111111111111111111111111111";
const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";

async function freshDb() {
  const dir = mkdtempSync(resolve(tmpdir(), "oversync-test-"));
  return openDatabase(`file:${dir}/test.db`);
}

describe("Order transitions", () => {
  it("records happy-path transitions (announce → src_locked → dst_locked → secret_revealed → completed)", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);

    const order = await orders.announce({
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

    await orders.recordSrcLock({ publicId: order.publicId, orderId: "1", txHash: "0xsrc", blockNumber: 1, timelock: 0 });
    await orders.recordDstLock({ publicId: order.publicId, orderId: "2", txHash: "0xdst", blockNumber: 2, timelock: 0, resolver: null });
    await orders.recordSecret(order.publicId, "0x" + "c".repeat(64), "0xsecret");
    await orders.markStatus(order.publicId, "completed");

    const transitions = await orders.getTransitions(order.publicId);
    expect(transitions.map((t) => t.to)).toEqual(["announced", "src_locked", "dst_locked", "secret_revealed", "completed"]);
    const src = transitions.find((t) => t.category === "src_lock");
    const dst = transitions.find((t) => t.category === "dst_lock");
    const secret = transitions.find((t) => t.category === "secret_reveal");
    expect(src?.txHash).toBe("0xsrc");
    expect(dst?.txHash).toBe("0xdst");
    expect(secret?.txHash).toBe("0xsecret");
    // Ensure no preimages are present in transition summaries
    for (const t of transitions) {
      expect((t as any).preimage).toBeUndefined();
    }
  });

  it("records refund transitions", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);

    const order = await orders.announce({
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

    await orders.recordSrcLock({ publicId: order.publicId, orderId: "1", txHash: "0xsrc", blockNumber: 1, timelock: 0 });
    await orders.markStatus(order.publicId, "refunded");

    const transitions = await orders.getTransitions(order.publicId);
    expect(transitions.map((t) => t.to)).toContain("refunded");
  });
});

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/persistence/db.js";
import { OrdersRepository, buildSnapshot, type OrderSnapshot } from "../src/persistence/orders-repo.js";
import { OrderService } from "../src/services/order-service.js";
import pino from "pino";

const log = pino({ level: "silent" });

const VALID_HASH = "0x" + "c".repeat(64);
const VALID_ETH_ADDR = "0x3333333333333333333333333333333333333333";
const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";

const ETH_TO_XLM_ANNOUNCE = {
  direction: "eth_to_xlm" as const,
  hashlock: VALID_HASH,
  srcChain: "ethereum" as const,
  srcAddress: VALID_ETH_ADDR,
  srcAsset: "native",
  srcAmount: "1000000000000000000",
  srcSafetyDeposit: "1000000000000000",
  dstChain: "stellar" as const,
  dstAddress: VALID_STELLAR_ADDR,
  dstAsset: "native",
  dstAmount: "100000000"
};

const XLM_TO_ETH_ANNOUNCE = {
  direction: "xlm_to_eth" as const,
  hashlock: VALID_HASH,
  srcChain: "stellar" as const,
  srcAddress: VALID_STELLAR_ADDR,
  srcAsset: "native",
  srcAmount: "100000000",
  srcSafetyDeposit: "5000000",
  dstChain: "ethereum" as const,
  dstAddress: VALID_ETH_ADDR,
  dstAsset: "native",
  dstAmount: "1000000000000000000"
};

async function freshDb() {
  const dir = mkdtempSync(resolve(tmpdir(), "oversync-snapshot-test-"));
  return openDatabase(`file:${dir}/test.db`);
}

describe("OrderService.getSnapshots", () => {
  it("returns [] when no terminal orders exist", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);

    const snapshots = await orders.getSnapshots();
    expect(snapshots).toEqual([]);
  });

  it("includes a completed order snapshot with sanitised fields", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);

    const order = await orders.announce(ETH_TO_XLM_ANNOUNCE);
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "0",
      txHash: "0xsrctx",
      blockNumber: 100,
      timelock: 200
    });
    await orders.recordDstLock({
      publicId: order.publicId,
      orderId: "0",
      txHash: "0xdsttx",
      blockNumber: 200,
      timelock: 300,
      resolver: null
    });
    await orders.recordSecret(order.publicId, "0x" + "a".repeat(64), "0xsecretx");
    await orders.markStatus(order.publicId, "completed");

    const snapshots = await orders.getSnapshots();
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0]!;
    expect(snapshot.orderId).toBe(order.publicId);
    expect(snapshot.currentState).toBe("completed");
    expect(snapshot.transitions).toEqual(["announced", "src_locked", "dst_locked", "secret_revealed", "completed"]);
    expect(snapshot.publicTxHashes).toContain("0xsrctx");
    expect(snapshot.publicTxHashes).toContain("0xdsttx");
    expect(snapshot.publicTxHashes).toContain("0xsecretx");
    expect(snapshot.direction).toBe("eth_to_xlm");
    expect(snapshot.outcomeSummary).toBe("Order completed successfully");
    // Sanity-check timestamps are instant-like (within 5 seconds of now)
    expect(snapshot.timestamps.createdAt).toBeGreaterThan(Date.now() / 1000 - 5);
    expect(snapshot.timestamps.updatedAt).toBeGreaterThanOrEqual(snapshot.timestamps.createdAt);
  });

  it("does not leak preimage or secrets in completed snapshot", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);

    const order = await orders.announce(XLM_TO_ETH_ANNOUNCE);
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xsrc",
      blockNumber: 1,
      timelock: 0
    });
    await orders.recordDstLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xdst",
      blockNumber: 2,
      timelock: 0,
      resolver: "0xresolver"
    });
    await orders.recordSecret(order.publicId, "secret-value-leaked", "0xsecret");
    await orders.markStatus(order.publicId, "completed");

    const snapshots = await orders.getSnapshots();
    const serialised = JSON.stringify(snapshots);
    expect(serialised).not.toContain("secret-value-leaked");
    expect(serialised).not.toContain("preimage");
    expect(serialised).not.toContain("resolver");
    expect(serialised).not.toContain("0xresolver");
    expect(serialised).not.toContain("hashlock");
  });

  it("includes a refunded order snapshot with correct transitions", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);

    const order = await orders.announce(ETH_TO_XLM_ANNOUNCE);
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "2",
      txHash: "0xsrcrtx",
      blockNumber: 50,
      timelock: 150
    });
    await orders.recordDstLock({
      publicId: order.publicId,
      orderId: "2",
      txHash: "0xdstrtx",
      blockNumber: 100,
      timelock: 200,
      resolver: null
    });
    await orders.markStatus(order.publicId, "refunded");

    const snapshots = await orders.getSnapshots();
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0]!;
    expect(snapshot.orderId).toBe(order.publicId);
    expect(snapshot.currentState).toBe("refunded");
    expect(snapshot.transitions).toEqual(["announced", "src_locked", "dst_locked", "secret_revealed", "refunded"]);
    expect(snapshot.publicTxHashes).toContain("0xsrcrtx");
    expect(snapshot.publicTxHashes).toContain("0xdstrtx");
    expect(snapshot.outcomeSummary).toBe("Order refunded");
  });

  it("includes only terminal orders (excludes announced)", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);

    await orders.announce(ETH_TO_XLM_ANNOUNCE);
    const refunded = await orders.announce({
      ...ETH_TO_XLM_ANNOUNCE,
      hashlock: "0x" + "d".repeat(64)
    });
    await orders.recordSrcLock({
      publicId: refunded.publicId,
      orderId: "r1",
      txHash: "0xr1src",
      blockNumber: 10,
      timelock: 0
    });
    await orders.markStatus(refunded.publicId, "refunded");

    const snapshots = await orders.getSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.orderId).toBe(refunded.publicId);
    expect(snapshots[0]!.currentState).toBe("refunded");
  });

  it("handles multiple terminal orders sorted by updatedAt DESC", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);

    const completed1 = await orders.announce({
      ...ETH_TO_XLM_ANNOUNCE,
      hashlock: "0x" + "e".repeat(64)
    });
    await orders.recordSrcLock({
      publicId: completed1.publicId,
      orderId: "c1",
      txHash: "0xc1src",
      blockNumber: 1,
      timelock: 0
    });
    await orders.recordDstLock({
      publicId: completed1.publicId,
      orderId: "c1",
      txHash: "0xc1dst",
      blockNumber: 2,
      timelock: 0,
      resolver: null
    });
    await orders.recordSecret(completed1.publicId, "secret-c1", "0xc1secret");
    await orders.markStatus(completed1.publicId, "completed");

    const refunded1 = await orders.announce({
      ...ETH_TO_XLM_ANNOUNCE,
      hashlock: "0x" + "f".repeat(64)
    });
    await orders.recordSrcLock({
      publicId: refunded1.publicId,
      orderId: "r1",
      txHash: "0xr1src",
      blockNumber: 10,
      timelock: 0
    });
    await orders.markStatus(refunded1.publicId, "refunded");

    const snapshots = await orders.getSnapshots();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((s) => s.orderId)).toContain(completed1.publicId);
    expect(snapshots.map((s) => s.orderId)).toContain(refunded1.publicId);
    const completedSnapshot = snapshots.find((s) => s.orderId === completed1.publicId)!;
    const refundedSnapshot = snapshots.find((s) => s.orderId === refunded1.publicId)!;
    expect(completedSnapshot.currentState).toBe("completed");
    expect(refundedSnapshot.currentState).toBe("refunded");
    // Order is by updated_at DESC; completed1 gets more transitions so its
    // updatedAt should be >= refunded1's.
    expect(completedSnapshot.timestamps.updatedAt).toBeGreaterThanOrEqual(
      refundedSnapshot.timestamps.updatedAt
    );
    // The array is sorted DESC, so whichever has the higher updatedAt is first.
    const [first, second] = snapshots as [OrderSnapshot, OrderSnapshot];
    const isCompletedFirst = first.orderId === completed1.publicId;
    if (isCompletedFirst) {
      expect(second.orderId).toBe(refunded1.publicId);
    } else {
      expect(first.orderId).toBe(refunded1.publicId);
      expect(second.orderId).toBe(completed1.publicId);
    }
  });
});

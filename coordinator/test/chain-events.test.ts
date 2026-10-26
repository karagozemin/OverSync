import { describe, it, expect } from "vitest";
import pino from "pino";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { OrderService } from "../src/services/order-service.js";
import { SecretService } from "../src/services/secret-service.js";
import {
  ChainEventProcessor,
  CursorMismatchError,
  type SettlementEvent
} from "../src/services/chain-events.js";

const log = pino({ level: "silent" });
const ETH_NET = "ethereum:11155111";
const ETH_ADDR = "0x1111111111111111111111111111111111111111";
const XLM_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";
const PREIMAGE = ("0x" + "ab".repeat(32)) as `0x${string}`;
const HASHLOCK = "0x" + createHash("sha256").update(Buffer.from("ab".repeat(32), "hex")).digest("hex");

// Fixture-driven: no RPC connection is opened anywhere in this file.
async function setup() {
  const dir = mkdtempSync(resolve(tmpdir(), "oversync-chain-events-"));
  const db = await openDatabase(`file:${dir}/test.db`);
  const repo = new OrdersRepository(db);
  const orders = new OrderService(repo, log);
  const secrets = new SecretService(orders, log);
  const events = new ChainEventProcessor(repo, orders, secrets, log);
  const order = await orders.announce({
    direction: "eth_to_xlm",
    hashlock: HASHLOCK,
    srcChain: "ethereum",
    srcAddress: ETH_ADDR,
    srcAsset: "native",
    srcAmount: "1000",
    srcSafetyDeposit: "10",
    dstChain: "stellar",
    dstAddress: XLM_ADDR,
    dstAsset: "native",
    dstAmount: "100"
  });
  const now = Math.floor(Date.now() / 1000);
  await orders.recordSrcLock({
    publicId: order.publicId,
    orderId: "7",
    txHash: "0xlock",
    blockNumber: 100,
    timelock: now + 7200
  });
  return { repo, orders, events, publicId: order.publicId };
}

const claim: SettlementEvent = {
  chain: "ethereum",
  kind: "claimed",
  onchainOrderId: "7",
  txHash: "0xclaimtx",
  logIndex: 3,
  position: 120,
  preimage: PREIMAGE
};
const refund: SettlementEvent = {
  chain: "ethereum",
  kind: "refunded",
  onchainOrderId: "7",
  txHash: "0xrefundtx",
  logIndex: 1,
  position: 130
};

async function transitionCount(repo: OrdersRepository, publicId: string) {
  return (await repo.getTransitions(publicId)).length;
}

describe("ChainEventProcessor", () => {
  it("applies a claim once and skips an identical replayed claim log", async () => {
    const { repo, orders, events, publicId } = await setup();
    expect(await events.process(ETH_NET, claim)).toBe("applied");
    const before = await transitionCount(repo, publicId);

    expect(await events.process(ETH_NET, claim)).toBe("duplicate");
    expect(await transitionCount(repo, publicId)).toBe(before);
    expect((await orders.get(publicId))?.status).toBe("secret_revealed");
  });

  it("applies a refund once and skips an identical replayed refund log", async () => {
    const { repo, orders, events, publicId } = await setup();
    expect(await events.process(ETH_NET, refund)).toBe("applied");
    const before = await transitionCount(repo, publicId);

    expect(await events.process(ETH_NET, refund)).toBe("duplicate");
    expect(await transitionCount(repo, publicId)).toBe(before);
    expect((await orders.get(publicId))?.status).toBe("refunded");
  });

  it("does not refund twice even when the refund arrives in a different log", async () => {
    const { repo, events, publicId } = await setup();
    await events.process(ETH_NET, refund);
    const before = await transitionCount(repo, publicId);
    expect(await events.process(ETH_NET, { ...refund, txHash: "0xother", logIndex: 9 })).toBe("duplicate");
    expect(await transitionCount(repo, publicId)).toBe(before);
  });

  it("ignores a refund after the order was claimed", async () => {
    const { orders, events, publicId } = await setup();
    await events.process(ETH_NET, claim);
    await orders.markStatus(publicId, "completed");
    expect(await events.process(ETH_NET, refund)).toBe("ignored");
    expect((await orders.get(publicId))?.status).toBe("completed");
  });

  it("recovers from a crash after the transition but before the event was marked", async () => {
    const { repo, orders, events, publicId } = await setup();
    // Crash window: the order moved, but processed_chain_events/cursor never persisted.
    await orders.recordRefund(publicId, refund.txHash);
    const before = await transitionCount(repo, publicId);

    const counts = await events.processBatch(ETH_NET, "ethereum", [refund], 130);
    expect(counts.duplicates + counts.applied).toBe(1);
    expect(await transitionCount(repo, publicId)).toBe(before);
    expect((await repo.getChainCursor("ethereum"))?.position).toBe(130);
  });

  it("recovers from a crash after the event was marked but before the cursor moved", async () => {
    const { repo, events, publicId } = await setup();
    await events.process(ETH_NET, claim); // cursor still unset: simulated crash
    expect(await events.resume("ethereum", ETH_NET)).toBeNull();
    const before = await transitionCount(repo, publicId);

    // Restart re-reads the same block range.
    const counts = await events.processBatch(ETH_NET, "ethereum", [claim], 120);
    expect(counts).toEqual({ applied: 0, duplicates: 1, ignored: 0 });
    expect(await transitionCount(repo, publicId)).toBe(before);
  });

  it("ignores events for orders it does not know", async () => {
    const { events } = await setup();
    expect(await events.process(ETH_NET, { ...refund, onchainOrderId: "999" })).toBe("ignored");
  });

  it("rejects a claim whose preimage does not match the hashlock without wedging the cursor", async () => {
    const { events, orders, publicId } = await setup();
    const bad = { ...claim, preimage: ("0x" + "cd".repeat(32)) as `0x${string}` };
    expect(await events.process(ETH_NET, bad)).toBe("ignored");
    expect((await orders.get(publicId))?.status).toBe("src_locked");
  });
});

describe("chain cursors", () => {
  it("persists the cursor and resumes from it", async () => {
    const { events } = await setup();
    expect(await events.resume("ethereum", ETH_NET)).toBeNull();
    await events.advance("ethereum", ETH_NET, 500);
    expect(await events.resume("ethereum", ETH_NET)).toEqual({ position: 500, cursor: null });

    await events.advance("soroban", "Test SDF Network ; September 2015", 42, "cur-1");
    expect(await events.resume("soroban", "Test SDF Network ; September 2015")).toEqual({
      position: 42,
      cursor: "cur-1"
    });
  });

  it("never moves the cursor backwards", async () => {
    const { events } = await setup();
    await events.advance("ethereum", ETH_NET, 500);
    await events.advance("ethereum", ETH_NET, 400);
    expect((await events.resume("ethereum", ETH_NET))?.position).toBe(500);
  });

  it("rejects a cursor saved for a different network on startup", async () => {
    const { events } = await setup();
    await events.advance("ethereum", "ethereum:1", 500);
    await expect(events.resume("ethereum", ETH_NET)).rejects.toBeInstanceOf(CursorMismatchError);
    await expect(events.advance("ethereum", ETH_NET, 600)).rejects.toBeInstanceOf(CursorMismatchError);
  });
});

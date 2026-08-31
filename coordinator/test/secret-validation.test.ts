import { describe, it, expect } from "vitest";
import { sha256, toHex } from "viem";
import pino from "pino";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { OrderService } from "../src/services/order-service.js";
import { SecretService } from "../src/services/secret-service.js";

const log = pino({ level: "silent" });

const VALID_ETH_ADDR = "0x1111111111111111111111111111111111111111";
const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";

function hexToUint8(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const buf = new Uint8Array(clean.length / 2);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return buf;
}

function computeHashlock(preimage: string): string {
  const bytes = hexToUint8(preimage);
  return sha256(toHex(bytes));
}

async function freshDb() {
  const dir = mkdtempSync(resolve(tmpdir(), "oversync-test-"));
  return openDatabase(`file:${dir}/test.db`);
}

import { resolve } from "node:path";

function makeAnnounceInput(hashlock: string) {
  return {
    direction: "eth_to_xlm" as const,
    hashlock,
    srcChain: "ethereum" as const,
    srcAddress: VALID_ETH_ADDR,
    srcAsset: "native",
    srcAmount: "1",
    srcSafetyDeposit: "1",
    dstChain: "stellar" as const,
    dstAddress: VALID_STELLAR_ADDR,
    dstAsset: "native",
    dstAmount: "1"
  };
}

describe("SecretService – zero-value preimage rejection", () => {
  it("rejects an all-zero preimage", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    const secrets = new SecretService(orders, log);
    const zeroPreimage = "0x" + "0".repeat(64);

    const order = await orders.announce(makeAnnounceInput("0x" + "a".repeat(64)));
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xdead",
      blockNumber: 1,
      timelock: 0
    });

    await expect(
      secrets.reveal(order.publicId, zeroPreimage, "0xtx")
    ).rejects.toThrow("preimage must not be all zeros");
  });
});

describe("SecretService – reused preimage rejection", () => {
  it("rejects a preimage that was already revealed for another order", async () => {
    const db = await freshDb();
    const repo = new OrdersRepository(db);
    const orders = new OrderService(repo, log);
    const secrets = new SecretService(orders, log);

    const preimage = "0x" + "ab".repeat(32);
    const hashlock = computeHashlock(preimage);

    // First order — reveal succeeds
    const order1 = await orders.announce(makeAnnounceInput(hashlock));
    await orders.recordSrcLock({
      publicId: order1.publicId,
      orderId: "1",
      txHash: "0xdead",
      blockNumber: 1,
      timelock: 0
    });
    await secrets.reveal(order1.publicId, preimage, "0xtx1");

    // Insert a second order with the same hashlock directly via repo
    // (bypasses announce duplicate-hashlock check to simulate a scenario
    // where the same preimage could be reused)
    await repo.insertOrder({
      publicId: "order3",
      direction: "xlm_to_eth",
      status: "src_locked",
      hashlock,
      srcChain: "stellar",
      srcAddress: VALID_STELLAR_ADDR,
      srcAsset: "native",
      srcAmount: "1",
      srcSafetyDeposit: "1",
      srcOrderId: "3",
      srcLockTx: "0xdead3",
      srcLockBlock: 3,
      srcTimelock: 0,
      dstChain: "ethereum",
      dstAddress: VALID_ETH_ADDR,
      dstAsset: "native",
      dstAmount: "1",
      dstOrderId: null,
      dstLockTx: null,
      dstLockBlock: null,
      dstTimelock: null,
      preimage: null,
      secretRevealedTx: null,
      resolverAddress: null,
      fixture: false
    });

    await expect(
      secrets.reveal("order3", preimage, "0xtx2")
    ).rejects.toThrow("preimage already used in another order");
  });

  it("allows re-revealing the same preimage for the same order (idempotent)", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    const secrets = new SecretService(orders, log);

    const preimage = "0x" + "cd".repeat(32);
    const hashlock = computeHashlock(preimage);

    const order = await orders.announce(makeAnnounceInput(hashlock));
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xdead",
      blockNumber: 1,
      timelock: 0
    });

    await secrets.reveal(order.publicId, preimage, "0xtx1");
    await expect(
      secrets.reveal(order.publicId, preimage, "0xtx2")
    ).resolves.toEqual({ ok: true });
  });
});

describe("SecretService – valid secret acceptance", () => {
  it("accepts a valid non-zero preimage that matches the hashlock", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    const secrets = new SecretService(orders, log);

    const preimage = "0x" + "ef".repeat(32);
    const hashlock = computeHashlock(preimage);

    const order = await orders.announce(makeAnnounceInput(hashlock));
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xdead",
      blockNumber: 1,
      timelock: 0
    });

    await expect(
      secrets.reveal(order.publicId, preimage, "0xtx")
    ).resolves.toEqual({ ok: true });
  });
});

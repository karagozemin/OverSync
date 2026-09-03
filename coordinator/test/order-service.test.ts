import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDatabase, PostgresStatement } from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { OrderService, OrderValidationError, StaleOrderEventError } from "../src/services/order-service.js";
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
    expect(order.publicId).toMatch(/^[a-f0-9]{32}$/);
    expect(order.status).toBe("announced");

    const byId = await orders.get(order.publicId);
    expect(byId).not.toBeNull();
    expect(byId!.hashlock).toBe(VALID_HASHLOCK);

    const list = await orders.history(VALID_ETH_ADDR);
    expect(list).toHaveLength(1);
  });

  it("rejects duplicate hashlocks", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    await orders.announce({
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

    await expect(
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
    ).rejects.toThrowError(OrderValidationError);
  });

  it("rejects mismatched direction / chains", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    await expect(
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
    ).rejects.toThrowError(OrderValidationError);
  });

  it("rejects all-zero hashlocks", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    const zeroHashlock = "0x" + "0".repeat(64);
    await expect(
      orders.announce({
        direction: "eth_to_xlm",
        hashlock: zeroHashlock,
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
    ).rejects.toThrowError(OrderValidationError);
  });

  it("normalizes uppercase hashlocks to lowercase before storage", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    const uppercaseHashlock = "0x" + "A".repeat(64);
    const order = await orders.announce({
      direction: "eth_to_xlm",
      hashlock: uppercaseHashlock,
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
    expect(order.hashlock).toBe("0x" + "a".repeat(64));
  });

  it("detects duplicate hashlocks across different casings", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    await orders.announce({
      direction: "eth_to_xlm",
      hashlock: "0x" + "A".repeat(64),
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
    await expect(
      orders.announce({
        direction: "eth_to_xlm",
        hashlock: "0x" + "a".repeat(64),
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
    ).rejects.toThrowError(OrderValidationError);
  });

  it("ignores an exact duplicate lock event but rejects a conflicting one", async () => {
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
    const event = { publicId: order.publicId, orderId: "src-1", txHash: "0xsrc", blockNumber: 4, timelock: 1000 };
    await orders.recordSrcLock(event);
    await expect(orders.recordSrcLock(event)).resolves.toBeUndefined();
    await expect(orders.recordSrcLock({ ...event, txHash: "0xother" })).rejects.toBeInstanceOf(StaleOrderEventError);
    expect((await orders.getTransitions(order.publicId)).map((transition) => transition.to)).toEqual(["announced", "src_locked"]);
  });

  it("rejects delayed source events after the destination has advanced", async () => {
    const db = await freshDb();
    const orders = new OrderService(new OrdersRepository(db), log);
    const order = await orders.announce({
      direction: "eth_to_xlm",
      hashlock: "0x" + "e".repeat(64),
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
    await orders.recordSrcLock({ publicId: order.publicId, orderId: "src-1", txHash: "0xsrc", blockNumber: 4, timelock: 3000 });
    await orders.recordDstLock({ publicId: order.publicId, orderId: "dst-1", txHash: "0xdst", blockNumber: 5, timelock: 2000, resolver: null });
    await expect(orders.recordSrcLock({ publicId: order.publicId, orderId: "src-old", txHash: "0xold", blockNumber: 3, timelock: 2000 })).rejects.toBeInstanceOf(StaleOrderEventError);
  });

});

describe("SecretService", () => {
  it("rejects a preimage that doesn't hash to the order's hashlock", async () => {
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
    const secrets = new SecretService(orders, log);
    // Need src_locked status first
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xdead",
      blockNumber: 1,
      timelock: 0
    });
    await expect(secrets.reveal(order.publicId, "0xdeadbeef", "0xtx")).rejects.toThrow();
  });
});

describe("PostgresStatement", () => {
  it("uses async execution and converts SQLite timestamp expressions", async () => {
    const query = vi.fn(async () => ({ rowCount: 1, rows: [] }));
    const stmt = new PostgresStatement(
      { query } as unknown as ConstructorParameters<typeof PostgresStatement>[0],
      `
        UPDATE orders
        SET updated_at = CAST(strftime('%s','now') AS INTEGER)
        WHERE public_id = :publicId
      `
    );

    await stmt.runAsync({ publicId: "order-1" });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("CAST(EXTRACT(EPOCH FROM NOW()) AS INTEGER)"),
      ["order-1"]
    );
  });
});

describe("OrderService timelock ordering", () => {
  const MIN_GAP = 600;

  async function announcedOrder(db: Awaited<ReturnType<typeof freshDb>>) {
    const orders = new OrderService(new OrdersRepository(db), log, undefined, {
      timelockSafetyGapSeconds: MIN_GAP
    } as ReturnType<typeof import("../src/config.js").loadConfig>);
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
    return { orders, order };
  }

  it("rejects reversed timelocks when recording dst lock", async () => {
    const db = await freshDb();
    const { orders, order } = await announcedOrder(db);
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xsrc",
      blockNumber: 1,
      timelock: 5_000
    });

    await expect(
      orders.recordDstLock({
        publicId: order.publicId,
        orderId: "1",
        txHash: "0xdst",
        blockNumber: 2,
        timelock: 6_000,
        resolver: null
      })
    ).rejects.toMatchObject({ code: "TIMELOCKS_REVERSED" });
  });

  it("rejects equal timelocks when recording dst lock", async () => {
    const db = await freshDb();
    const { orders, order } = await announcedOrder(db);
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xsrc",
      blockNumber: 1,
      timelock: 10_000
    });

    await expect(
      orders.recordDstLock({
        publicId: order.publicId,
        orderId: "1",
        txHash: "0xdst",
        blockNumber: 2,
        timelock: 10_000,
        resolver: null
      })
    ).rejects.toMatchObject({ code: "TIMELOCKS_REVERSED" });
  });

  it("rejects gap-too-small timelocks when recording dst lock", async () => {
    const db = await freshDb();
    const { orders, order } = await announcedOrder(db);
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xsrc",
      blockNumber: 1,
      timelock: 10_000
    });

    await expect(
      orders.recordDstLock({
        publicId: order.publicId,
        orderId: "1",
        txHash: "0xdst",
        blockNumber: 2,
        timelock: 9_500,
        resolver: null
      })
    ).rejects.toMatchObject({ code: "GAP_TOO_SMALL" });
  });

  it("accepts dst lock when gap is exactly minGap", async () => {
    const db = await freshDb();
    const { orders, order } = await announcedOrder(db);
    const srcTimelock = 10_000;
    const dstTimelock = srcTimelock - MIN_GAP;
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xsrc",
      blockNumber: 1,
      timelock: srcTimelock
    });

    await expect(
      orders.recordDstLock({
        publicId: order.publicId,
        orderId: "1",
        txHash: "0xdst",
        blockNumber: 2,
        timelock: dstTimelock,
        resolver: null
      })
    ).resolves.toBeUndefined();
  });
});

describe("OrderService address canonicalization", () => {
  // Sepolia USDC: valid EIP-55 mixed-case form, lowercase canonical form,
  // and a mixed-case form with a deliberately broken EIP-55 checksum.
  const ETH_CHECKSUMMED = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  const ETH_LOWER = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
  const ETH_BAD_CHECKSUM = "0x1c7d4B196Cb0C7B01d743Fbc6116a902379C7238";
  const ETH_MALFORMED_39 = "0xa0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b";

  let hashlockCounter = 0;
  function nextHashlock(): string {
    hashlockCounter += 1;
    return ("0x" + hashlockCounter.toString(16).padStart(2, "0") + "b".repeat(62)) as string;
  }

  async function freshOrders(db: Awaited<ReturnType<typeof freshDb>>) {
    const orders = new OrderService(new OrdersRepository(db), log);
    return orders;
  }

  it("stores an EIP-55 checksummed Ethereum address in lowercase canonical form", async () => {
    const db = await freshDb();
    const orders = await freshOrders(db);

    const order = await orders.announce({
      direction: "eth_to_xlm",
      hashlock: nextHashlock(),
      srcChain: "ethereum",
      srcAddress: ETH_CHECKSUMMED,
      srcAsset: "native",
      srcAmount: "1",
      srcSafetyDeposit: "1",
      dstChain: "stellar",
      dstAddress: VALID_STELLAR_ADDR,
      dstAsset: "native",
      dstAmount: "1"
    });

    expect(order.srcAddress).toBe(ETH_LOWER);
    const stored = await orders.get(order.publicId);
    expect(stored!.srcAddress).toBe(ETH_LOWER);
  });

  it("stores a whitespace-padded Ethereum address trimmed", async () => {
    const db = await freshDb();
    const orders = await freshOrders(db);

    const order = await orders.announce({
      direction: "eth_to_xlm",
      hashlock: nextHashlock(),
      srcChain: "ethereum",
      srcAddress: `  ${ETH_CHECKSUMMED}\t`,
      srcAsset: "native",
      srcAmount: "1",
      srcSafetyDeposit: "1",
      dstChain: "stellar",
      dstAddress: VALID_STELLAR_ADDR,
      dstAsset: "native",
      dstAmount: "1"
    });

    expect(order.srcAddress).toBe(ETH_LOWER);
  });

  it("stores a whitespace-padded Stellar address trimmed", async () => {
    const db = await freshDb();
    const orders = await freshOrders(db);

    const order = await orders.announce({
      direction: "eth_to_xlm",
      hashlock: nextHashlock(),
      srcChain: "ethereum",
      srcAddress: VALID_ETH_ADDR,
      srcAsset: "native",
      srcAmount: "1",
      srcSafetyDeposit: "1",
      dstChain: "stellar",
      dstAddress: ` ${VALID_STELLAR_ADDR} `,
      dstAsset: "native",
      dstAmount: "1"
    });

    expect(order.dstAddress).toBe(VALID_STELLAR_ADDR);
  });

  it("finds orders by address regardless of query casing or padding", async () => {
    const db = await freshDb();
    const orders = await freshOrders(db);

    await orders.announce({
      direction: "eth_to_xlm",
      hashlock: nextHashlock(),
      srcChain: "ethereum",
      srcAddress: ETH_CHECKSUMMED,
      srcAsset: "native",
      srcAmount: "1",
      srcSafetyDeposit: "1",
      dstChain: "stellar",
      dstAddress: VALID_STELLAR_ADDR,
      dstAsset: "native",
      dstAmount: "1"
    });

    // Before canonicalization, the same order announced in checksummed form
    // could never be found by a lowercase query (and vice versa).
    expect((await orders.history(ETH_LOWER)).length).toBe(1);
    expect((await orders.history(ETH_CHECKSUMMED)).length).toBe(1);
    expect((await orders.history(`  ${ETH_LOWER} `)).length).toBe(1);
    expect((await orders.history(VALID_STELLAR_ADDR)).length).toBe(1);
  });

  it("rejects a 39-hex-digit Ethereum address", async () => {
    const db = await freshDb();
    const orders = await freshOrders(db);

    // Regression: the old testnet USDC constant was 39 hex digits and was
    // accepted and persisted, never matching a real 40-digit token address.
    await expect(
      orders.announce({
        direction: "eth_to_xlm",
        hashlock: nextHashlock(),
        srcChain: "ethereum",
        srcAddress: ETH_MALFORMED_39,
        srcAsset: "native",
        srcAmount: "1",
        srcSafetyDeposit: "1",
        dstChain: "stellar",
        dstAddress: VALID_STELLAR_ADDR,
        dstAsset: "native",
        dstAmount: "1"
      })
    ).rejects.toThrow(OrderValidationError);
    await expect(orders.history(ETH_MALFORMED_39)).rejects.toThrow(
      OrderValidationError
    );
  });

  it("rejects a mixed-case Ethereum address with an invalid EIP-55 checksum", async () => {
    const db = await freshDb();
    const orders = await freshOrders(db);

    await expect(
      orders.announce({
        direction: "eth_to_xlm",
        hashlock: nextHashlock(),
        srcChain: "ethereum",
        srcAddress: ETH_BAD_CHECKSUM,
        srcAsset: "native",
        srcAmount: "1",
        srcSafetyDeposit: "1",
        dstChain: "stellar",
        dstAddress: VALID_STELLAR_ADDR,
        dstAsset: "native",
        dstAmount: "1"
      })
    ).rejects.toThrow(/EIP-55 checksum/);
  });

  it("rejects lowercase and internal-whitespace Ethereum addresses", async () => {
    const db = await freshDb();
    const orders = await freshOrders(db);

    const announceWith = (srcAddress: string) =>
      orders.announce({
        direction: "eth_to_xlm",
        hashlock: nextHashlock(),
        srcChain: "ethereum",
        srcAddress,
        srcAsset: "native",
        srcAmount: "1",
        srcSafetyDeposit: "1",
        dstChain: "stellar",
        dstAddress: VALID_STELLAR_ADDR,
        dstAsset: "native",
        dstAmount: "1"
      });

    await expect(announceWith("no-prefix")).rejects.toThrow(OrderValidationError);
    await expect(
      announceWith("0x1c7d4b196cb0c7b 01d743fbc6116a902379c7238")
    ).rejects.toThrow(OrderValidationError);
    await expect(orders.history("not-an-address")).rejects.toThrow(
      OrderValidationError
    );
  });

  it("rejects a lowercase Stellar address (Stellar IDs are case-sensitive)", async () => {
    const db = await freshDb();
    const orders = await freshOrders(db);

    await expect(
      orders.announce({
        direction: "xlm_to_eth",
        hashlock: nextHashlock(),
        srcChain: "stellar",
        srcAddress: VALID_STELLAR_ADDR.toLowerCase(),
        srcAsset: "native",
        srcAmount: "1",
        srcSafetyDeposit: "1",
        dstChain: "ethereum",
        dstAddress: VALID_ETH_ADDR,
        dstAsset: "native",
        dstAmount: "1"
      })
    ).rejects.toThrow(OrderValidationError);
    await expect(
      orders.history(VALID_STELLAR_ADDR.toLowerCase())
    ).rejects.toThrow(OrderValidationError);
  });

  it("rejects an Ethereum address used as a Stellar address and vice versa", async () => {
    const db = await freshDb();
    const orders = await freshOrders(db);

    await expect(
      orders.announce({
        direction: "xlm_to_eth",
        hashlock: nextHashlock(),
        srcChain: "stellar",
        srcAddress: VALID_ETH_ADDR,
        srcAsset: "native",
        srcAmount: "1",
        srcSafetyDeposit: "1",
        dstChain: "ethereum",
        dstAddress: VALID_ETH_ADDR,
        dstAsset: "native",
        dstAmount: "1"
      })
    ).rejects.toThrow(OrderValidationError);
  });

  it("canonicalizes the resolver on recordDstLock and rejects malformed resolvers", async () => {
    const db = await freshDb();
    const orders = await freshOrders(db);

    const order = await orders.announce({
      direction: "eth_to_xlm",
      hashlock: nextHashlock(),
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
      orderId: "1",
      txHash: "0xsrc",
      blockNumber: 1,
      timelock: 10_000
    });

    // Padded resolver is stored trimmed (and the sameEvent guard compares
    // canonical forms, so a padded re-submission is idempotent).
    await orders.recordDstLock({
      publicId: order.publicId,
      orderId: "1",
      txHash: "0xdst",
      blockNumber: 2,
      timelock: 9_000,
      resolver: ` ${VALID_STELLAR_ADDR} `
    });
    const stored = await orders.get(order.publicId);
    expect(stored!.resolverAddress).toBe(VALID_STELLAR_ADDR);
    await expect(
      orders.recordDstLock({
        publicId: order.publicId,
        orderId: "1",
        txHash: "0xdst",
        blockNumber: 2,
        timelock: 9_000,
        resolver: VALID_STELLAR_ADDR
      })
    ).resolves.toBeUndefined();

    // A malformed resolver is rejected instead of being persisted.
    const order2 = await orders.announce({
      direction: "eth_to_xlm",
      hashlock: nextHashlock(),
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
      publicId: order2.publicId,
      orderId: "2",
      txHash: "0xsrc2",
      blockNumber: 3,
      timelock: 10_000
    });
    await expect(
      orders.recordDstLock({
        publicId: order2.publicId,
        orderId: "2",
        txHash: "0xdst2",
        blockNumber: 4,
        timelock: 9_000,
        resolver: "G" + "0".repeat(55)
      })
    ).rejects.toThrow(OrderValidationError);
  });

  it("validates the dst-chain resolver for xlm_to_eth orders as an Ethereum address", async () => {
    const db = await freshDb();
    const orders = await freshOrders(db);

    const order = await orders.announce({
      direction: "xlm_to_eth",
      hashlock: nextHashlock(),
      srcChain: "stellar",
      srcAddress: VALID_STELLAR_ADDR,
      srcAsset: "native",
      srcAmount: "1",
      srcSafetyDeposit: "1",
      dstChain: "ethereum",
      dstAddress: ETH_CHECKSUMMED,
      dstAsset: "native",
      dstAmount: "1"
    });
    expect(order.dstAddress).toBe(ETH_LOWER);
    await orders.recordSrcLock({
      publicId: order.publicId,
      orderId: "3",
      txHash: "0xsrc3",
      blockNumber: 5,
      timelock: 10_000
    });
    await orders.recordDstLock({
      publicId: order.publicId,
      orderId: "3",
      txHash: "0xdst3",
      blockNumber: 6,
      timelock: 9_000,
      resolver: VALID_ETH_ADDR
    });

    await expect(
      orders.recordDstLock({
        publicId: order.publicId,
        orderId: "3",
        txHash: "0xdst3x",
        blockNumber: 7,
        timelock: 9_000,
        resolver: "not-an-address"
      })
    ).rejects.toThrow(OrderValidationError);
  });
});

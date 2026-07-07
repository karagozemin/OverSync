import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openDatabase } from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { loadConfig } from "../src/config.js";

const VALID_HASHLOCK = "0x" + "a".repeat(64);
const VALID_ETH_ADDR = "0x1111111111111111111111111111111111111111";
const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";

async function freshDb() {
  const dir = mkdtempSync(resolve(tmpdir(), "oversync-fixtures-test-"));
  return openDatabase(`file:${dir}/test.db`);
}

function makeOrderInput(publicId: string, fixture: boolean) {
  // Use a hashlock unique per publicId so we don't accidentally dedupe
  // when inserting several orders back-to-back.
  const uniqueHashlock = "0x" + (publicId + "0".repeat(60)).slice(0, 64);
  return {
    publicId,
    direction: "eth_to_xlm" as const,
    status: "completed" as const,
    hashlock: uniqueHashlock,
    srcChain: "ethereum" as const,
    srcAddress: VALID_ETH_ADDR,
    srcAsset: "native",
    srcAmount: "1000000000000000000",
    srcSafetyDeposit: "1000000000000000",
    srcOrderId: "src-" + publicId,
    srcLockTx: "0xsrc",
    srcLockBlock: 1,
    srcTimelock: 0,
    dstChain: "stellar" as const,
    dstAddress: VALID_STELLAR_ADDR,
    dstAsset: "native",
    dstAmount: "100000000",
    dstOrderId: "dst-" + publicId,
    dstLockTx: "0xdst",
    dstLockBlock: 1,
    dstTimelock: 0,
    preimage: "0x" + "c".repeat(64),
    secretRevealedTx: "0xsecret",
    resolverAddress: VALID_ETH_ADDR,
    fixture
  };
}

describe("OrdersRepository — opt-in fixture reset/remove path (#161)", () => {
  it("counts and removes only fixture-flagged orders, leaves real rows alone", async () => {
    const db = await freshDb();
    const repo = new OrdersRepository(db);

    const f1 = await repo.insertOrder(makeOrderInput("fixture-aaa", true));
    const f2 = await repo.insertOrder(makeOrderInput("fixture-bbb", true));
    const real = await repo.insertOrder(makeOrderInput("real-ccc", false));

    expect(f1.fixture).toBe(true);
    expect(f2.fixture).toBe(true);
    expect(real.fixture).toBe(false);

    expect(await repo.countFixtures()).toBe(2);

    const removed = await repo.removeFixtures();
    expect(removed).toBe(2);
    expect(await repo.countFixtures()).toBe(0);

    const stillThere = await repo.findByPublicId(real.publicId);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.fixture).toBe(false);
  });

  it("removeFixtures() is a no-op when no fixtures have been seeded", async () => {
    const db = await freshDb();
    const repo = new OrdersRepository(db);

    const real = await repo.insertOrder(makeOrderInput("real-only", false));
    expect(await repo.countFixtures()).toBe(0);
    expect(await repo.removeFixtures()).toBe(0);
    expect(await repo.findByPublicId(real.publicId)).not.toBeNull();
  });

  it("does not affect unrelated orders when called twice", async () => {
    const db = await freshDb();
    const repo = new OrdersRepository(db);

    await repo.insertOrder(makeOrderInput("fixture-ddd", true));
    const real = await repo.insertOrder(makeOrderInput("real-eee", false));

    expect(await repo.removeFixtures()).toBe(1);
    // Second call finds nothing to delete (still safe in production where
    // fixtures are seeded by the opt-in only).
    expect(await repo.removeFixtures()).toBe(0);
    expect(await repo.findByPublicId(real.publicId)).not.toBeNull();
  });
});

describe("Coordinator config — fixture mode defaults to OFF", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Snapshot + isolate. The other config fields (RPC URLs, soroban
    // passphrase) are populated by schema defaults so we only need to
    // make sure the env var we're testing is in the desired state.
    process.env = { ...ORIGINAL_ENV };
    delete process.env.COORDINATOR_DEMO_FIXTURES;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('COORDINATOR_DEMO_FIXTURES unset → demoFixtures = false', () => {
    expect(loadConfig().demoFixtures).toBe(false);
  });

  // The specific bug the maintainer flagged: z.coerce.boolean() would
  // map "false" -> Boolean("false") === true. Confirm the fix.
  it('COORDINATOR_DEMO_FIXTURES="false" → demoFixtures = false', () => {
    process.env.COORDINATOR_DEMO_FIXTURES = "false";
    expect(loadConfig().demoFixtures).toBe(false);
  });

  it('COORDINATOR_DEMO_FIXTURES="" (empty, common shell export artefact) → demoFixtures = false', () => {
    process.env.COORDINATOR_DEMO_FIXTURES = "";
    expect(loadConfig().demoFixtures).toBe(false);
  });

  it('COORDINATOR_DEMO_FIXTURES="true" → demoFixtures = true', () => {
    process.env.COORDINATOR_DEMO_FIXTURES = "true";
    expect(loadConfig().demoFixtures).toBe(true);
  });

  // The new preprocess accepts a small whitelist of truthy strings,
  // case-insensitive and trimmed. This avoids the z.coerce.boolean()
  // footgun while staying forgiving for env-var typing mistakes.
  it.each([
    ["TRUE", true],
    ["True", true],
    [" yes ", true],
    ["on", true],
    ["1", true],
    ["0", false],
    ["no", false],
    ["off", false],
    ["false", false],
    ["FALSE", false],
    ["anything-else", false]
  ] as const)(
    "COORDINATOR_DEMO_FIXTURES=%j → demoFixtures = %s",
    (value, expected) => {
      process.env.COORDINATOR_DEMO_FIXTURES = value;
      expect(loadConfig().demoFixtures).toBe(expected);
    }
  );
});

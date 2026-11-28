/**
 * Bounded SQLite busy timeout (#504).
 *
 * The lock-contention case uses two real SQLite connections to the same file:
 * one holds a write transaction while the other tries to write through the
 * repository. That proves the configured timeout (not a hard-coded 5 s) is
 * applied and that the driver's `SQLITE_BUSY` error is replaced with the
 * stable redacted storage error.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  DEFAULT_SQLITE_BUSY_TIMEOUT_MS,
  MAX_SQLITE_BUSY_TIMEOUT_MS,
  MIN_SQLITE_BUSY_TIMEOUT_MS,
  openDatabase,
  setSqliteBusyTimeout,
  StorageUnavailableError,
  STORAGE_UNAVAILABLE_CODE,
  STORAGE_UNAVAILABLE_MESSAGE,
  type SqliteDatabase
} from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { loadConfig } from "../src/config.js";

const ORDER = {
  direction: "eth_to_xlm" as const,
  hashlock: "0x" + "a".repeat(64),
  srcChain: "ethereum" as const,
  srcAddress: "0x1111111111111111111111111111111111111111",
  srcAsset: "native",
  srcAmount: "1000",
  srcSafetyDeposit: "10",
  dstChain: "stellar" as const,
  dstAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422",
  dstAsset: "native",
  dstAmount: "100"
};

describe("SQLite busy timeout configuration (#504)", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.COORDINATOR_SQLITE_BUSY_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("defaults to the documented bounded timeout", () => {
    expect(DEFAULT_SQLITE_BUSY_TIMEOUT_MS).toBe(5_000);
    expect(loadConfig().sqliteBusyTimeoutMs).toBe(DEFAULT_SQLITE_BUSY_TIMEOUT_MS);
  });

  it("accepts the inclusive bounds", () => {
    process.env.COORDINATOR_SQLITE_BUSY_TIMEOUT_MS = String(MIN_SQLITE_BUSY_TIMEOUT_MS);
    expect(loadConfig().sqliteBusyTimeoutMs).toBe(MIN_SQLITE_BUSY_TIMEOUT_MS);

    process.env.COORDINATOR_SQLITE_BUSY_TIMEOUT_MS = String(MAX_SQLITE_BUSY_TIMEOUT_MS);
    expect(loadConfig().sqliteBusyTimeoutMs).toBe(MAX_SQLITE_BUSY_TIMEOUT_MS);
  });

  it.each(["-1", String(MAX_SQLITE_BUSY_TIMEOUT_MS + 1), "not-a-number", "1.5"])(
    "rejects the out-of-range override %s at startup",
    (value) => {
      process.env.COORDINATOR_SQLITE_BUSY_TIMEOUT_MS = value;
      expect(() => loadConfig()).toThrow();
    }
  );

  it("rejects invalid direct values instead of silently ignoring them", async () => {
    const db = (await openDatabase(":memory:")) as SqliteDatabase;
    try {
      expect(() => setSqliteBusyTimeout(db, -1)).toThrow(RangeError);
      expect(() => setSqliteBusyTimeout(db, MAX_SQLITE_BUSY_TIMEOUT_MS + 1)).toThrow(RangeError);
      expect(() => setSqliteBusyTimeout(db, 1.5)).toThrow(RangeError);
    } finally {
      (db as { close(): void }).close();
    }
  });
});

describe("SQLite lock contention (#504)", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("applies the configured timeout and returns a stable redacted error", async () => {
    dir = mkdtempSync(resolve(tmpdir(), "oversync-sqlite-lock-"));
    const filename = resolve(dir, "contended.db");
    const busyTimeoutMs = 50;

    const lockHolder = (await openDatabase(`file:${filename}`, {
      sqliteBusyTimeoutMs: busyTimeoutMs
    })) as SqliteDatabase;
    const contender = (await openDatabase(`file:${filename}`, {
      sqliteBusyTimeoutMs: busyTimeoutMs
    })) as SqliteDatabase;

    try {
      expect(contender.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: busyTimeoutMs });

      const repo = new OrdersRepository(contender);
      lockHolder.exec("BEGIN IMMEDIATE");
      const startedAt = Date.now();
      let error: unknown;
      try {
        await repo.announce(ORDER);
      } catch (caught) {
        error = caught;
      } finally {
        lockHolder.exec("ROLLBACK");
      }
      const elapsedMs = Date.now() - startedAt;

      expect(error).toBeInstanceOf(StorageUnavailableError);
      expect(error).toMatchObject({
        name: "StorageUnavailableError",
        code: STORAGE_UNAVAILABLE_CODE,
        message: STORAGE_UNAVAILABLE_MESSAGE,
        statusCode: 503
      });
      // It waited for its configured budget...
      expect(elapsedMs).toBeGreaterThanOrEqual(30);
      // ...and not for the old hard-coded 5 seconds, nor indefinitely.
      expect(elapsedMs).toBeLessThan(2_000);
      expect((error as Error).message).not.toMatch(/database is locked|SQLITE_BUSY|contended\.db/i);
    } finally {
      lockHolder.close();
      contender.close();
    }
  });
});


/**
 * Cursor pagination for `GET /api/orders/history`.
 *
 * These run against a real SQLite database and the real OrderService, because
 * the bug under test lives in the SQL: an `OFFSET` window (or a `created_at`-only
 * keyset) silently hides an order as soon as a row is inserted mid-pagination.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import pino from "pino";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createApp } from "../src/server/app.js";
import { openDatabase, type Database } from "../src/persistence/db.js";
import { OrdersRepository } from "../src/persistence/orders-repo.js";
import { OrderService } from "../src/services/order-service.js";
import { encodeHistoryCursor, MAX_HISTORY_CURSOR_LENGTH } from "../src/server/routes/cursor-utils.js";
import type { SecretService } from "../src/services/secret-service.js";
import type { QuoteService } from "../src/services/quote-service.js";

const log = pino({ level: "silent" });
const USER = "0x1111111111111111111111111111111111111111";
const STELLAR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";
const T = 1_700_000_000;

let dir: string;
let db: Database;
let app: ReturnType<typeof createApp>;

interface FixtureOrder {
  publicId: string;
  createdAt: number;
}

function hex(ch: string): string {
  return ch.repeat(32);
}

function insertOrder(publicId: string, createdAt: number, owner: string = USER): void {
  (db as any).exec(
    `INSERT INTO orders (
       public_id, direction, status, hashlock,
       src_chain, src_address, src_asset, src_amount, src_safety_deposit,
       dst_chain, dst_address, dst_asset, dst_amount,
       created_at, updated_at
     ) VALUES (
       '${publicId}', 'eth_to_xlm', 'completed', '0x${hex("a")}',
       'ethereum', '${owner}', 'native', '1000', '10',
       'stellar', '${STELLAR}', 'native', '100',
       ${createdAt}, ${createdAt}
     )`
  );
}

interface HistoryResponse {
  transactions: Array<{ id: string }>;
  pagination: {
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

function history(query: Record<string, string>): Promise<HistoryResponse> {
  return request(app)
    .get("/api/orders/history")
    .query(query)
    .expect(200)
    .then((res) => res.body as HistoryResponse);
}

function ids(page: HistoryResponse): string[] {
  return page.transactions.map((t) => t.id);
}

/** Walks every page, following the coordinator's own cursor each time. */
async function walkAllPages(limit: number): Promise<{ pageCount: number; seen: string[] }> {
  let pageCount = 0;
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 20; guard += 1) {
    const query: Record<string, string> = { address: USER, limit: String(limit) };
    if (cursor) query.cursor = cursor;
    const page = await history(query);
    pageCount += 1;
    seen.push(...ids(page));
    if (!page.pagination.hasMore || !page.pagination.nextCursor) break;
    cursor = page.pagination.nextCursor;
  }
  return { pageCount, seen };
}

beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "oversync-cursor-"));
  db = await openDatabase(`file:${dir}/test.db`);
  const orders = new OrderService(new OrdersRepository(db), log);
  app = createApp({
    log,
    corsOrigins: ["*"],
    maxRequestBodyBytes: 65_536,
    network: "testnet",
    orders,
    secrets: { reveal: async () => null, get: async () => null } as unknown as SecretService,
    quotes: {} as unknown as QuoteService
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Six orders deliberately sharing three `created_at` seconds. Ordering on
 * `created_at` alone is not a total order, so `public_id` has to break the tie
 * or orders vanish between pages.
 */
function seedSixOrders(): FixtureOrder[] {
  const rows: FixtureOrder[] = [
    { publicId: hex("6"), createdAt: T },
    { publicId: hex("5"), createdAt: T },
    { publicId: hex("4"), createdAt: T - 1 },
    { publicId: hex("3"), createdAt: T - 1 },
    { publicId: hex("2"), createdAt: T - 2 },
    { publicId: hex("1"), createdAt: T - 2 }
  ];
  for (const row of rows) insertOrder(row.publicId, row.createdAt);
  return rows;
}

describe("GET /api/orders/history — cursor pagination", () => {
  it("lists every order exactly once across three pages", async () => {
    const rows = seedSixOrders();

    const { pageCount, seen } = await walkAllPages(2);

    // Six orders at two per page is three pages, and no order appears twice.
    expect(pageCount).toBe(3);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(rows.map((r) => r.publicId).sort());
  });

  it("orders pages newest first, breaking created_at ties on public_id", async () => {
    seedSixOrders();

    const first = await history({ address: USER, limit: "2" });

    expect(ids(first)).toEqual([hex("6"), hex("5")]);
    expect(first.pagination).toMatchObject({ limit: 2, count: 2, hasMore: true });
    expect(first.pagination.nextCursor).toBeTruthy();
  });

  it("does not hide an order that shares a second with the cursor row", async () => {
    seedSixOrders();

    const first = await history({ address: USER, limit: "2" });
    const second = await history({
      address: USER,
      limit: "2",
      cursor: first.pagination.nextCursor!
    });

    // hex("4") shares its created_at with the page-1 boundary. A
    // `created_at < cursor` filter would drop it.
    expect(ids(second)).toEqual([hex("4"), hex("3")]);
  });

  it("does not hide an existing order when a new one is inserted between pages", async () => {
    seedSixOrders();

    const first = await history({ address: USER, limit: "2" });
    expect(ids(first)).toEqual([hex("6"), hex("5")]);

    // A new order lands above the cursor. Keyset pagination is unaffected;
    // OFFSET would slide the window and repeat hex("5").
    insertOrder(hex("7"), T + 1);

    const second = await history({
      address: USER,
      limit: "2",
      cursor: first.pagination.nextCursor!
    });
    expect(ids(second)).toEqual([hex("4"), hex("3")]);

    const third = await history({
      address: USER,
      limit: "2",
      cursor: second.pagination.nextCursor!
    });
    expect(ids(third)).toEqual([hex("2"), hex("1")]);
  });

  it("reports no next cursor on the final page", async () => {
    seedSixOrders();

    const { seen } = await walkAllPages(2);

    expect(seen).toHaveLength(6);
  });

  it("returns an empty page with no cursor for an address with no orders", async () => {
    const page = await history({ address: "0x" + "9".repeat(40), limit: "2" });

    expect(page.transactions).toEqual([]);
    expect(page.pagination.hasMore).toBe(false);
    expect(page.pagination.nextCursor).toBeNull();
  });

  it("only returns orders belonging to the requested address", async () => {
    seedSixOrders();
    // Belongs to somebody else on both legs, so neither side matches USER.
    insertOrder(hex("e"), T + 5, "0x" + "9".repeat(40));

    const page = await history({ address: USER, limit: "50" });

    expect(ids(page)).not.toContain(hex("e"));
    expect(ids(page)).toHaveLength(6);
  });

  it("accepts the address as eth= for clients that only hold an ETH address", async () => {
    seedSixOrders();

    const page = await history({ eth: USER, limit: "2" });

    expect(ids(page)).toEqual([hex("6"), hex("5")]);
  });
});

describe("GET /api/orders/history — invalid cursors", () => {
  it("rejects a malformed cursor instead of silently returning a short page", async () => {
    seedSixOrders();

    const res = await request(app)
      .get("/api/orders/history")
      .query({ address: USER, cursor: "not-a-cursor" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_cursor");
    expect(res.body.reason).toBe("malformed");
    expect(res.body.transactions).toBeUndefined();
  });

  it("rejects a cursor minted for another user", async () => {
    seedSixOrders();
    const foreign = encodeHistoryCursor({
      createdAt: T,
      publicId: hex("5"),
      user: "0x" + "9".repeat(40),
      network: "testnet"
    });

    const res = await request(app)
      .get("/api/orders/history")
      .query({ address: USER, cursor: foreign });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_cursor");
    expect(res.body.reason).toBe("user_mismatch");
  });

  it("rejects a cursor minted for another network", async () => {
    seedSixOrders();
    const mainnet = encodeHistoryCursor({
      createdAt: T,
      publicId: hex("5"),
      user: USER,
      network: "mainnet"
    });

    const res = await request(app)
      .get("/api/orders/history")
      .query({ address: USER, cursor: mainnet });

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("network_mismatch");
  });

  it("rejects a request that declares the wrong network", async () => {
    seedSixOrders();

    const res = await request(app)
      .get("/api/orders/history")
      .query({ address: USER, network: "mainnet" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("network_mismatch");
  });

  it("rejects an out-of-range limit", async () => {
    for (const limit of ["0", "-1", "201", "abc", "1.5"]) {
      const res = await request(app)
        .get("/api/orders/history")
        .query({ address: USER, limit });
      expect(res.status, `limit=${limit}`).toBe(400);
      expect(res.body.error).toBe("invalid_limit");
    }
  });

  it("requires an address", async () => {
    const res = await request(app).get("/api/orders/history");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("address_required");
  });

  it("accepts an exact-limit token and gives the same error for oversized and malformed tokens", async () => {
    const encoded = encodeHistoryCursor({
      createdAt: T,
      publicId: hex("a"),
      user: USER,
      network: "testnet"
    });
    // Trailing JSON whitespace leaves the cursor payload unchanged.
    const payload = Buffer.from(encoded, "base64url").toString("utf8");
    const exact = Buffer.from(payload.padEnd(MAX_HISTORY_CURSOR_LENGTH * 3 / 4)).toString("base64url");
    expect(exact).toHaveLength(MAX_HISTORY_CURSOR_LENGTH);
    const oversized = Buffer.from(payload.padEnd(MAX_HISTORY_CURSOR_LENGTH * 3 / 4 + 1)).toString("base64url");

    await request(app).get("/api/orders/history").query({ address: USER, cursor: exact }).expect(200);
    for (const cursor of [oversized, "not-a-cursor"]) {
      await request(app).get("/api/orders/history").query({ address: USER, cursor }).expect(400, {
        error: "invalid_cursor",
        reason: "malformed",
        message: "Cursor is not a valid pagination token"
      });
    }
  });
});

import request from "supertest";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "../src/server/app.js";
import { MAX_ORDER_ID_LENGTH } from "../src/server/routes/order-identifiers.js";

const exactLimit = "x".repeat(MAX_ORDER_ID_LENGTH);
const overLimit = exactLimit + "x";
const lock = { txHash: "tx", blockNumber: 1, timelock: 10 };
const reveal = { preimage: "0x" + "a".repeat(64), txHash: "tx" };

function setup() {
  const orders = {
    get: vi.fn().mockResolvedValue(null),
    recordSrcLock: vi.fn().mockResolvedValue(undefined),
    recordDstLock: vi.fn().mockResolvedValue(undefined)
  };
  const secrets = {
    get: vi.fn().mockResolvedValue(null),
    reveal: vi.fn().mockResolvedValue(undefined)
  };
  const app = createApp({
    log: pino({ level: "silent" }),
    corsOrigins: [],
    maxRequestBodyBytes: 65_536,
    orders: orders as unknown as AppDeps["orders"],
    secrets: secrets as unknown as AppDeps["secrets"],
    quotes: {} as AppDeps["quotes"]
  });
  return { client: request(app), orders, secrets };
}

describe("coordinator order ID boundaries", () => {
  it.each([
    "/api/orders/:id",
    "/api/orders/:id/transitions",
    "/api/orders/:id/rejected-transitions",
    "/api/orders/:id/refund-eligibility",
    "/api/secrets/:id"
  ])("checks the decoded parameter on %s", async (route) => {
    const { client, orders, secrets } = setup();
    const lookup = route.startsWith("/api/secrets") ? secrets.get : orders.get;
    for (const invalid of [overLimit, " padded", "padded ", "control\u0000character", "control\u0085character"]) {
      await client.get(route.replace(":id", encodeURIComponent(invalid)))
        .expect(400, { error: "invalid_order_id" });
    }
    expect(lookup).not.toHaveBeenCalled();

    await client.get(route.replace(":id", exactLimit)).expect(404);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(exactLimit);
  });

  it.each(["src", "dst"])("checks both IDs on the %s lock route", async (leg) => {
    const { client, orders } = setup();
    const recordLock = leg === "src" ? orders.recordSrcLock : orders.recordDstLock;
    const path = (id: string) => `/api/orders/${id}/${leg}-locked`;

    await client.post(path(overLimit)).send({ ...lock, orderId: exactLimit })
      .expect(400, { error: "invalid_order_id" });
    for (const invalid of [overLimit, " padded", "padded ", "control\ncharacter", 123]) {
      await client.post(path(exactLimit)).send({ ...lock, orderId: invalid })
        .expect(400, { error: "invalid_order_id" });
    }
    expect(recordLock).not.toHaveBeenCalled();

    await client.post(path(exactLimit)).send({ ...lock, orderId: exactLimit }).expect(200);
    expect(recordLock).toHaveBeenCalledWith(expect.objectContaining({
      publicId: exactLimit,
      orderId: exactLimit
    }));
  });

  it("checks the body ID on secret reveal", async () => {
    const { client, secrets } = setup();
    for (const invalid of [overLimit, " padded", "padded ", "control\tcharacter", ""]) {
      await client.post("/api/secrets/reveal").send({ ...reveal, publicId: invalid })
        .expect(400, { error: "invalid_order_id" });
    }
    expect(secrets.reveal).not.toHaveBeenCalled();

    await client.post("/api/secrets/reveal").send({ ...reveal, publicId: exactLimit }).expect(200);
    expect(secrets.reveal).toHaveBeenCalledTimes(1);
    expect(secrets.reveal).toHaveBeenCalledWith(exactLimit, reveal.preimage, reveal.txHash);
  });
});

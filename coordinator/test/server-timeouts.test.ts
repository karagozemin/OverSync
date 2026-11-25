import express from "express";
import { connect, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  DEFAULT_HEADERS_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  connectionsCheckingIntervalMs,
  createCoordinatorServer,
  serverTimeoutsFromEnv,
  serverTimeoutsSchema
} from "../src/server/timeouts.js";

const issuesOf = (raw: unknown) => {
  const result = serverTimeoutsSchema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("server timeout schema", () => {
  it("uses bounded defaults when nothing is set", () => {
    const parsed = serverTimeoutsSchema.parse({});

    expect(parsed).toEqual({
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      headersTimeoutMs: DEFAULT_HEADERS_TIMEOUT_MS
    });
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_HEADERS_TIMEOUT_MS).toBeLessThanOrEqual(DEFAULT_REQUEST_TIMEOUT_MS);
    // Tighter than Node's own 60 s and 300 s defaults.
    expect(DEFAULT_HEADERS_TIMEOUT_MS).toBeLessThan(60_000);
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeLessThan(300_000);
  });

  it("accepts values given as strings, as they arrive from the environment", () => {
    expect(serverTimeoutsSchema.parse({ requestTimeoutMs: "45000", headersTimeoutMs: "5000" })).toEqual({
      requestTimeoutMs: 45_000,
      headersTimeoutMs: 5_000
    });
  });

  it("accepts the edges of the allowed range", () => {
    expect(
      serverTimeoutsSchema.parse({ requestTimeoutMs: MIN_TIMEOUT_MS, headersTimeoutMs: MIN_TIMEOUT_MS })
    ).toEqual({ requestTimeoutMs: MIN_TIMEOUT_MS, headersTimeoutMs: MIN_TIMEOUT_MS });
    expect(
      serverTimeoutsSchema.parse({ requestTimeoutMs: MAX_TIMEOUT_MS, headersTimeoutMs: MAX_TIMEOUT_MS })
    ).toEqual({ requestTimeoutMs: MAX_TIMEOUT_MS, headersTimeoutMs: MAX_TIMEOUT_MS });
  });

  it("accepts a headers limit equal to the request limit", () => {
    expect(issuesOf({ requestTimeoutMs: 8000, headersTimeoutMs: 8000 })).toEqual([]);
  });

  it.each([
    ["zero, which Node reads as no limit", "0"],
    ["a negative number", "-1"],
    ["below the minimum", String(MIN_TIMEOUT_MS - 1)],
    ["above the maximum", String(MAX_TIMEOUT_MS + 1)],
    ["a fraction", "1500.5"],
    ["not a number", "soon"],
    ["empty", ""],
    ["infinite", "Infinity"]
  ])("rejects a request timeout that is %s", (_label, value) => {
    const issues = issuesOf({ requestTimeoutMs: value, headersTimeoutMs: "1000" });

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).toContain("requestTimeoutMs");
  });

  it.each([
    ["zero, which Node reads as no limit", "0"],
    ["a negative number", "-1"],
    ["above the maximum", String(MAX_TIMEOUT_MS + 1)],
    ["not a number", "soon"],
    ["empty", ""]
  ])("rejects a headers timeout that is %s", (_label, value) => {
    const issues = issuesOf({ requestTimeoutMs: "30000", headersTimeoutMs: value });

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).toContain("headersTimeoutMs");
  });

  it("rejects a headers limit longer than the request limit", () => {
    const issues = issuesOf({ requestTimeoutMs: "5000", headersTimeoutMs: "6000" });

    expect(issues).toEqual(["headersTimeoutMs: headersTimeoutMs must not exceed requestTimeoutMs"]);
  });

  it("reads the two environment variables", () => {
    expect(
      serverTimeoutsFromEnv({
        COORDINATOR_REQUEST_TIMEOUT_MS: "20000",
        COORDINATOR_HEADERS_TIMEOUT_MS: "4000"
      })
    ).toEqual({ requestTimeoutMs: "20000", headersTimeoutMs: "4000" });
    expect(serverTimeoutsFromEnv({})).toEqual({
      requestTimeoutMs: undefined,
      headersTimeoutMs: undefined
    });
  });
});

describe("loadConfig server timeouts", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // Isolate the test from the host's own configuration.
    delete process.env.NETWORK_MODE;
    delete process.env.COORDINATOR_REQUEST_TIMEOUT_MS;
    delete process.env.COORDINATOR_HEADERS_TIMEOUT_MS;
    process.env.DATABASE_URL = "file:./oversync.db";
    process.env.SEPOLIA_RPC_URL = "https://sepolia.infura.io/v3/mock-key";
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("falls back to the safe defaults", () => {
    expect(loadConfig().serverTimeouts).toEqual({
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      headersTimeoutMs: DEFAULT_HEADERS_TIMEOUT_MS
    });
  });

  it("takes both limits from the environment", () => {
    process.env.COORDINATOR_REQUEST_TIMEOUT_MS = "20000";
    process.env.COORDINATOR_HEADERS_TIMEOUT_MS = "4000";

    expect(loadConfig().serverTimeouts).toEqual({ requestTimeoutMs: 20_000, headersTimeoutMs: 4_000 });
  });

  it.each([
    ["COORDINATOR_REQUEST_TIMEOUT_MS", "0"],
    ["COORDINATOR_REQUEST_TIMEOUT_MS", "-5"],
    ["COORDINATOR_REQUEST_TIMEOUT_MS", "forever"],
    ["COORDINATOR_REQUEST_TIMEOUT_MS", ""],
    ["COORDINATOR_REQUEST_TIMEOUT_MS", "999999999"],
    ["COORDINATOR_HEADERS_TIMEOUT_MS", "0"],
    ["COORDINATOR_HEADERS_TIMEOUT_MS", "1.5"],
    ["COORDINATOR_HEADERS_TIMEOUT_MS", "forever"]
  ])("refuses to start with %s=%j", (name, value) => {
    process.env[name] = value;

    expect(() => loadConfig()).toThrow(/serverTimeouts/);
  });

  it("refuses to start when the headers limit exceeds the request limit", () => {
    process.env.COORDINATOR_REQUEST_TIMEOUT_MS = "5000";
    process.env.COORDINATOR_HEADERS_TIMEOUT_MS = "9000";

    expect(() => loadConfig()).toThrow(/headersTimeoutMs must not exceed requestTimeoutMs/);
  });
});

describe("connectionsCheckingIntervalMs", () => {
  it("checks often enough that a limit is not exceeded by much", () => {
    // Node's default of 30 s would let a 10 s limit run to 40 s.
    expect(connectionsCheckingIntervalMs({ requestTimeoutMs: 30_000, headersTimeoutMs: 10_000 })).toBe(1_000);
    expect(connectionsCheckingIntervalMs({ requestTimeoutMs: 4_000, headersTimeoutMs: 2_000 })).toBe(500);
  });

  it("stays within one second and 100 ms", () => {
    expect(connectionsCheckingIntervalMs({ requestTimeoutMs: 300_000, headersTimeoutMs: 300_000 })).toBe(1_000);
    expect(connectionsCheckingIntervalMs({ requestTimeoutMs: 100, headersTimeoutMs: 100 })).toBe(100);
  });
});

describe("createCoordinatorServer", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const closing = server;
    server = undefined;
    if (closing) {
      closing.closeAllConnections();
      await new Promise<void>((resolve) => closing.close(() => resolve()));
    }
  });

  async function start(timeouts: { requestTimeoutMs: number; headersTimeoutMs: number }) {
    const app = express();
    app.get("/ping", (_req, res) => {
      res.json({ ok: true });
    });
    app.post("/echo", express.json(), (req, res) => {
      res.json(req.body);
    });
    server = createCoordinatorServer(app, timeouts);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  }

  /** Open a raw connection, send `chunks`, and report what came back and when it closed. */
  function talk(port: number, chunks: string[], waitMs: number) {
    return new Promise<{ received: string; closedAfterMs: number | null }>((resolve) => {
      const startedAt = Date.now();
      let received = "";
      let closedAfterMs: number | null = null;
      const socket: Socket = connect(port, "127.0.0.1", () => {
        for (const chunk of chunks) socket.write(chunk);
      });
      socket.on("data", (data) => {
        received += data.toString("utf8");
      });
      socket.on("close", () => {
        closedAfterMs = Date.now() - startedAt;
      });
      socket.on("error", () => undefined);
      setTimeout(() => {
        socket.destroy();
        resolve({ received, closedAfterMs });
      }, waitMs);
    });
  }

  it("applies the configured limits to the server", async () => {
    await start({ requestTimeoutMs: 4_000, headersTimeoutMs: 2_000 });

    expect(server!.requestTimeout).toBe(4_000);
    expect(server!.headersTimeout).toBe(2_000);
    // Declared in Node's HTTP options but missing from the Server typings.
    expect((server as Server & { connectionsCheckingInterval?: number }).connectionsCheckingInterval).toBe(500);
  });

  it("still serves a normal request promptly", async () => {
    const port = await start({ requestTimeoutMs: 4_000, headersTimeoutMs: 2_000 });

    const response = await fetch(`http://127.0.0.1:${port}/ping`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("still serves a normal request with a body", async () => {
    const port = await start({ requestTimeoutMs: 4_000, headersTimeoutMs: 2_000 });

    const response = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hello: "world" });
  });

  it("cuts off a client that never finishes its headers", async () => {
    const port = await start({ requestTimeoutMs: 1_500, headersTimeoutMs: 600 });

    // The request line and one header, but never the blank line that ends them.
    const result = await talk(port, ["GET /ping HTTP/1.1\r\nHost: coordinator\r\n"], 3_500);

    expect(result.closedAfterMs).not.toBeNull();
    expect(result.closedAfterMs!).toBeLessThan(2_500);
    expect(result.received).toContain("408");
  });

  it("cuts off a client that promises a body and never sends it", async () => {
    const port = await start({ requestTimeoutMs: 1_200, headersTimeoutMs: 600 });

    const result = await talk(
      port,
      [
        "POST /echo HTTP/1.1\r\nHost: coordinator\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n",
        '{"a":'
      ],
      3_500
    );

    expect(result.closedAfterMs).not.toBeNull();
    expect(result.closedAfterMs!).toBeLessThan(2_500);
    expect(result.received).toContain("408");
  });

  it("does not cut off a client that finishes inside the limits", async () => {
    const port = await start({ requestTimeoutMs: 1_500, headersTimeoutMs: 600 });

    const result = await talk(
      port,
      ["GET /ping HTTP/1.1\r\nHost: coordinator\r\nConnection: close\r\n\r\n"],
      1_000
    );

    expect(result.received).toContain("200 OK");
    expect(result.received).not.toContain("408");
  });
});
